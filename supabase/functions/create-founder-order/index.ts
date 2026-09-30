const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FOUNDER_CUTOFF = Deno.env.get("FOUNDER_CUTOFF") || "2027-01-02T00:00:00Z";

function paypalBase() {
  return (Deno.env.get("PAYPAL_ENV") || "live").toLowerCase() === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function paypalAccessToken() {
  const id = Deno.env.get("PAYPAL_CLIENT_ID") || "";
  const secret = Deno.env.get("PAYPAL_CLIENT_SECRET") || "";
  if (!id || !secret) throw new Error("PayPal is not configured yet.");

  const credentials = btoa(`${id}:${secret}`);
  const response = await fetch(paypalBase() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || "PayPal authentication failed.");
  }
  return data.access_token;
}

async function supabaseUser(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) throw new Error("Supabase is not configured.");

  const response = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: {
      apikey: anonKey,
      Authorization: authHeader,
    },
  });
  if (!response.ok) throw new Error("Invalid or expired PAI session.");
  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }
  if (Date.now() >= Date.parse(FOUNDER_CUTOFF)) {
    return Response.json({ error: "The Founding Supporter offer has ended." }, { status: 410, headers: corsHeaders });
  }

  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) throw new Error("Sign in before purchasing Founding Supporter.");

    const user = await supabaseUser(auth);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=founding_supporter&id=eq.${user.id}&limit=1`,
      { headers: { apikey: anonKey, Authorization: auth } },
    );
    if (!profileRes.ok) throw new Error("Could not verify current PAI account status.");
    const profiles = await profileRes.json();
    if (profiles?.[0]?.founding_supporter) {
      return Response.json({ error: "This account is already a Founding Supporter." }, { status: 409, headers: corsHeaders });
    }

    const accessToken = await paypalAccessToken();
    const publicSite = (Deno.env.get("PUBLIC_SITE_URL") || "https://verygrippy.github.io/pai-site").replace(/\/$/, "");
    const response = await fetch(paypalBase() + "/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `pai-founder-${user.id}-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          custom_id: user.id,
          description: "PAI Founding Supporter — one-time support for PAI development",
          amount: { currency_code: "USD", value: "5.00" },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "PAI",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: `${publicSite}/account.html?founder=paypal-return`,
              cancel_url: `${publicSite}/account.html?founder=cancelled`,
            },
          },
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || "PayPal could not create the order.");

    const approve = (data.links || []).find((link: any) => link.rel === "payer-action" || link.rel === "approve");
    if (!approve?.href) throw new Error("PayPal did not return an approval URL.");

    return Response.json({ orderId: data.id, url: approve.href }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 400, headers: corsHeaders });
  }
});
