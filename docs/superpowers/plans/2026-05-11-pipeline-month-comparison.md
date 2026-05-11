# Pipeline Month Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month-selector to the pipeline view that overlays amber outline bars on the funnel and rep chart showing a historical month's values, plus a total pipeline comparison with delta badge.

**Architecture:** Extend the existing Turso `history` table with two new nullable columns for opportunity size; new Vercel serverless functions reconstruct pipeline state for any past date by replaying history; the React frontend fetches that snapshot and renders amber outline overlays without changing the existing chart layout.

**Tech Stack:** Node.js Vercel serverless functions, `@libsql/client` (Turso/libsql), React 18 (CDN, no build step), inline styles throughout.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `api/db.js` | Modify | Add `initHistory()` — ALTER TABLE to add size columns |
| `api/projects/[id].js` | Modify | Pass prev/new size to history INSERT; call `initHistory()` |
| `api/projects.js` | Modify | Write initial history row after project creation |
| `api/pipeline/months.js` | Create | Return list of distinct year-months available for comparison |
| `api/pipeline/snapshot.js` | Create | Reconstruct pipeline state as of a given date |
| `public/index.html` | Modify | Month selector state, compare bar, overlay rendering, totals block |

---

## Task 1: Add `initHistory()` to `api/db.js`

**Files:**
- Modify: `api/db.js`

This helper safely adds the two new columns to the `history` table. SQLite has no `ADD COLUMN IF NOT EXISTS`, so each ALTER is wrapped in its own try/catch — an error means the column already exists, which is fine.

- [ ] **Step 1: Add `initHistory` to `api/db.js`**

Open `api/db.js`. After the `getLoginLog` function and before `module.exports`, add:

```js
async function initHistory() {
  const db = getDb();
  try {
    await db.execute(`ALTER TABLE history ADD COLUMN prevOpportunitySize REAL`);
  } catch (_) {}
  try {
    await db.execute(`ALTER TABLE history ADD COLUMN newOpportunitySize REAL`);
  } catch (_) {}
}
```

- [ ] **Step 2: Export `initHistory`**

Change the final line of `api/db.js` from:
```js
module.exports = { getDb, initPasswords, getCorrectPassword, logLogin, getLoginLog };
```
to:
```js
module.exports = { getDb, initPasswords, getCorrectPassword, logLogin, getLoginLog, initHistory };
```

- [ ] **Step 3: Verify by running the migration manually**

In the project root, run:
```bash
node -e "require('./api/db').initHistory().then(()=>console.log('ok')).catch(console.error)"
```
Expected output: `ok`

Run it a second time to confirm idempotency:
```bash
node -e "require('./api/db').initHistory().then(()=>console.log('ok')).catch(console.error)"
```
Expected output: `ok` (no error — duplicate ALTER is swallowed)

- [ ] **Step 4: Commit**

```bash
git add api/db.js
git commit -m "feat: add initHistory() to safely migrate history table with size columns"
```

---

## Task 2: Capture opportunity size in the PUT history entry

**Files:**
- Modify: `api/projects/[id].js`

Every time a project is updated, the existing PUT handler already inserts a history row. We add the two size columns to that INSERT.

- [ ] **Step 1: Import `initHistory` at the top of `api/projects/[id].js`**

Change:
```js
const { getDb } = require("../db");
```
to:
```js
const { getDb, initHistory } = require("../db");
```

- [ ] **Step 2: Call `initHistory()` before the database reads**

In the `PUT` branch, before the `const old = await db.execute(...)` line, add:
```js
await initHistory();
```

- [ ] **Step 3: Add size values to the history INSERT**

Replace the existing `INSERT INTO history` execute call:
```js
await db.execute({
  sql: `INSERT INTO history (projectId, date, prevStatus, newStatus, prevUpdate, newUpdate, prevConfidence, newConfidence, changedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [id, now, prev.status, p.status, prev.update, p.update, prev.confidence, p.confidence, p.changedBy || ""],
});
```
with:
```js
await db.execute({
  sql: `INSERT INTO history (projectId, date, prevStatus, newStatus, prevUpdate, newUpdate, prevConfidence, newConfidence, prevOpportunitySize, newOpportunitySize, changedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    id, now,
    prev.status, p.status,
    prev.update, p.update,
    prev.confidence, p.confidence,
    Number(prev.opportunitySize) || 0,
    Number(p.opportunitySize) || 0,
    p.changedBy || "",
  ],
});
```

- [ ] **Step 4: Test with curl — update a project and verify history row**

```bash
# Replace 1 with any real project id in your DB
curl -s -X PUT http://localhost:3000/api/projects/1 \
  -H "Content-Type: application/json" \
  -d '{"rep":"SemiAero","customer":"Test","opportunitySize":99999,"status":"2. Quoting","confidence":"High","update":"test","changedBy":"test"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Then verify the history row was written with size columns:
```bash
curl -s http://localhost:3000/api/projects/1/history \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const h=JSON.parse(d);console.log(h[h.length-1])})"
```
Expected: last history entry has `prevOpportunitySize` and `newOpportunitySize` fields (not null).

- [ ] **Step 5: Commit**

```bash
git add "api/projects/[id].js"
git commit -m "feat: capture prevOpportunitySize/newOpportunitySize in history on project update"
```

---

## Task 3: Write initial history entry on project creation

**Files:**
- Modify: `api/projects.js`

When a project is first created, we write a history row with `prevOpportunitySize: 0` and `newOpportunitySize: <initial value>`. This makes the creation event recoverable in snapshot queries.

- [ ] **Step 1: Import `initHistory` in `api/projects.js`**

Change:
```js
const { getDb } = require("./db");
```
to:
```js
const { getDb, initHistory } = require("./db");
```

- [ ] **Step 2: Call `initHistory()` and write the initial history row**

In the `POST` branch, after the `const created = await db.execute(...)` call and before `return res.status(201).json(...)`, add:

```js
await initHistory();
const newId = Number(result.lastInsertRowid);
const today = new Date().toISOString().split("T")[0];
await db.execute({
  sql: `INSERT INTO history (projectId, date, prevStatus, newStatus, prevUpdate, newUpdate, prevConfidence, newConfidence, prevOpportunitySize, newOpportunitySize, changedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    newId, today,
    "", p.status || "1. New Opportunity",
    "", p.update || "",
    "", p.confidence || "",
    0,
    Number(p.opportunitySize) || 0,
    p.changedBy || p.rep || "",
  ],
});
```

- [ ] **Step 3: Test — create a project and verify initial history row exists**

```bash
curl -s -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"rep":"Scot","customer":"NewCo","opportunitySize":50000,"status":"1. New Opportunity","confidence":"Medium","update":"","dateStarted":"2026-05-11"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);console.log('created id:',p.id)})"
```

Fetch history for the new project id (replace `<id>` with value from above):
```bash
curl -s http://localhost:3000/api/projects/<id>/history \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```
Expected: one entry with `prevStatus: ""`, `newStatus: "1. New Opportunity"`, `newOpportunitySize: 50000`.

- [ ] **Step 4: Commit**

```bash
git add api/projects.js
git commit -m "feat: write initial history entry (with opportunity size) when project is created"
```

---

## Task 4: Create `/api/pipeline/months.js`

**Files:**
- Create: `api/pipeline/months.js`

Returns the list of year-month strings (e.g. `["2026-04","2026-03"]`) available as comparison targets — distinct months present in history, excluding the current month, newest first, up to 24.

- [ ] **Step 1: Create `api/pipeline/months.js`**

```js
const { getDb } = require("../db");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const db = getDb();
  const result = await db.execute({
    sql: `SELECT DISTINCT substr(date, 1, 7) AS ym
          FROM history
          WHERE substr(date, 1, 7) < substr(date('now'), 1, 7)
          ORDER BY ym DESC
          LIMIT 24`,
    args: [],
  });

  const months = result.rows.map(r => r.ym).filter(Boolean);
  return res.json(months);
};
```

- [ ] **Step 2: Test the endpoint**

```bash
curl -s http://localhost:3000/api/pipeline/months
```
Expected: a JSON array of year-month strings like `["2026-04","2026-03"]`, or `[]` if no history yet. Must not include the current month.

- [ ] **Step 3: Commit**

```bash
git add api/pipeline/months.js
git commit -m "feat: add /api/pipeline/months endpoint for available comparison months"
```

---

## Task 5: Create `/api/pipeline/snapshot.js`

**Files:**
- Create: `api/pipeline/snapshot.js`

Reconstructs pipeline state as of a given date. Accepts `?date=YYYY-MM-DD` and optional `?rep=RepName`. Returns `{ date, totalValue, byRep, byStage }`.

The query finds, for each project that existed on or before the snapshot date:
- its status as of that date (last history `newStatus` on or before date, else current status)
- its opportunity size as of that date (last history `newOpportunitySize` that is not null on or before date, else current `opportunitySize`)

Projects in "Closed Lost", "On Hold", or "Closed Won" are excluded.

- [ ] **Step 1: Create `api/pipeline/snapshot.js`**

```js
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
```

- [ ] **Step 2: Test the endpoint with a known past date**

```bash
# Use a date in the past that has at least some projects
curl -s "http://localhost:3000/api/pipeline/snapshot?date=2026-04-30"
```
Expected: JSON with `date`, `totalValue` (a number), `byRep` (array), `byStage` (array).

Test with a rep filter:
```bash
curl -s "http://localhost:3000/api/pipeline/snapshot?date=2026-04-30&rep=SemiAero"
```
Expected: only SemiAero appears in `byRep`.

Test with invalid date:
```bash
curl -s "http://localhost:3000/api/pipeline/snapshot?date=bad"
```
Expected: `{"error":"date query param required (YYYY-MM-DD)"}` with status 400.

- [ ] **Step 3: Commit**

```bash
git add api/pipeline/snapshot.js
git commit -m "feat: add /api/pipeline/snapshot endpoint for historical pipeline reconstruction"
```

---

## Task 6: Frontend — state, compare bar, and month fetch

**Files:**
- Modify: `public/index.html` (pipeline view section, state declarations)

Add the four new state variables, the `loadCompare` function, the `useEffect` that loads available months, a second `useEffect` that re-fetches when `repFilter` changes while a comparison month is active, and the "Compare to" control rendered above the pipeline charts.

- [ ] **Step 1: Add state variables**

Inside the `App` function, after the existing `const [loginLog, setLoginLog] = useState([]);` line, add:

```js
const [compareMonth, setCompareMonth] = useState(null);
const [compareData, setCompareData] = useState(null);
const [compareLoading, setCompareLoading] = useState(false);
const [availableMonths, setAvailableMonths] = useState([]);
```

- [ ] **Step 2: Add `loadCompare` function**

After the state declarations, add this function (before the `if(loading)` line):

```js
const loadCompare = async (month, rep) => {
  if (!month) { setCompareData(null); setCompareMonth(null); return; }
  setCompareLoading(true);
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).toISOString().split('T')[0];
  const repParam = rep && rep !== "__all__" ? `&rep=${encodeURIComponent(rep)}` : '';
  try {
    const r = await fetch(`${API}/pipeline/snapshot?date=${lastDay}${repParam}`);
    const d = await r.json();
    setCompareData(d);
    setCompareMonth(month);
  } catch (_) {}
  setCompareLoading(false);
};
```

- [ ] **Step 3: Add useEffect to load available months when entering pipeline view**

After the existing `useEffect` that loads login history, add:

```js
useEffect(() => {
  if (view === "pipeline" && availableMonths.length === 0) {
    fetch(API + '/pipeline/months')
      .then(r => r.json())
      .then(data => setAvailableMonths(Array.isArray(data) ? data : []))
      .catch(() => {});
  }
}, [view]);
```

- [ ] **Step 4: Add useEffect to re-fetch comparison when repFilter changes**

After the effect above, add:

```js
useEffect(() => {
  if (compareMonth) loadCompare(compareMonth, repFilter);
}, [repFilter]);
```

- [ ] **Step 5: Add the compare bar above the pipeline charts**

In the pipeline view block, find this line (it starts the charts row):
```js
<div style={{display:"flex",gap:24,marginBottom:24,flexWrap:"wrap"}}>
```

Insert the compare bar **immediately before** that line:

```jsx
<div style={{display:"flex",alignItems:"center",gap:10,background:"#0F172A",border:"1px solid #334155",borderRadius:8,padding:"7px 14px",marginBottom:12,flexWrap:"wrap"}}>
  <span style={{fontSize:11,color:"#64748B",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",whiteSpace:"nowrap"}}>Compare to</span>
  <select
    value={compareMonth||""}
    onChange={e=>loadCompare(e.target.value||null,repFilter)}
    style={{background:"#1E293B",border:"1px solid #334155",color:compareMonth?"#F59E0B":"#94A3B8",padding:"4px 10px",borderRadius:6,fontSize:13,fontWeight:600}}
  >
    <option value="">— off —</option>
    {availableMonths.map(ym=>{
      const [y,m]=ym.split('-');
      const label=new Date(Number(y),Number(m)-1).toLocaleString('en-US',{month:'long',year:'numeric'});
      return <option key={ym} value={ym}>{label}</option>;
    })}
  </select>
  {compareLoading&&<span style={{fontSize:11,color:"#64748B"}}>Loading...</span>}
  {compareMonth&&!compareLoading&&<div style={{background:"#451A03",border:"1px solid #F59E0B",color:"#F59E0B",padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
    <div style={{width:6,height:6,borderRadius:"50%",border:"1.5px solid #F59E0B"}}/>
    Overlay active
  </div>}
  {compareMonth&&!compareLoading&&<span style={{marginLeft:"auto",fontSize:11,color:"#475569"}}>Amber outline = {new Date(Number(compareMonth.split('-')[0]),Number(compareMonth.split('-')[1])-1).toLocaleString('en-US',{month:'long',year:'numeric'})} values</span>}
</div>
```

- [ ] **Step 6: Verify in browser**

Open the app, sign in as Manager, switch to Pipeline view. Confirm:
- "Compare to — off —" dropdown appears above the charts
- Selecting a month (if history rows exist) triggers a network call to `/api/pipeline/snapshot?date=...`
- "Overlay active" badge appears after selection
- "— off —" clears the badge

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: add pipeline compare-month selector with state and month loader"
```

---

## Task 7: Frontend — amber overlay on the Opportunities by Rep chart

**Files:**
- Modify: `public/index.html` (rep bar chart IIFE, lines ~368–397)

- [ ] **Step 1: Build `prevByRep` map and expand `maxRepVal`**

Inside the IIFE that renders the rep chart, replace:
```js
const maxRepVal = Math.max(...repData.map(r=>r.value),1);
```
with:
```js
const prevByRep = compareData
  ? Object.fromEntries((compareData.byRep||[]).map(r=>[r.rep,r]))
  : {};
const maxRepVal = Math.max(
  ...repData.map(r=>r.value),
  ...(compareData ? (compareData.byRep||[]).map(r=>r.value) : []),
  1
);
```

- [ ] **Step 2: Change bar track `overflow` and make fill bar absolutely positioned**

Replace the bar track + fill div block:
```jsx
<div style={{background:"#0F172A",borderRadius:4,height:20,overflow:"hidden",position:"relative"}}>
  <div style={{
    width:`${(r.value/maxRepVal)*100}%`,
    height:"100%",
    background:"linear-gradient(90deg, #3B82F6, #60A5FA)",
    borderRadius:4,
    transition:"width .3s ease",
    display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6,
  }}>
    <span style={{fontSize:10,color:"#fff",fontWeight:600,whiteSpace:"nowrap"}}>{r.count} proj</span>
  </div>
</div>
```
with:
```jsx
<div style={{background:"#0F172A",borderRadius:4,height:20,overflow:"visible",position:"relative",border:"1px solid #1E293B"}}>
  <div style={{
    width:`${(r.value/maxRepVal)*100}%`,
    height:"100%",
    background:"linear-gradient(90deg, #3B82F6, #60A5FA)",
    borderRadius:4,
    transition:"width .3s ease",
    position:"absolute",top:0,left:0,
    display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:6,
  }}>
    <span style={{fontSize:10,color:"#fff",fontWeight:600,whiteSpace:"nowrap"}}>{r.count} proj</span>
  </div>
  {compareData&&prevByRep[r.rep]&&<div style={{
    width:`${((prevByRep[r.rep]?.value||0)/maxRepVal)*100}%`,
    height:"100%",
    border:"2px solid #F59E0B",
    borderRadius:4,
    position:"absolute",top:0,left:0,
    background:"transparent",
    boxSizing:"border-box",
    pointerEvents:"none",
  }}/>}
</div>
```

- [ ] **Step 3: Add legend below the bar chart**

Find the closing `</div>` of the rep chart `<div style={{display:"flex",flexDirection:"column",gap:6}}>` list, and after it (but still inside the panel div) add:

```jsx
{compareData&&<div style={{display:"flex",gap:14,marginTop:10,flexWrap:"wrap"}}>
  <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#94A3B8"}}>
    <div style={{width:18,height:9,borderRadius:2,background:"linear-gradient(90deg,#3B82F6,#60A5FA)"}}/>
    Current ({new Date().toLocaleString('en-US',{month:'short',year:'numeric'})})
  </div>
  <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#94A3B8"}}>
    <div style={{width:18,height:9,borderRadius:2,border:"2px solid #F59E0B",background:"transparent"}}/>
    {new Date(Number(compareMonth.split('-')[0]),Number(compareMonth.split('-')[1])-1).toLocaleString('en-US',{month:'long',year:'numeric'})}
  </div>
</div>}
```

- [ ] **Step 4: Verify in browser**

With a comparison month selected, confirm:
- Amber outline bars appear for reps that have previous-month data
- A rep with growth shows blue bar extending past amber outline
- A rep with decline shows amber outline extending past blue bar
- Scale accommodates both current and previous maximums (no bar overflows visually)
- Legend appears only when comparison is active

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add amber overlay and legend to Opportunities by Rep chart"
```

---

## Task 8: Frontend — funnel overlay, totals block, and funnel legend

**Files:**
- Modify: `public/index.html` (funnel section, lines ~225–366)

- [ ] **Step 1: Build `prevByStage` map and expand `maxFunnelVal`**

Find the two lines:
```js
const maxFunnelVal = Math.max(...pipe.map(p=>p.value),1);
const funnelWidths = {};
pipe.forEach(s=>{funnelWidths[s.status] = s.value>0 ? Math.max(Math.sqrt(s.value/maxFunnelVal)*100, 20) : 20});
```

Replace with:
```js
const prevByStage = compareData
  ? Object.fromEntries((compareData.byStage||[]).map(s=>[s.status,s]))
  : {};
const maxFunnelVal = Math.max(
  ...pipe.map(p=>p.value),
  ...(compareData ? (compareData.byStage||[]).map(s=>s.value) : []),
  1
);
const funnelWidths = {};
pipe.forEach(s=>{funnelWidths[s.status] = s.value>0 ? Math.max(Math.sqrt(s.value/maxFunnelVal)*100, 20) : 20});
const prevFunnelWidths = {};
FUNNEL_STAGES.forEach(s=>{
  const pv = prevByStage[s]?.value||0;
  prevFunnelWidths[s] = pv>0 ? Math.max(Math.sqrt(pv/maxFunnelVal)*100, 20) : 0;
});
```

- [ ] **Step 2: Add amber outline ghost div inside each funnel stage**

Inside the funnel stage `<div>` (the one with `onClick`, `onMouseEnter`, etc.), after the tooltip `<div>` (the `isHovered&&!isActive&&<div...>` block), add:

```jsx
{compareData&&prevFunnelWidths[stage.status]>0&&<div style={{
  position:"absolute",top:0,
  left:"50%",transform:"translateX(-50%)",
  width:`${funnelWidths[stage.status]>0
    ? (prevFunnelWidths[stage.status]/funnelWidths[stage.status]*100)
    : prevFunnelWidths[stage.status]}%`,
  height:"100%",
  border:"2px solid #F59E0B",
  borderRadius:"inherit",
  background:"transparent",
  pointerEvents:"none",
  boxSizing:"border-box",
  opacity:0.75,
}}/>}
```

Note: the ghost div's `width` is expressed as a percentage of the stage div's own width (since the stage div is already sized to `funnelWidths[stage.status]%` of its parent). So `prevWidth / currentWidth * 100%` gives the correct proportion.

- [ ] **Step 3: Add totals block below the last funnel stage**

Find the line with the "Clear filter" button:
```jsx
{fStatus!=="__all__"&&FUNNEL_STAGES.includes(fStatus)&&<button onClick={()=>setFStatus("__all__")} ...>Clear filter</button>}
```

Before that line, add the totals block:

```jsx
{compareData&&(()=>{
  const curTotal=pipe.reduce((a,b)=>a+b.value,0);
  const prevTotal=compareData.totalValue||0;
  const delta=curTotal-prevTotal;
  const [cy,cm]=compareMonth.split('-').map(Number);
  const prevLabel=new Date(cy,cm-1).toLocaleString('en-US',{month:'long',year:'numeric'});
  const curLabel=new Date().toLocaleString('en-US',{month:'long',year:'numeric'});
  return <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
    <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
      <div style={{width:14,height:14,borderRadius:3,background:"linear-gradient(90deg,#3B82F6,#60A5FA)",flexShrink:0}}/>
      <span style={{color:"#94A3B8",fontWeight:500}}>{curLabel}</span>
      <span style={{color:"#F8FAFC",fontWeight:700}}>{fmt(curTotal)}</span>
      <span style={{fontSize:11,fontWeight:700,padding:"1px 7px",borderRadius:10,background:delta>=0?"#064E3B":"#450A0A",color:delta>=0?"#10B981":"#EF4444"}}>
        {delta>=0?"▲ +":"▼ "}{fmt(Math.abs(delta))}
      </span>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
      <div style={{width:14,height:14,borderRadius:3,border:"2px solid #F59E0B",background:"transparent",flexShrink:0,boxSizing:"border-box"}}/>
      <span style={{color:"#94A3B8",fontWeight:500}}>{prevLabel}</span>
      <span style={{color:"#F8FAFC",fontWeight:700}}>{fmt(prevTotal)}</span>
    </div>
  </div>;
})()}
```

- [ ] **Step 4: Add conditional legend below the funnel**

Find the existing funnel "Clear filter" button (or the end of the funnel panel div). After it, add a legend that shows only when comparison is active:

```jsx
{compareData&&<div style={{display:"flex",gap:14,marginTop:10,justifyContent:"center",flexWrap:"wrap"}}>
  <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#94A3B8"}}>
    <div style={{width:18,height:9,borderRadius:2,background:"linear-gradient(90deg,#3B82F6,#60A5FA)"}}/>
    Current ({new Date().toLocaleString('en-US',{month:'short',year:'numeric'})})
  </div>
  <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#94A3B8"}}>
    <div style={{width:18,height:9,borderRadius:2,border:"2px solid #F59E0B",background:"transparent"}}/>
    {new Date(Number(compareMonth.split('-')[0]),Number(compareMonth.split('-')[1])-1).toLocaleString('en-US',{month:'long',year:'numeric'})}
  </div>
</div>}
```

- [ ] **Step 5: Verify in browser**

With a comparison month selected:
- Amber outline segments appear on each funnel stage
- Stages where previous > current show outline extending beyond current width
- Totals block shows two rows with dollar values and green/red delta badge
- Legend shows below funnel
- Clearing the comparison (selecting "— off —") removes all overlays, totals, and legends

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add amber funnel overlay, totals block, and legends to pipeline view"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Confirm history migration is idempotent on a fresh deploy**

```bash
node -e "require('./api/db').initHistory().then(()=>console.log('pass')).catch(e=>console.error('FAIL',e))"
node -e "require('./api/db').initHistory().then(()=>console.log('pass')).catch(e=>console.error('FAIL',e))"
```
Both must print `pass`.

- [ ] **Step 2: Create a project, change its size, verify snapshot returns old size**

```bash
# Create project with size 10000
curl -s -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"rep":"Brad","customer":"SnapTest","opportunitySize":10000,"status":"2. Quoting","confidence":"High","update":"","dateStarted":"2026-04-01"}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('id:',JSON.parse(d).id))"
```

Note the id, then update size to 99000 (use the id from above):
```bash
curl -s -X PUT http://localhost:3000/api/projects/<id> \
  -H "Content-Type: application/json" \
  -d '{"rep":"Brad","customer":"SnapTest","opportunitySize":99000,"status":"2. Quoting","confidence":"High","update":"","changedBy":"test"}'
```

Now query snapshot for April 30 — should see size 10000, not 99000:
```bash
curl -s "http://localhost:3000/api/pipeline/snapshot?date=2026-04-30&rep=Brad" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```
Expected: `byRep` has `Brad` with value `10000`.

- [ ] **Step 3: Browser smoke test — full flow**

1. Sign in as Manager
2. Switch to Pipeline view
3. Confirm "Compare to — off —" dropdown is present
4. Select a past month
5. Confirm amber outlines appear on both funnel stages and rep bars
6. Confirm totals block appears below funnel with both values and a delta badge
7. Confirm legends appear under both charts
8. Change rep filter to a specific rep — confirm overlays update (network call made)
9. Select "— off —" — confirm all overlays, totals, and legends disappear

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: pipeline month comparison complete — overlay, totals, endpoints"
```
