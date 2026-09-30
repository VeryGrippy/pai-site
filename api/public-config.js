export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return res.status(503).json({ error: "Account service is not configured yet." });
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  return res.status(200).json({
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    foundingSupporterCutoff: process.env.FOUNDER_CUTOFF || "2027-01-02T00:00:00Z"
  });
}
