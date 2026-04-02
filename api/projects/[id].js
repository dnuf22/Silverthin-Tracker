const { getDb } = require("../db");

module.exports = async function handler(req, res) {
  const db = getDb();
  const { id } = req.query;

  if (req.method === "GET") {
    const result = await db.execute({ sql: "SELECT * FROM projects WHERE id = ?", args: [id] });
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(result.rows[0]);
  }

  if (req.method === "PUT") {
    const old = await db.execute({ sql: "SELECT * FROM projects WHERE id = ?", args: [id] });
    if (old.rows.length === 0) return res.status(404).json({ error: "Not found" });

    const p = req.body;
    const prev = old.rows[0];
    const now = new Date().toISOString().split("T")[0];

    await db.execute({
      sql: `INSERT INTO history (projectId, date, prevStatus, newStatus, prevUpdate, newUpdate, prevConfidence, newConfidence, changedBy)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, now, prev.status, p.status, prev.update, p.update, prev.confidence, p.confidence, p.changedBy || ""],
    });

    await db.execute({
      sql: `UPDATE projects SET rep=?, dateStarted=?, customer=?, distributor=?, application=?, productType=?, partNumber=?, quoteNumber=?, eau=?, opportunitySize=?, city=?, state=?, country=?, closeDate=?, competitor=?, lastVisit=?, confidence=?, status=?, "update"=?
            WHERE id=?`,
      args: [
        p.rep || "", p.dateStarted || "", p.customer || "", p.distributor || "",
        p.application || "", p.productType || "", p.partNumber || "",
        p.quoteNumber || "", p.eau || "", p.opportunitySize || 0, p.city || "",
        p.state || "", p.country || "", p.closeDate || "", p.competitor || "",
        p.lastVisit || "", p.confidence || "", p.status || "", p.update || "",
        id,
      ],
    });

    const updated = await db.execute({ sql: "SELECT * FROM projects WHERE id = ?", args: [id] });
    return res.json(updated.rows[0]);
  }

  res.status(405).json({ error: "Method not allowed" });
};
