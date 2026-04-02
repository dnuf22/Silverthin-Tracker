// Run this once to create tables and seed data into your Turso database.
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node seed.js

const { createClient } = require("@libsql/client");
const seedData = require("./seed-data.json");

async function main() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Creating tables...");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rep TEXT NOT NULL DEFAULT '',
      dateStarted TEXT DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      distributor TEXT DEFAULT '',
      application TEXT DEFAULT '',
      productType TEXT DEFAULT 'Thin Section',
      partNumber TEXT DEFAULT '',
      quoteNumber TEXT DEFAULT '',
      eau TEXT DEFAULT '',
      opportunitySize REAL DEFAULT 0,
      city TEXT DEFAULT '',
      state TEXT DEFAULT '',
      country TEXT DEFAULT 'USA',
      closeDate TEXT DEFAULT '',
      competitor TEXT DEFAULT '',
      lastVisit TEXT DEFAULT '',
      confidence TEXT DEFAULT '',
      status TEXT DEFAULT '1. New Opportunity',
      "update" TEXT DEFAULT ''
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId INTEGER NOT NULL,
      date TEXT NOT NULL,
      prevStatus TEXT,
      newStatus TEXT,
      prevUpdate TEXT,
      newUpdate TEXT,
      prevConfidence TEXT,
      newConfidence TEXT,
      changedBy TEXT DEFAULT '',
      FOREIGN KEY (projectId) REFERENCES projects(id)
    )
  `);

  // Check if already seeded
  const count = await db.execute("SELECT COUNT(*) as c FROM projects");
  if (count.rows[0].c > 0) {
    console.log(`Database already has ${count.rows[0].c} projects. Skipping seed.`);
    console.log("To re-seed, run: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node seed.js --force");
    if (!process.argv.includes("--force")) return;
    console.log("--force flag detected. Clearing and re-seeding...");
    await db.execute("DELETE FROM history");
    await db.execute("DELETE FROM projects");
  }

  console.log(`Seeding ${seedData.length} projects...`);
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

  console.log("Done! Database seeded successfully.");
}

main().catch(console.error);
