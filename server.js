const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database setup ---
const db = new Database(path.join(__dirname, 'silverthin.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
  );

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
  );
`);

// Seed if empty
const count = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
if (count === 0) {
  const seedPath = path.join(__dirname, 'seed-data.json');
  if (fs.existsSync(seedPath)) {
    const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    const insert = db.prepare(`
      INSERT INTO projects (id, rep, dateStarted, customer, distributor, application, productType, partNumber, quoteNumber, eau, opportunitySize, city, state, country, closeDate, competitor, lastVisit, confidence, status, "update")
      VALUES (@id, @rep, @dateStarted, @customer, @distributor, @application, @productType, @partNumber, @quoteNumber, @eau, @opportunitySize, @city, @state, @country, @closeDate, @competitor, @lastVisit, @confidence, @status, @update)
    `);
    const tx = db.transaction((rows) => {
      for (const row of rows) insert.run(row);
    });
    tx(data);
    console.log(`Seeded ${data.length} projects`);
  }
}

// --- API Routes ---

// GET all projects
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY id').all();
  res.json(projects);
});

// GET single project
app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

// POST new project
app.post('/api/projects', (req, res) => {
  const p = req.body;
  const result = db.prepare(`
    INSERT INTO projects (rep, dateStarted, customer, distributor, application, productType, partNumber, quoteNumber, eau, opportunitySize, city, state, country, closeDate, competitor, lastVisit, confidence, status, "update")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.rep || '', p.dateStarted || '', p.customer || '', p.distributor || '',
    p.application || '', p.productType || 'Thin Section', p.partNumber || '',
    p.quoteNumber || '', p.eau || '', p.opportunitySize || 0, p.city || '',
    p.state || '', p.country || 'USA', p.closeDate || '', p.competitor || '',
    p.lastVisit || '', p.confidence || '', p.status || '1. New Opportunity',
    p.update || ''
  );
  const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PUT update project (with history tracking)
app.put('/api/projects/:id', (req, res) => {
  const id = req.params.id;
  const old = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!old) return res.status(404).json({ error: 'Not found' });

  const p = req.body;
  const now = new Date().toISOString().split('T')[0];

  const tx = db.transaction(() => {
    // Record history
    db.prepare(`
      INSERT INTO history (projectId, date, prevStatus, newStatus, prevUpdate, newUpdate, prevConfidence, newConfidence, changedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, now, old.status, p.status, old.update, p.update, old.confidence, p.confidence, p.changedBy || '');

    // Update project
    db.prepare(`
      UPDATE projects SET rep=?, dateStarted=?, customer=?, distributor=?, application=?, productType=?, partNumber=?, quoteNumber=?, eau=?, opportunitySize=?, city=?, state=?, country=?, closeDate=?, competitor=?, lastVisit=?, confidence=?, status=?, "update"=?
      WHERE id=?
    `).run(
      p.rep || '', p.dateStarted || '', p.customer || '', p.distributor || '',
      p.application || '', p.productType || '', p.partNumber || '',
      p.quoteNumber || '', p.eau || '', p.opportunitySize || 0, p.city || '',
      p.state || '', p.country || '', p.closeDate || '', p.competitor || '',
      p.lastVisit || '', p.confidence || '', p.status || '', p.update || '',
      id
    );
  });
  tx();

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json(updated);
});

// GET history for a project
app.get('/api/projects/:id/history', (req, res) => {
  const history = db.prepare('SELECT * FROM history WHERE projectId = ? ORDER BY id').all(req.params.id);
  res.json(history);
});

// POST reset to seed data
app.post('/api/reset', (req, res) => {
  const seedPath = path.join(__dirname, 'seed-data.json');
  if (!fs.existsSync(seedPath)) return res.status(500).json({ error: 'No seed data' });

  const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  const tx = db.transaction(() => {
    db.exec('DELETE FROM history');
    db.exec('DELETE FROM projects');
    const insert = db.prepare(`
      INSERT INTO projects (id, rep, dateStarted, customer, distributor, application, productType, partNumber, quoteNumber, eau, opportunitySize, city, state, country, closeDate, competitor, lastVisit, confidence, status, "update")
      VALUES (@id, @rep, @dateStarted, @customer, @distributor, @application, @productType, @partNumber, @quoteNumber, @eau, @opportunitySize, @city, @state, @country, @closeDate, @competitor, @lastVisit, @confidence, @status, @update)
    `);
    for (const row of data) insert.run(row);
  });
  tx();
  res.json({ message: 'Reset complete', count: data.length });
});

// Serve frontend for all non-API routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Silverthin Tracker running at http://localhost:${PORT}`);
});
