// Vercel serverless function — GET /api/health
export default function handler(_req, res) {
  res.status(200).json({
    status: "ok",
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
