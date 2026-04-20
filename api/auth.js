const { initPasswords, getCorrectPassword, logLogin } = require("./db");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { rep, password } = req.body || {};
  if (!rep || !password) return res.status(400).json({ ok: false, error: "Missing fields" });

  await initPasswords();
  const correct = await getCorrectPassword(rep);

  if (!correct) return res.status(401).json({ ok: false });
  const ok = password === correct;
  if (ok) await logLogin(rep);
  return res.json({ ok });
};
