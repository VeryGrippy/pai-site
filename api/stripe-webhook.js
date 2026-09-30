import crypto from "node:crypto";

export const config = { api: { bodyParser: false } };

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyStripeSignature(raw, header, secret) {
  const parts = String(header || "").split(",").map(x => x.trim());
  const timestamp = parts.find(x => x.startsWith("t="))?.slice(2);
  const signatures = parts.filter(x => x.startsWith("v1=")).map(x => x.slice(3));
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  return signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  });
}

async function supabaseRest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are not configured.");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`Supabase update failed: ${await response.text()}`);
  return response;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Stripe webhook is not configured." });

  const raw = await readRaw(req);
  if (!verifyStripeSignature(raw, req.headers["stripe-signature"], secret)) {
    return res.status(400).json({ error: "Invalid Stripe signature." });
  }

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid webhook body." });
  }

  try {
    // Idempotency: Stripe may retry the same event.
    const eventInsert = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/payment_events?on_conflict=stripe_event_id`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify([{ stripe_event_id: event.id, event_type: event.type }])
      }
    );
    if (!eventInsert.ok) throw new Error(await eventInsert.text());
    const inserted = await eventInsert.json();
    if (!inserted.length) return res.status(200).json({ received: true, duplicate: true });

    if (event.type === "checkout.session.completed") {
      const session = event.data?.object || {};
      if (
        session.payment_status === "paid" &&
        session.metadata?.entitlement === "founding_supporter" &&
        session.metadata?.user_id
      ) {
        const userId = session.metadata.user_id;
        const email = session.customer_details?.email || session.customer_email || null;
        await supabaseRest("profiles?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify([{
            id: userId,
            email,
            plan: "free",
            founding_supporter: true,
            founding_supporter_purchased_at: new Date().toISOString(),
            stripe_customer_id: session.customer || null,
            updated_at: new Date().toISOString()
          }])
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
