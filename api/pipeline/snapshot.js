const { getDb } = require("../db");

const EXCLUDED = ["7. On Hold", "8. Closed Lost", "9. Closed Won"];

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { date, rep } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
  }

  const db = getDb();

  const result = await db.execute({
    sql: `SELECT
            p.id,
            p.rep,
            p.status AS currentStatus,
            p.opportunitySize AS currentSize,
            (SELECT h.newStatus
             FROM history h
             WHERE h.projectId = p.id AND h.date <= ?
             ORDER BY h.date DESC, h.id DESC
             LIMIT 1) AS snapshotStatus,
            (SELECT h.newOpportunitySize
             FROM history h
             WHERE h.projectId = p.id AND h.date <= ? AND h.newOpportunitySize IS NOT NULL
             ORDER BY h.date DESC, h.id DESC
             LIMIT 1) AS snapshotSize
          FROM projects p
          WHERE p.dateStarted <= ?`,
    args: [date, date, date],
  });

  let rows = result.rows.map(r => ({
    rep: r.rep,
    status: r.snapshotStatus || r.currentStatus,
    size: r.snapshotSize != null ? Number(r.snapshotSize) : Number(r.currentSize) || 0,
  })).filter(r => !EXCLUDED.includes(r.status));

  if (rep) {
    rows = rows.filter(r => r.rep === rep);
  }

  // Aggregate by rep
  const repMap = {};
  rows.forEach(r => {
    if (!repMap[r.rep]) repMap[r.rep] = { rep: r.rep, value: 0, count: 0 };
    repMap[r.rep].value += r.size;
    repMap[r.rep].count++;
  });
  const byRep = Object.values(repMap).filter(r => r.value > 0).sort((a, b) => b.value - a.value);

  // Aggregate by stage
  const stageMap = {};
  rows.forEach(r => {
    if (!stageMap[r.status]) stageMap[r.status] = { status: r.status, value: 0, count: 0 };
    stageMap[r.status].value += r.size;
    stageMap[r.status].count++;
  });
  const byStage = Object.values(stageMap);

  const totalValue = rows.reduce((sum, r) => sum + r.size, 0);

  return res.json({ date, totalValue, byRep, byStage });
};
