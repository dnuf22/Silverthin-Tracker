const { getDb } = require("../db");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const db = getDb();
  const result = await db.execute({
    sql: `SELECT DISTINCT substr(date, 1, 7) AS ym
          FROM history
          WHERE substr(date, 1, 7) < substr(date('now'), 1, 7)
          ORDER BY ym DESC
          LIMIT 24`,
    args: [],
  });

  const months = result.rows.map(r => r.ym).filter(Boolean);
  return res.json(months);
};
