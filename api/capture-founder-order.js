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

async function grantFounder({ userId, email, orderId, captureId, payerId }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are not configured.");

  const eventId = captureId || orderId;
  const eventRes = await fetch(`${url}/rest/v1/payment_events?on_conflict=payment_event_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation"
    },
    body: JSON.stringify([{
      payment_event_id: eventId,
      provider: "paypal",
      event_type: "PAYPAL_ORDER_CAPTURED"
    }])
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
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify([{
      id: userId,
      email: email || null,
      founding_supporter: true,
      founding_supporter_purchased_at: new Date().toISOString(),
      paypal_payer_id: payerId || null,
      updated_at: new Date().toISOString()
    }])
  });
  if (!profileRes.ok) throw new Error(await profileRes.text());
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = String(req.headers.authorization || "");
  const sessionToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!sessionToken) return res.status(401).json({ error: "Sign in before confirming payment." });

  const orderId = String(req.body?.orderId || "").trim();
  if (!orderId) return res.status(400).json({ error: "Missing PayPal order ID." });

  try {
    const user = await getSupabaseUser(sessionToken);
    const accessToken = await paypalAccessToken();

    const response = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `pai-founder-capture-${orderId}`
      },
      body: "{}"
    });
    const data = await response.json();

    if (!response.ok) {
      const alreadyCaptured = Array.isArray(data?.details) &&
        data.details.some(item => item.issue === "ORDER_ALREADY_CAPTURED");
      if (!alreadyCaptured) throw new Error(data?.message || "PayPal could not capture the order.");
    }

    const order = response.ok ? data : await (async () => {
      const readRes = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const readData = await readRes.json();
      if (!readRes.ok) throw new Error("Could not verify the completed PayPal order.");
      return readData;
    })();

    const unit = order.purchase_units?.[0] || {};
    const customId = String(unit.custom_id || "");
    const amount = unit.payments?.captures?.[0]?.amount || unit.amount || {};
    const capture = unit.payments?.captures?.[0] || {};
    const completed = order.status === "COMPLETED" || capture.status === "COMPLETED";

    if (customId !== user.id) throw new Error("PayPal order does not belong to this PAI account.");
    if (String(amount.currency_code || "").toUpperCase() !== "USD" || String(amount.value || "") !== "5.00") {
      throw new Error("PayPal order amount did not match the Founding Supporter price.");
    }
    if (!completed) throw new Error("PayPal payment is not completed.");

    await grantFounder({
      userId: user.id,
      email: user.email,
      orderId,
      captureId: capture.id,
      payerId: order.payer?.payer_id
    });

    return res.status(200).json({ ok: true, foundingSupporter: true });
  } catch (error) {
    return res.status(400).json({ error: String(error.message || error) });
  }
}
