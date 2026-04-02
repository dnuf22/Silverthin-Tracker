const { getDb } = require("../../db");

module.exports = async function handler(req, res) {
  const db = getDb();
  const { id } = req.query;

  if (req.method === "GET") {
    const result = await db.execute({
      sql: "SELECT * FROM history WHERE projectId = ? ORDER BY id",
      args: [id],
    });
    return res.json(result.rows);
  }

  res.status(405).json({ error: "Method not allowed" });
};
