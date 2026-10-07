// Table columns: what exists, which are shown, and in what order. No DOM, so it runs under Node tests.
//
// A column is { id, label, width, get(task, env) -> text, raw?(task, env) -> value for CSV,
//               cls?(task, env) -> extra CSS class, builtin, key? }.
// A layout is { order: [every column id, in display order], shown: Set of ids }.
import { DAY, taskStatus } from "./timeline.js";
import { normKey } from "./model.js";

export function fmt(d) {
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "–";
}
export const iso = (d) => (d ? d.toISOString().slice(0, 10) : "");

const inclusiveDays = (a, b) => Math.round((b - a) / DAY) + 1;
const plural = (n) => `${n} d`;

// Days a task slipped against its plan: + late, - early. A finished task compares its actual end
// to the planned end; an unfinished one that is past its planned end counts up to today.
export function varianceDays(t, today) {
  if (!t.datePlannedEnd) return null;
  if (t.dateActualStart && !t.factOpen) return Math.round((t.dateActualEnd - t.datePlannedEnd) / DAY);
  if (today > t.datePlannedEnd) return Math.round((today - t.datePlannedEnd) / DAY);
  return null;
}

export function plannedDays(t) {
  return t.datePlannedStart ? inclusiveDays(t.datePlannedStart, t.datePlannedEnd ?? t.datePlannedStart) : null;
}

export function actualDays(t, today) {
  if (!t.dateActualStart) return null;
  const end = t.factOpen && today < t.dateActualStart ? t.dateActualStart : t.dateActualEnd ?? t.dateActualStart;
  return inclusiveDays(t.dateActualStart, end);
}

export const STATUS_TEXT = { idle: "Not started", progress: "In progress", overdue: "Overdue", done: "Completed", late: "Completed late" };

const dayText = (n) => (n == null ? "–" : plural(n));

// The columns the table has always had come first and keep their exact widths.
const BUILTIN = [
  { id: "progress", label: "Progress", width: 70, get: (t) => (t.dateActualStart ? `${t.progress}%` : "–"), raw: (t) => (t.dateActualStart ? t.progress : "") },
  { id: "planStart", label: "Start planned", width: 92, get: (t) => fmt(t.datePlannedStart), raw: (t) => iso(t.datePlannedStart) },
  { id: "planEnd", label: "End planned", width: 92, get: (t) => fmt(t.datePlannedEnd), raw: (t) => iso(t.datePlannedEnd) },
  { id: "actualStart", label: "Start actual", width: 92, get: (t) => fmt(t.dateActualStart), raw: (t) => iso(t.dateActualStart) },
  { id: "actualEnd", label: "End actual", width: 92, get: (t) => (t.factOpen ? "ongoing" : fmt(t.dateActualEnd)), raw: (t) => (t.factOpen ? "" : iso(t.dateActualEnd)) },
  { id: "planDays", label: "Planned days", width: 112, get: (t) => dayText(plannedDays(t)), raw: (t) => plannedDays(t) ?? "" },
  { id: "actualDays", label: "Actual days", width: 104, get: (t, e) => dayText(actualDays(t, e.today)), raw: (t, e) => actualDays(t, e.today) ?? "" },
  {
    id: "variance", label: "Variance", width: 84,
    get: (t, e) => {
      const v = varianceDays(t, e.today);
      return v == null ? "–" : v === 0 ? "On time" : `${v > 0 ? "+" : "\u2212"}${Math.abs(v)} d`;
    },
    raw: (t, e) => varianceDays(t, e.today) ?? "",
  },
  {
    id: "status", label: "Status", width: 128,
    get: (t, e) => STATUS_TEXT[taskStatus(t, e.today)],
    cls: (t, e) => `epq-st-${taskStatus(t, e.today)}`,
  },
  { id: "notes", label: "Notes", width: 190, get: (t) => t.notes.replace(/\s+/g, " ").trim(), raw: (t) => t.notes },
];

// Shown until the user chooses otherwise: exactly what v3 showed.
export const DEFAULT_SHOWN = ["progress", "planStart", "planEnd", "actualStart", "actualEnd"];

const estWidth = (text, bold) => String(text).length * (bold ? 7.6 : 7);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// "assigned_to" -> "Assigned to"
export function humanize(key) {
  const s = String(key).replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : String(key);
}

// Built-in columns plus a custom column for every extra key found on the tasks (e.g. `owner: Sam`)
// and for every name in `extraKeys` that matches nothing (a `columns:` entry for a key no row has yet).
export function buildColumns(tasks, extraKeys = []) {
  const cols = BUILTIN.map((c) => ({ ...c, builtin: true }));
  const builtinNames = new Set(cols.flatMap((c) => [normKey(c.id), normKey(c.label)]));
  const seen = new Map(); // normalised key -> { key, longest }

  const note = (key, text) => {
    const n = normKey(key);
    if (!n) return;
    const entry = seen.get(n) ?? { key: String(key), longest: 0 };
    entry.longest = Math.max(entry.longest, text ? text.length : 0);
    seen.set(n, entry);
  };
  for (const t of tasks) for (const [k, v] of Object.entries(t.extra ?? {})) note(k, v);
  for (const k of extraKeys) if (!matchColumn(cols, k)) note(k, "");

  for (const [n, { key, longest }] of seen) {
    const clash = builtinNames.has(n); // e.g. a `status:` key next to the computed Status column
    const label = clash ? `${humanize(key)} (custom)` : humanize(key);
    cols.push({
      id: `key:${n}`,
      key,
      label,
      builtin: false,
      width: clamp(Math.max(estWidth(label, true) + 24, longest * 7 + 22), 80, 260),
      get: (t) => lookup(t, n),
    });
  }
  return cols;
}

function lookup(t, n) {
  const ex = t.extra;
  if (!ex) return "";
  for (const k of Object.keys(ex)) if (normKey(k) === n) return ex[k];
  return "";
}

// Which column does a `columns:` entry mean? Matches id, heading or YAML key, ignoring case/punctuation.
export function matchColumn(cols, token) {
  const n = normKey(token);
  if (!n) return null;
  const hit = cols.find((c) => normKey(c.id) === n || normKey(c.label) === n || (c.key && normKey(c.key) === n));
  return hit ? hit.id : null;
}

export function cellText(col, t, env) {
  const v = col.get(t, env);
  return v == null ? "" : String(v);
}

// ---- Layout ----------------------------------------------------------------------------------

// Where a block's layout starts: its own `columns:` list, else the saved choice, else the defaults.
// `saved` may mention columns this block doesn't have (they belong to other charts); those are ignored.
export function resolveLayout(cols, { yaml = null, saved = null } = {}) {
  const ids = cols.map((c) => c.id);
  const has = new Set(ids);
  if (yaml) {
    const picked = [];
    for (const tok of yaml) {
      const id = matchColumn(cols, tok);
      if (id && !picked.includes(id)) picked.push(id);
    }
    return { order: [...picked, ...ids.filter((id) => !picked.includes(id))], shown: new Set(picked) };
  }
  if (saved && Array.isArray(saved.order)) {
    const order = saved.order.filter((id) => has.has(id));
    const shown = new Set((saved.shown ?? []).filter((id) => has.has(id)));
    return { order: [...order, ...ids.filter((id) => !order.includes(id))], shown };
  }
  return { order: ids, shown: new Set(DEFAULT_SHOWN.filter((id) => has.has(id))) };
}

// What gets saved: this block's layout, plus whatever was saved for columns it doesn't have.
export function mergeSaved(layout, prev) {
  const known = new Set(layout.order);
  const keep = (list) => (Array.isArray(list) ? list : []).filter((id) => !known.has(id));
  return {
    order: [...layout.order, ...keep(prev?.order)],
    shown: [...layout.order.filter((id) => layout.shown.has(id)), ...keep(prev?.shown)],
  };
}

export function visibleColumns(cols, layout) {
  const byId = new Map(cols.map((c) => [c.id, c]));
  return layout.order.filter((id) => layout.shown.has(id)).map((id) => byId.get(id)).filter(Boolean);
}

// Put `id` immediately before `beforeId` (null = at the end).
export function moveBefore(order, id, beforeId) {
  const rest = order.filter((x) => x !== id);
  const i = beforeId == null ? rest.length : rest.indexOf(beforeId);
  if (i < 0) return order.slice();
  rest.splice(i, 0, id);
  return rest;
}

// Swap with the neighbour above (-1) or below (+1) in the full list.
export function moveStep(order, id, delta) {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order.slice();
  const out = order.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// Drag in the chart header: `slot` is the position among the *visible* columns (0 = first) where the
// dragged column should land, counted with the dragged column removed. Hidden columns keep their place.
export function moveToVisibleSlot(order, shown, id, slot) {
  const rest = order.filter((x) => x !== id);
  const vis = rest.filter((x) => shown.has(x));
  if (slot < vis.length) return moveBefore(order, id, vis[Math.max(0, slot)]);
  const last = vis[vis.length - 1];
  if (last === undefined) return moveBefore(order, id, rest[0] ?? null);
  return moveBefore(order, id, rest[rest.indexOf(last) + 1] ?? null);
}
