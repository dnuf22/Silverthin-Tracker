# Pipeline Month Comparison — Design Spec

**Date:** 2026-05-11  
**Status:** Approved

---

## Overview

Add a month-over-month comparison overlay to the Pipeline view. A manager selects any past month via a dropdown; amber outline bars appear on top of the current filled bars in both the Pipeline Funnel and the Opportunities by Rep chart. Total pipeline value for both months is shown as simple text below the funnel with a green/red delta badge.

---

## Scope

**In scope:**
- Month selector dropdown (pipeline view only, manager and rep)
- Amber outline overlay on the Opportunities by Rep bar chart
- Amber outline overlay on each Pipeline Funnel stage segment
- Total pipeline value for current and selected month below the funnel (with delta badge)
- Legend under each chart labeling current vs. comparison month
- New `/api/pipeline/snapshot` backend endpoint
- Record `opportunitySize` in history entries going forward (PUT handler + project creation)
- Initial history entry written when a new project is created

**Out of scope:**
- Kanban card-level comparison
- Backfilling opportunity size into existing history rows
- Comparison in list view

---

## Data Layer

### History table extension

Add two new nullable columns to the `history` table:

```sql
ALTER TABLE history ADD COLUMN prevOpportunitySize REAL;
ALTER TABLE history ADD COLUMN newOpportunitySize  REAL;
```

These are `NULL` for all existing rows (pre-deployment). The snapshot endpoint treats `NULL` as "no recorded size change" and falls back to the project's current `opportunitySize`.

### Project creation: initial history entry

When `POST /api/projects` creates a new project, immediately write an initial history row:

```
projectId = <new id>
date      = today
prevStatus = ""  (empty — project didn't exist before)
newStatus  = "1. New Opportunity"
prevOpportunitySize = 0
newOpportunitySize  = <project.opportunitySize>
changedBy  = <rep or manager>
```

This ensures a project's original size is always recoverable from history.

### PUT handler update (`api/projects/[id].js`)

Extend the existing `INSERT INTO history` to include the two new columns:

```js
INSERT INTO history
  (projectId, date, prevStatus, newStatus,
   prevUpdate, newUpdate, prevConfidence, newConfidence,
   prevOpportunitySize, newOpportunitySize, changedBy)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

---

## New API Endpoint

### `GET /api/pipeline/snapshot?date=YYYY-MM-DD`

Returns pipeline state reconstructed as of the given date (inclusive — i.e. end-of-day on that date).

**Query logic:**

1. Fetch all projects where `dateStarted <= ?date`.
2. For each project, find the last history row where `history.date <= ?date`:
   - Use `newStatus` from that row as the project's status at the snapshot date.
   - Use `newOpportunitySize` from that row as its size — fall back to `project.opportunitySize` if the column is `NULL` (pre-deployment row) or no history row exists before the date.
3. Exclude projects whose resolved status is `"8. Closed Lost"`, `"7. On Hold"`, or `"9. Closed Won"`.
4. Compute two aggregations:

**Response shape:**
```json
{
  "date": "2026-04-30",
  "totalValue": 12220511,
  "byRep": [
    { "rep": "SemiAero", "value": 3610000, "count": 28 }
  ],
  "byStage": [
    { "status": "2. Quoting", "value": 5200000, "count": 16 }
  ]
}
```

**Available months dropdown:**  
A second endpoint (or the same endpoint with `?months=true`) returns the list of distinct year-month values present in the history table so the frontend can populate the selector. Only months before the current calendar month are shown.

---

## Frontend Changes (`public/index.html`)

### New state

```js
const [compareMonth, setCompareMonth] = useState(null);   // "2026-04" or null
const [compareData, setCompareData] = useState(null);      // snapshot API response
const [compareLoading, setCompareLoading] = useState(false);
const [availableMonths, setAvailableMonths] = useState([]); // ["2026-04", "2026-03", ...]
```

### Month selector (pipeline view only)

A "Compare to" row rendered inside the pipeline view block, above the charts:

```
[ Compare to ]  [ April 2026 ▾ ]  [ ● Overlay active ]     Amber outline = April 2026 values
```

- Populated from `availableMonths` fetched on pipeline view mount.
- On change: fetch `/api/pipeline/snapshot?date=<last-day-of-month>`, store in `compareData`.
- A "Clear" option resets `compareMonth` and `compareData` to null.
- When `compareData` is null the charts render exactly as they do today.

### Opportunities by Rep chart

When `compareData` is set:

1. Build `prevByRep` map from `compareData.byRep`.
2. Scale `maxRepVal = Math.max(maxCurrentVal, maxPrevVal)` so both months fit on the same axis.
3. Change bar track `overflow` from `"hidden"` to `"visible"` (so amber outline can extend beyond when previous > current).
4. For each rep row, render the amber outline bar **after** the blue filled bar (higher z-index, `pointer-events: none`):
   ```jsx
   <div style={{
     width: `${(prevVal / maxRepVal) * 100}%`,
     height: "100%",
     border: "2px solid #F59E0B",
     borderRadius: 4,
     position: "absolute", top: 0, left: 0,
     background: "transparent",
     boxSizing: "border-box",
     pointerEvents: "none",
   }} />
   ```
5. Add legend row beneath the chart: `■ Current (May 2026)` · `□ April 2026`.

### Pipeline Funnel

When `compareData` is set:

1. Build `prevByStage` map from `compareData.byStage`.
2. Compute `maxFunnelVal = Math.max(maxCurrentStageVal, maxPrevStageVal)` for consistent sqrt scaling.
3. For each stage, compute `prevWidthPct` using the same sqrt formula as current widths.
4. Render an absolutely positioned amber outline `<div>` inside each stage `<div>`:
   ```jsx
   <div style={{
     position: "absolute", top: 0,
     left: "50%", transform: "translateX(-50%)",
     width: `${prevWidthPct / currentWidthPct * 100}%`,
     height: "100%",
     border: "2px solid #F59E0B",
     borderRadius: "inherit",
     background: "transparent",
     pointerEvents: "none",
     opacity: 0.75,
   }} />
   ```
   The width is expressed as a percentage of the stage div's own width (since the stage div is already sized to `currentWidthPct`).

### Totals block (below funnel)

Rendered between the last funnel stage and the legend when `compareData` is set:

```
[■ blue]  May 2026    $13,651,797   [▲ +$1,431,286]
[□ amber] April 2026  $12,220,511
```

- Current total = sum of `pipe` (already computed).
- Previous total = `compareData.totalValue`.
- Delta = current − previous; green badge if positive (▲), red badge if negative (▼).

---

## Available Months Logic

The dropdown should show only months for which the snapshot reconstruction would return meaningful data — i.e. months where at least one history row exists. A simple approach:

```sql
SELECT DISTINCT substr(date, 1, 7) AS ym
FROM history
WHERE date < substr(date('now'), 1, 7)   -- exclude current month
ORDER BY ym DESC
```

If no history rows exist yet for a month, the snapshot falls back entirely to current project states — still useful but noted. The dropdown shows a maximum of 24 months.

---

## Limitations

- Opportunity sizes for projects that existed before deployment and were never updated after deployment will use their current size as a proxy for historical size. This is a one-time limitation that resolves naturally as data accumulates.
- The month selector only appears to users in pipeline view (both manager and rep).

---

## File Checklist

| File | Change |
|------|--------|
| `api/db.js` | Add `initHistory()` helper that ALTERs table to add new columns if missing |
| `api/projects.js` | Write initial history entry on project creation |
| `api/projects/[id].js` | Add `prevOpportunitySize` / `newOpportunitySize` to history INSERT |
| `api/pipeline/snapshot.js` | New endpoint — reconstruct pipeline state for a given date |
| `api/pipeline/months.js` | New endpoint — return list of available comparison months |
| `public/index.html` | Month selector, overlay rendering, totals block |
