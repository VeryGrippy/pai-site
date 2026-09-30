const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  const response = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { apikey: anonKey, Authorization: authHeader },
  });
  if (!response.ok) throw new Error("Invalid or expired PAI session.");
  return await response.json();
}

async function grantFounder(args: { userId: string; email?: string; eventId: string; payerId?: string }) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase service credentials are not configured.");

  const eventRes = await fetch(`${url}/rest/v1/payment_events?on_conflict=payment_event_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify([{
      payment_event_id: args.eventId,
      provider: "paypal",
      event_type: "PAYPAL_ORDER_CAPTURED",
    }]),
  });
  if (!eventRes.ok) throw new Error(await eventRes.text());
  const inserted = await eventRes.json();
  if (!inserted.length) return;

  const profileRes = await fetch(`${url}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([{
      id: args.userId,
      email: args.email || null,
      founding_supporter: true,
      founding_supporter_purchased_at: new Date().toISOString(),
      paypal_payer_id: args.payerId || null,
      updated_at: new Date().toISOString(),
    }]),
  });
  if (!profileRes.ok) throw new Error(await profileRes.text());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) throw new Error("Sign in before confirming payment.");

    const user = await supabaseUser(auth);
    const body = await req.json().catch(() => ({}));
    const orderId = String(body?.orderId || "").trim();
    if (!orderId) throw new Error("Missing PayPal order ID.");

    const accessToken = await paypalAccessToken();
    let response = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `pai-founder-capture-${orderId}`,
      },
      body: "{}",
    });
    let order = await response.json();

    if (!response.ok) {
      const alreadyCaptured = Array.isArray(order?.details) &&
        order.details.some((item: any) => item.issue === "ORDER_ALREADY_CAPTURED");
      if (!alreadyCaptured) throw new Error(order?.message || "PayPal could not capture the order.");

      response = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      order = await response.json();
      if (!response.ok) throw new Error("Could not verify the completed PayPal order.");
    }

    const unit = order.purchase_units?.[0] || {};
    const capture = unit.payments?.captures?.[0] || {};
    const amount = capture.amount || unit.amount || {};
    const completed = order.status === "COMPLETED" || capture.status === "COMPLETED";

    if (String(unit.custom_id || "") !== user.id) {
      throw new Error("PayPal order does not belong to this PAI account.");
    }
    if (String(amount.currency_code || "").toUpperCase() !== "USD" || String(amount.value || "") !== "5.00") {
      throw new Error("PayPal order amount did not match the Founding Supporter price.");
    }
    if (!completed) throw new Error("PayPal payment is not completed.");

    await grantFounder({
      userId: user.id,
      email: user.email,
      eventId: capture.id || orderId,
      payerId: order.payer?.payer_id,
    });

    return Response.json({ ok: true, foundingSupporter: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 400, headers: corsHeaders });
  }
});
