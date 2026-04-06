const { getDb, initPasswords, getCorrectPassword } = require("./db");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { rep, currentPassword, newPassword } = req.body || {};
  if (!rep || !currentPassword || !newPassword)
    return res.status(400).json({ ok: false, error: "Missing fields" });
  if (newPassword.length < 6)
    return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });

  await initPasswords();
  const correct = await getCorrectPassword(rep);

  if (!correct || currentPassword !== correct)
    return res.status(401).json({ ok: false, error: "Current password is incorrect" });

  const db = getDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO rep_passwords (rep, password) VALUES (?, ?)",
    args: [rep, newPassword],
  });

  return res.json({ ok: true });
};
