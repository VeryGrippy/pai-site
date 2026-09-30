const FOUNDER_CUTOFF = process.env.FOUNDER_CUTOFF || "2027-01-02T00:00:00Z";

function baseUrl(req) {
  const configured = (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

async function getSupabaseUser(token) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase is not configured.");
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Invalid or expired PAI session.");
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (Date.now() >= Date.parse(FOUNDER_CUTOFF)) {
    return res.status(410).json({ error: "The Founding Supporter offer has ended." });
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: "Payments are not configured yet." });

  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in before purchasing Founding Supporter." });

  try {
    const user = await getSupabaseUser(token);

    const cfgUrl = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    const profileRes = await fetch(
      `${cfgUrl}/rest/v1/profiles?select=founding_supporter&id=eq.${user.id}&limit=1`,
      { headers: { apikey: anon, Authorization: `Bearer ${token}` } }
    );
    if (!profileRes.ok) throw new Error("Could not verify current PAI account status.");
    const profiles = await profileRes.json();
    if (profiles?.[0]?.founding_supporter) {
      return res.status(409).json({ error: "This account is already a Founding Supporter." });
    }

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("customer_email", user.email || "");
    params.set("client_reference_id", user.id);
    params.set("metadata[user_id]", user.id);
    params.set("metadata[entitlement]", "founding_supporter");
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", "500");
    params.set("line_items[0][price_data][product_data][name]", "PAI Founding Supporter");
    params.set("line_items[0][price_data][product_data][description]", "One-time support for PAI development with permanent Founding Supporter status.");
    params.set("success_url", `${baseUrl(req)}/account.html?founder=success`);
    params.set("cancel_url", `${baseUrl(req)}/account.html?founder=cancelled`);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Stripe could not create checkout.");
    return res.status(200).json({ url: data.url });
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
}
