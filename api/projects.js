const { getDb } = require("./db");

module.exports = async function handler(req, res) {
  const db = getDb();

  if (req.method === "GET") {
    const result = await db.execute("SELECT * FROM projects ORDER BY id");
    return res.json(result.rows);
  }

  if (req.method === "POST") {
    const p = req.body;
    const result = await db.execute({
      sql: `INSERT INTO projects (rep, dateStarted, customer, distributor, application, productType, partNumber, quoteNumber, eau, opportunitySize, city, state, country, closeDate, competitor, lastVisit, confidence, status, "update")
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        p.rep || "", p.dateStarted || "", p.customer || "", p.distributor || "",
        p.application || "", p.productType || "Thin Section", p.partNumber || "",
        p.quoteNumber || "", p.eau || "", p.opportunitySize || 0, p.city || "",
        p.state || "", p.country || "USA", p.closeDate || "", p.competitor || "",
        p.lastVisit || "", p.confidence || "", p.status || "1. New Opportunity",
        p.update || "",
      ],
    });
    const created = await db.execute({
      sql: "SELECT * FROM projects WHERE id = ?",
      args: [Number(result.lastInsertRowid)],
    });
    return res.status(201).json(created.rows[0]);
  }

  res.status(405).json({ error: "Method not allowed" });
};
