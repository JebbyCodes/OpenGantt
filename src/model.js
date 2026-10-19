import { parseSortSpec } from "./arrange.js";
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

// ---- Date ranges ("segments") -------------------------------------------------------------
// `plan` and `fact` take either one range, `[start, end]` / `[date]`, or a list of ranges,
// `[[start, end], [start, end], [start]]`, for work that happens in several separate stretches.
// Both forms end up as a sorted list of { start, end, open } segments.

export const isRangeList = (v) => Array.isArray(v) && v.some(Array.isArray);

// "5d", "2w", "10 days", "3 weeks" -> number of days (a week is 7), else null. Written as the second
// item of a range, `[2026-09-07, 5d]`, it means "5 days starting 7 Sep": the end day is included.
export function parseDuration(v) {
  const m = typeof v === "string" ? v.trim().match(/^(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks)$/i) : null;
  if (!m) return null;
  const n = Math.round(parseFloat(m[1]) * (m[2][0].toLowerCase() === "w" ? 7 : 1));
  return n >= 1 ? n : null;
}

// Raw plan/fact value -> sorted [{ start, end }] (no open flag yet). Bad dates are skipped, an end
// before its start is swapped, a missing end means a single day, and a duration works out the end.
function readSegments(v) {
  const raw = isRangeList(v) ? v : v == null ? [] : [v];
  const out = [];
  for (const r of raw) {
    const items = Array.isArray(r) ? [...r] : [r];
    let start = toDate(items[0]);
    if (!start) {
      const d = toDates(r); // an unusable first item: fall back to the first date found
      if (!d) continue;
      start = d[0];
      items.splice(0, items.length, ...d);
    }
    let end = null;
    if (items.length > 1) {
      const days = parseDuration(items[1]);
      end = days ? new Date(+start + (days - 1) * 86400000) : toDate(items[1]);
    }
    if (end && end < start) [start, end] = [end, start];
    out.push({ start, end, single: !end });
  }
  return out.sort((a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start));
}

// Planned ranges: a lone date is a one-day milestone.
function planSegments(v) {
  return readSegments(v).map(({ start, end }) => ({ start, end: end ?? start }));
}

// Actual ranges: a lone date in the LAST range is an open task running to `today`; a lone date in an
// earlier range is a one-day stretch.
function factSegments(v, today) {
  const segs = readSegments(v);
  return segs.map((s, i) => {
    const open = s.single && i === segs.length - 1;
    return { start: s.start, end: open ? today : s.end ?? s.start, open };
  });
}

// Segments of a task; falls back to the single-range date fields for tasks built by hand.
export function planSegsOf(t) {
  if (t.planSegs) return t.planSegs;
  return t.datePlannedStart ? [{ start: t.datePlannedStart, end: t.datePlannedEnd ?? t.datePlannedStart }] : [];
}
export function factSegsOf(t) {
  if (t.factSegs) return t.factSegs;
  return t.dateActualStart ? [{ start: t.dateActualStart, end: t.dateActualEnd ?? t.dateActualStart, open: !!t.factOpen }] : [];
}

// Planned working time elapsed, as a 0-99 percentage. Several ranges count only their own days.
function plannedElapsed(segs, today) {
  let total = 0;
  let done = 0;
  for (const s of segs) {
    const len = s.end - s.start;
    total += len;
    done += Math.max(0, Math.min(len, Math.min(today, s.end) - s.start));
  }
  return Math.max(0, Math.min(99, Math.round((done / Math.max(1, total)) * 100)));
}

// Lets several ranges be written side by side, which plain YAML would reject:
//   fact: [2026-09-15, 2026-09-16], [2026-10-14]
// becomes the standard nested list the parser understands:
//   fact: [[2026-09-15, 2026-09-16], [2026-10-14]]
// Only `plan:` / `fact:` lines holding two or more bracket groups are touched (an optional trailing
// comment is kept); everything else, including the nested form, passes through unchanged.
const RANGE_LINE = /^(\s*(?:-\s+)?(?:plan|fact)\s*:\s*)(\[[^\[\]]*\](?:\s*,\s*\[[^\[\]]*\])+)\s*,?(\s+#.*)?$/;
export function normalizeYaml(text) {
  return String(text).split("\n").map((line) => {
    const cr = line.endsWith("\r") ? "\r" : "";
    const m = RANGE_LINE.exec(cr ? line.slice(0, -1) : line);
    return m ? `${m[1]}[${m[2]}]${m[3] ?? ""}${cr}` : line;
  }).join("\n");
}

// `tags: [design, urgent]`, `tags: design, urgent` or `tag: design` -> ["design", "urgent"] (trimmed, no repeats).
export function readTags(row) {
  const raw = [row.tags, row.tag].flatMap((v) => (Array.isArray(v) ? v : v == null ? [] : String(v).split(/[,;]/)));
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const tag = String(v ?? "").trim().replace(/^#/, "");
    if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); out.push(tag); }
  }
  return out;
}

// A task colour: #rgb / #rrggbb / #rrggbbaa or a plain colour name. Anything else is ignored, because
// the value ends up inside SVG attributes.
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;
function readColor(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return COLOR_RE.test(s) ? s : null;
}

// `progress: 60` or `progress: 60%` on a task sets its progress by hand (0-100). null = not set.
function readProgress(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

// Sets everything derived from a task's ranges: whole-task dates, open flag and progress.
function finish(t, today) {
  const maxEnd = (segs) => (segs.length ? new Date(Math.max(...segs.map((s) => +s.end))) : null);
  const { planSegs, factSegs } = t;
  t.datePlannedStart = planSegs[0]?.start ?? null;
  t.datePlannedEnd = maxEnd(planSegs);
  t.dateActualStart = factSegs[0]?.start ?? null;
  t.dateActualEnd = maxEnd(factSegs);
  t.factOpen = factSegs.length > 0 && factSegs[factSegs.length - 1].open;
  let progress = 0;
  if (t.dateActualStart && !t.factOpen) progress = 100;
  else if (t.dateActualStart && planSegs.length) progress = plannedElapsed(planSegs, today);
  t.progress = t.progressSet ?? progress;
}

// A parent row with no dates of its own takes them from its subtasks: planned from the earliest planned
// start to the latest planned end; actual from the earliest start, still open until every subtask that
// has a plan is finished. Parents that set their own `plan` / `fact` keep them.
function rollUp(parent, kids, today) {
  const least = (xs) => new Date(Math.min(...xs.map(Number)));
  const most = (xs) => new Date(Math.max(...xs.map(Number)));
  if (!parent.planSegs.length) {
    const planned = kids.filter((k) => k.datePlannedStart);
    if (planned.length) {
      parent.planSegs = [{ start: least(planned.map((k) => k.datePlannedStart)), end: most(planned.map((k) => k.datePlannedEnd)) }];
      parent.planDerived = true;
    }
  }
  if (!parent.factSegs.length) {
    const started = kids.filter((k) => k.dateActualStart);
    if (started.length) {
      const open = kids.some((k) => k.factOpen || (!k.dateActualStart && k.datePlannedStart));
      parent.factSegs = [{ start: least(started.map((k) => k.dateActualStart)), end: open ? today : most(started.map((k) => k.dateActualEnd)), open }];
      parent.factDerived = true;
    }
  }
  finish(parent, today);
}

// Row keys the chart already uses. Any other scalar key becomes a custom table column.
const KNOWN_KEYS = new Set(["label", "plan", "fact", "children", "notes", "progress", "color", "tags", "tag"]);

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
    const task = {
      id,
      parentId,
      name,
      progress: 0,
      // Every range, sorted. planSegs: [{ start, end }]; factSegs: [{ start, end, open }], where an open
      // range is a lone start date that runs to today (drawn as the progress bar).
      planSegs: planSegments(row.plan),
      factSegs: factSegments(row.fact, today),
      progressSet: readProgress(row.progress),
      color: readColor(row.color),
      tags: readTags(row),
      localizedNames: { en: name },
      notes: row.notes != null ? String(row.notes) : "",
      extra: pickExtras(row), // other keys on the row, as text; offered as custom table columns
      depth,
      order: out.length, // position in the YAML; ts-gantt must keep this order
      hasChildren: Array.isArray(row.children) && row.children.some((c) => c && typeof c === "object"),
    };
    finish(task, today); // whole-task dates (earliest start to latest end), open flag, progress
    out.push(task);
    if (Array.isArray(row.children)) buildTasks(row.children, today, id, out, depth + 1);
    if (task.hasChildren) rollUp(task, out.filter((c) => c.parentId === id), today);
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

// `markers:` draws a labelled vertical line on a date (a deadline, a holiday, a review). Each entry is
// `{ date: 2026-10-10, label: Deadline }`, `[2026-10-10, Deadline]` or `"2026-10-10 Deadline"`.
export function readMarkers(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const m of v) {
    let date = null;
    let label = "";
    if (Array.isArray(m)) [date, label] = [toDate(m[0]), m[1] ?? ""];
    else if (m && typeof m === "object" && !(m instanceof Date)) [date, label] = [toDate(m.date ?? m.on), m.label ?? m.name ?? m.title ?? ""];
    else if (typeof m === "string") {
      const hit = m.trim().match(/^(\d{4}-\d{2}-\d{2})\s*[-\u2013:]?\s*(.*)$/);
      if (hit) [date, label] = [toDate(hit[1]), hit[2]];
    } else date = toDate(m);
    if (date) out.push({ date, label: String(label ?? "").trim() });
  }
  return out.sort((a, b) => a.date - b.date);
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
    scale, mode, height, padding, hatch: doc.hatch !== false, progress: doc.progress !== false, editable: doc.editable === true, collapsed, weekends: doc.weekends === true, markers: readMarkers(doc.markers),
    // how the table colours task names: a family colour per branch, by status, or not at all
    nameColors: ["tree", "status", "none"].includes(doc.nameColors) ? doc.nameColors : "tree",
    tagLabels: doc.tagLabels !== false, // small tag labels beside the bars
    sort: parseSortSpec(doc.sort),
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
