const FOUNDER_CUTOFF = process.env.FOUNDER_CUTOFF || "2027-01-02T00:00:00Z";

function baseUrl(req) {
  const configured = (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

function paypalBase() {
  return process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal is not configured yet.");

  const response = await fetch(paypalBase() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || "PayPal authentication failed.");
  }
  return data.access_token;
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

  const auth = String(req.headers.authorization || "");
  const sessionToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!sessionToken) return res.status(401).json({ error: "Sign in before purchasing Founding Supporter." });

  try {
    const user = await getSupabaseUser(sessionToken);
    const cfgUrl = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    const profileRes = await fetch(
      `${cfgUrl}/rest/v1/profiles?select=founding_supporter&id=eq.${user.id}&limit=1`,
      { headers: { apikey: anon, Authorization: `Bearer ${sessionToken}` } }
    );
    if (!profileRes.ok) throw new Error("Could not verify current PAI account status.");
    const profiles = await profileRes.json();
    if (profiles?.[0]?.founding_supporter) {
      return res.status(409).json({ error: "This account is already a Founding Supporter." });
    }

    const accessToken = await paypalAccessToken();
    const response = await fetch(paypalBase() + "/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `pai-founder-${user.id}-${Date.now()}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          custom_id: user.id,
          description: "PAI Founding Supporter — one-time support for PAI development",
          amount: { currency_code: "USD", value: "5.00" }
        }],
        application_context: {
          brand_name: "PAI",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: `${baseUrl(req)}/account.html?founder=paypal-return`,
          cancel_url: `${baseUrl(req)}/account.html?founder=cancelled`
        }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || "PayPal could not create the order.");

    const approve = (data.links || []).find(link => link.rel === "approve" || link.rel === "payer-action");
    if (!approve?.href) throw new Error("PayPal did not return an approval URL.");

    return res.status(200).json({ orderId: data.id, url: approve.href });
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
}
