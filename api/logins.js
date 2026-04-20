const { getLoginLog } = require("./db");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const log = await getLoginLog();
    return res.json(log);
  } catch (e) {
    return res.status(500).json({ error: "Failed to fetch login log" });
  }
};
