const { createClient } = require("@libsql/client");

let db;

function getDb() {
  if (!db) {
    db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return db;
}

async function initPasswords() {
  const db = getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS rep_passwords (rep TEXT PRIMARY KEY, password TEXT NOT NULL)`
  );
}

// Returns the correct password for a rep/manager: DB custom password takes priority, then env var default.
async function getCorrectPassword(rep) {
  const db = getDb();
  const result = await db.execute({ sql: "SELECT password FROM rep_passwords WHERE rep = ?", args: [rep] });
  if (result.rows.length > 0) return result.rows[0].password;

  if (rep === "__manager__") return process.env.MANAGER_PASS || null;
  const key = "REP_PASS_" + rep.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return process.env[key] || null;
}

module.exports = { getDb, initPasswords, getCorrectPassword };
