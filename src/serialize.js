// The visual editor edits a plain "canonical" copy of the chart document and writes it back out as YAML text.
// This file holds both halves, with no DOM in it so it can be tested on its own:
//
//   canonicalDoc(parsed)   parsed YAML -> { opts, markers, rows } with every row in one fixed shape
//   dumpYaml(canon)        canonical document -> YAML text, written the way you would write it by hand
//
// Rows keep any extra keys you added (owner: Sam), and chart options this program does not know are kept too.
// Comments are the one thing that cannot survive: they are not part of the parsed data. The text editor never
// loses them, because it never goes through here.

import { isRangeList, readTags } from "./model.js";

const KNOWN_ROW = new Set(["label", "plan", "fact", "children", "notes", "progress", "color", "tags", "tag"]);
const OPT_ORDER = ["title", "scale", "mode", "height", "padding", "hatch", "progress", "weekends", "tagLabels", "nameColors", "sort", "collapsed", "table", "columns"];

const iso = (d) => d.toISOString().slice(0, 10);
const plain = (v) => {
  if (v instanceof Date) return Number.isNaN(+v) ? "" : iso(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};

const rangeOf = (r) => (Array.isArray(r) ? r : [r]).map((x) => String(plain(x) ?? "").trim()).filter((x, i) => x !== "" || i === 0);
const rangesOf = (v) => {
  if (v == null || v === "") return [];
  const list = isRangeList(v) ? v : [v];
  return list.map(rangeOf).filter((r) => r[0] !== "");
};

export function canonicalRow(row) {
  const extra = {};
  for (const [k, v] of Object.entries(row)) if (!KNOWN_ROW.has(k) && v != null) extra[k] = plain(v);
  return {
    label: String(row.label ?? ""),
    plan: rangesOf(row.plan),
    fact: rangesOf(row.fact),
    progress: row.progress == null ? "" : String(row.progress),
    color: row.color == null ? "" : String(row.color),
    tags: readTags(row),
    notes: row.notes == null ? "" : String(row.notes),
    extra,
    children: Array.isArray(row.children) ? row.children.filter((c) => c && typeof c === "object").map(canonicalRow) : [],
  };
}

export function canonicalDoc(raw) {
  const doc = raw && typeof raw === "object" ? raw : {};
  const opts = {};
  for (const [k, v] of Object.entries(doc)) if (k !== "rows" && k !== "markers" && v != null) opts[k] = plain(v);
  const markers = (Array.isArray(doc.markers) ? doc.markers : []).map((m) => {
    if (Array.isArray(m)) return { date: String(plain(m[0]) ?? ""), label: String(m[1] ?? "") };
    if (m && typeof m === "object" && !(m instanceof Date)) return { date: String(plain(m.date ?? m.on) ?? ""), label: String(m.label ?? m.name ?? m.title ?? "") };
    if (typeof m === "string") {
      const hit = m.trim().match(/^(\d{4}-\d{2}-\d{2})\s*[-\u2013:]?\s*(.*)$/);
      return hit ? { date: hit[1], label: hit[2] } : { date: "", label: m };
    }
    return { date: String(plain(m) ?? ""), label: "" };
  });
  const rows = (Array.isArray(doc.rows) ? doc.rows : []).filter((r) => r && typeof r === "object").map(canonicalRow);
  return { opts, markers, rows };
}

export const emptyRow = (label = "New task") => ({ label, plan: [], fact: [], progress: "", color: "", tags: [], notes: "", extra: {}, children: [] });

// ---- writing YAML ------------------------------------------------------------------------------------------------

const WORDS = /^(true|false|yes|no|on|off|null|y|n|~)$/i;
const NUMERIC = /^[-+]?(\d[\d_]*)(\.\d*)?([eE][-+]?\d+)?$|^0x[0-9a-f]+$|^[-+]?\.(inf|nan)$/i;
const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}([Tt ].*)?$/;

// Does this text need quotes to be read back as the same string?
function needsQuotes(s, { flow = false, dates = false } = {}) {
  if (s === "" || s !== s.trim()) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/^-[^\s-]/.test(s)) return true;
  if (/: |:$| #|\t/.test(s) || s.includes("\n")) return true;
  if (flow && /[,[\]{}]/.test(s)) return true;
  if (WORDS.test(s) || NUMERIC.test(s)) return true;
  if (!dates && DATE_LIKE.test(s)) return true;
  return false;
}
const q = (s) => JSON.stringify(s);
export const scalar = (v, o) => {
  if (v == null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  return needsQuotes(s, o) ? q(s) : s;
};

const flowList = (items, o) => `[${items.map((x) => scalar(x, { ...o, flow: true })).join(", ")}]`;
// `[a, b], [c]` is how a task with several ranges is written (the reader accepts it, see normalizeYaml).
const ranges = (rs) => rs.map((r) => flowList(r, { dates: true })).join(", ");

function emit(key, value, indent, lines, o = {}) {
  const pad = " ".repeat(indent);
  if (value == null) return;
  if (Array.isArray(value)) {
    if (value.every((x) => x == null || typeof x !== "object")) { lines.push(`${pad}${key}: ${flowList(value, o)}`); return; }
    lines.push(`${pad}${key}:`);
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const sub = [];
        emitMap(item, indent + 4, sub);
        sub[0] = `${pad}  - ${sub[0].trimStart()}`;
        lines.push(...sub);
      } else lines.push(`${pad}  - ${Array.isArray(item) ? flowList(item, o) : scalar(item, o)}`);
    }
    return;
  }
  if (typeof value === "object") {
    lines.push(`${pad}${key}:`);
    emitMap(value, indent + 2, lines);
    return;
  }
  if (typeof value === "string" && value.includes("\n")) {
    // Block scalar. `-` strips the final newline, nothing keeps one, `+` keeps several; a first line that starts
    // with spaces needs an explicit indentation indicator or the reader would take those spaces as indentation.
    const trailing = value.length - value.replace(/\n+$/, "").length;
    const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
    const body = (trailing > 1 ? value.slice(0, -1) : value.replace(/\n$/, "")).split("\n");
    const first = body.find((l) => l !== "") ?? "";
    lines.push(`${pad}${key}: |${/^\s/.test(first) ? "2" : ""}${chomp}`);
    for (const l of body) lines.push(l === "" ? "" : `${pad}  ${l}`);
    return;
  }
  lines.push(`${pad}${key}: ${scalar(value, o)}`);
}
function emitMap(obj, indent, lines) {
  for (const [k, v] of Object.entries(obj)) emit(/^[\w.-]+$/.test(k) ? k : q(k), v, indent, lines);
}

function emitRow(row, indent, lines) {
  const pad = " ".repeat(indent);
  const sub = [];
  const p = indent + 2;
  emit("label", row.label || "Untitled", p, sub);
  // a range with no start date is still being typed in the visual editor: leave it out of the text for now
  const plan = (row.plan ?? []).filter((r) => r[0]);
  const fact = (row.fact ?? []).filter((r) => r[0]);
  if (plan.length) sub.push(`${" ".repeat(p)}plan: ${ranges(plan)}`);
  if (fact.length) sub.push(`${" ".repeat(p)}fact: ${ranges(fact)}`);
  if (row.progress !== "" && row.progress != null) {
    const txt = String(row.progress).trim();
    sub.push(`${" ".repeat(p)}progress: ${/^\d+(\.\d+)?%?$/.test(txt) ? txt : q(txt)}`);
  }
  if (row.color) emit("color", row.color, p, sub);
  if (row.tags?.length) sub.push(`${" ".repeat(p)}tags: ${flowList(row.tags)}`);
  if (row.notes) emit("notes", row.notes, p, sub);
  for (const [k, v] of Object.entries(row.extra ?? {})) emit(/^[\w. -]+$/.test(k) && !/^\s|\s$/.test(k) ? k : q(k), v, p, sub, { dates: true });
  if (row.children?.length) {
    sub.push(`${" ".repeat(p)}children:`);
    for (const c of row.children) emitRow(c, p + 2, sub);
  }
  sub[0] = `${pad}- ${sub[0].trimStart()}`;
  lines.push(...sub);
}

export function dumpYaml(canon) {
  const lines = [];
  const opts = canon.opts ?? {};
  const used = new Set();
  for (const k of OPT_ORDER) if (k in opts) { emit(k, opts[k], 0, lines); used.add(k); }
  for (const [k, v] of Object.entries(opts)) if (!used.has(k)) emit(/^[\w.-]+$/.test(k) ? k : q(k), v, 0, lines);
  const markers = (canon.markers ?? []).filter((m) => m.date);
  if (markers.length) {
    lines.push("markers:");
    for (const m of markers) {
      lines.push(`  - date: ${scalar(m.date, { dates: true })}`);
      if (m.label) lines.push(`    label: ${scalar(m.label)}`);
    }
  }
  lines.push("rows:");
  for (const r of canon.rows ?? []) emitRow(r, 2, lines);
  return `${lines.join("\n")}\n`;
}

// ---- editing the canonical document ----------------------------------------------------------------------------------
// A "path" is the list of indices from the top: [2, 0] is the first child of the third row.

export const rowAt = (rows, path) => path.reduce((list, i, n) => (n === path.length - 1 ? list[i] : list[i].children), rows);
const listOf = (rows, path) => (path.length === 1 ? rows : rowAt(rows, path.slice(0, -1)).children);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Each operation edits `rows` in place and returns the path of the row to keep selected (or null).
export const ops = {
  add(rows, path, { child = false, row = emptyRow() } = {}) {
    if (!path) { rows.push(row); return [rows.length - 1]; }
    if (child) {
      const parent = rowAt(rows, path);
      parent.children.push(row);
      return [...path, parent.children.length - 1];
    }
    const list = listOf(rows, path);
    const at = path[path.length - 1] + 1;
    list.splice(at, 0, row);
    return [...path.slice(0, -1), at];
  },
  remove(rows, path) {
    const list = listOf(rows, path);
    const i = path[path.length - 1];
    list.splice(i, 1);
    if (list.length) return [...path.slice(0, -1), Math.min(i, list.length - 1)];
    return path.length > 1 ? path.slice(0, -1) : null; // emptied: select the parent, or nothing
  },
  duplicate(rows, path) {
    const list = listOf(rows, path);
    const i = path[path.length - 1];
    const copy = clone(list[i]);
    copy.label = `${copy.label} (copy)`;
    list.splice(i + 1, 0, copy);
    return [...path.slice(0, -1), i + 1];
  },
  move(rows, path, dir) {
    const list = listOf(rows, path);
    const i = path[path.length - 1];
    const j = i + dir;
    if (j < 0 || j >= list.length) return path;
    [list[i], list[j]] = [list[j], list[i]];
    return [...path.slice(0, -1), j];
  },
  // Make the row a child of the sibling just above it.
  indent(rows, path) {
    const i = path[path.length - 1];
    if (i === 0) return path;
    const list = listOf(rows, path);
    const [row] = list.splice(i, 1);
    const prev = list[i - 1];
    prev.children.push(row);
    return [...path.slice(0, -1), i - 1, prev.children.length - 1];
  },
  // Move the row out to sit just after its parent.
  outdent(rows, path) {
    if (path.length < 2) return path;
    const parentPath = path.slice(0, -1);
    const parentList = listOf(rows, parentPath);
    const parent = rowAt(rows, parentPath);
    const [row] = parent.children.splice(path[path.length - 1], 1);
    const at = parentPath[parentPath.length - 1] + 1;
    parentList.splice(at, 0, row);
    return [...parentPath.slice(0, -1), at];
  },
};

// Every row with its path, depth first, for building the editor's list.
export function walkRows(rows, fn, path = []) {
  rows.forEach((r, i) => {
    const p = [...path, i];
    fn(r, p);
    walkRows(r.children, fn, p);
  });
}
