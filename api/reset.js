const { getDb } = require("./db");
const seedData = require("../seed-data.json");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const db = getDb();

  await db.execute("DELETE FROM history");
  await db.execute("DELETE FROM projects");

  for (const row of seedData) {
    await db.execute({
      sql: `INSERT INTO projects (id, rep, dateStarted, customer, distributor, application, productType, partNumber, quoteNumber, eau, opportunitySize, city, state, country, closeDate, competitor, lastVisit, confidence, status, "update")
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        row.id, row.rep, row.dateStarted, row.customer, row.distributor,
        row.application, row.productType, row.partNumber, row.quoteNumber,
        row.eau, row.opportunitySize, row.city, row.state, row.country,
        row.closeDate, row.competitor, row.lastVisit, row.confidence,
        row.status, row.update,
      ],
    });
  }

  res.json({ message: "Reset complete", count: seedData.length });
};
