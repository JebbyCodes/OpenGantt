// Turns parsed YAML (Gantt Tracker schema) into ts-gantt task models.

export function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  }
  const m = String(v).trim().replace(/^['"]|['"]$/g, "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function toDates(v) {
  if (v == null) return null;
  const list = (Array.isArray(v) ? v : [v]).map(toDate).filter(Boolean);
  return list.length ? list : null;
}

// Lower-case letters and digits only, so "Start planned", "start-planned" and "startPlanned" match.
export const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Row keys the chart already uses. Any other scalar key becomes a custom table column.
const KNOWN_KEYS = new Set(["label", "plan", "fact", "children", "notes"]);

function extraText(v) {
  if (v == null) return null;
  const d = v instanceof Date ? toDate(v) : null;
  if (d) return d.toISOString().slice(0, 10);
  if (Array.isArray(v)) {
    const parts = v.map(extraText).filter((x) => x != null);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function pickExtras(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (KNOWN_KEYS.has(k)) continue;
    const text = extraText(v);
    if (text != null) out[k] = text;
  }
  return out;
}

export function todayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function buildTasks(rows, today = todayUtc(), parentId = null, out = [], depth = 0) {
  rows.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const id = `${parentId ?? "r"}.${i}`;
    const name = String(row.label ?? "Untitled");
    const plan = toDates(row.plan);
    const fact = toDates(row.fact);

    const planStart = plan?.[0] ?? null;
    const planEnd = plan?.[1] ?? plan?.[0] ?? null;
    const factStart = fact?.[0] ?? null;
    // One-date actual (fact: [start]) runs from that date through today.
    const factEnd = factStart ? (fact.length > 1 ? fact[1] : today) : null;

    let progress = 0;
    if (factStart && fact.length > 1) progress = 100;
    else if (factStart && planStart && planEnd) {
      const total = Math.max(1, planEnd - planStart);
      progress = Math.max(0, Math.min(99, Math.round(((Math.min(today, planEnd) - planStart) / total) * 100)));
    }

    out.push({
      id,
      parentId,
      name,
      progress,
      datePlannedStart: planStart,
      datePlannedEnd: planEnd,
      dateActualStart: factStart,
      dateActualEnd: factEnd,
      // `fact: [start]` only: still in progress, drawn as the progress bar up to today.
      factOpen: !!factStart && fact.length === 1,
      localizedNames: { en: name },
      notes: row.notes != null ? String(row.notes) : "",
      extra: pickExtras(row), // other keys on the row, as text; offered as custom table columns
      depth,
      order: out.length, // position in the YAML; ts-gantt must keep this order
      hasChildren: Array.isArray(row.children) && row.children.some((c) => c && typeof c === "object"),
    });
    if (Array.isArray(row.children)) buildTasks(row.children, today, id, out, depth + 1);
  });
  return out;
}

const SCALES = ["day", "week", "month", "year"];
const MODES = { plan: "planned", planned: "planned", actual: "actual", fact: "actual", both: "both" };

// `columns: [progress, owner]`, `columns: progress, owner`, or `columns: none`. null = not given.
function readColumns(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v === false) return [];
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s.toLowerCase() === "none") return [];
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return null;
}

// `table: false` / `hidden` starts with the left table hidden. null = not given (use the saved choice).
function readTable(v) {
  if (v === false || ["hidden", "hide", "off", "no"].includes(String(v).toLowerCase())) return false;
  if (v === true || ["shown", "show", "on", "yes"].includes(String(v).toLowerCase())) return true;
  return null;
}

export function readBlockOptions(doc) {
  const scale = SCALES.includes(String(doc.scale)) ? String(doc.scale) : "day";
  const mode = MODES[String(doc.mode).toLowerCase()] ?? "both";
  const h = Number(doc.height);
  const height = Number.isFinite(h) ? Math.min(1600, Math.max(200, Math.round(h))) : 520;
  const p = Number(doc.padding);
  const padding = Number.isFinite(p) ? Math.min(365, Math.max(0, Math.round(p))) : 7;
  const collapsed = doc.collapsed === true || doc.startCollapsed === true;
  const title = doc.title != null && String(doc.title).trim() ? String(doc.title).trim() : null;
  return {
    scale, mode, height, padding, hatch: doc.hatch !== false, progress: doc.progress !== false, editable: doc.editable === true, collapsed,
    columns: readColumns(doc.columns), table: readTable(doc.table), title,
  };
}

// Collapse/expand: the chart is only given the rows that are currently visible.
export function visibleTasks(tasks, collapsed) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hidden = (t) => {
    for (let p = t.parentId && byId.get(t.parentId); p; p = p.parentId && byId.get(p.parentId)) {
      if (collapsed.has(p.id)) return true;
    }
    return false;
  };
  return tasks.filter((t) => !hidden(t));
}

export function parentIds(tasks) {
  return tasks.filter((t) => t.hasChildren).map((t) => t.id);
}
