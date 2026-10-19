// Sorting and filtering of the task list. Both keep the hierarchy: a subtask never leaves its parent, tasks are
// only reordered among their siblings.

// "planStart", "-progress", "progress desc", { by: "name", dir: "asc" } -> { key, dir } or null.
export function parseSortSpec(v) {
  if (v == null || v === "" || v === false) return null;
  let key;
  let dir = "asc";
  if (typeof v === "object" && !Array.isArray(v)) {
    key = v.by ?? v.key ?? v.column;
    if (/^desc/i.test(String(v.dir ?? v.order ?? v.direction ?? ""))) dir = "desc";
  } else {
    const parts = String(v).trim().split(/\s+/);
    key = parts[0];
    if (/^desc/i.test(parts[1] ?? "") || key.startsWith("-")) dir = "desc";
    key = key.replace(/^[-+]/, "");
  }
  key = key == null ? "" : String(key).trim();
  return key && key.toLowerCase() !== "none" ? { key, dir } : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const isBlank = (v) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

// value(task) -> number | string | null. Blanks always sort last, whichever way the order runs.
export function sortTasks(tasks, spec, value) {
  if (!spec) return tasks;
  const sign = spec.dir === "desc" ? -1 : 1;
  const kids = new Map();
  tasks.forEach((t, i) => {
    t.__i = i;
    if (!kids.has(t.parentId)) kids.set(t.parentId, []);
    kids.get(t.parentId).push(t);
  });
  const out = [];
  const walk = (parentId) => {
    const list = (kids.get(parentId) ?? []).slice();
    const keyed = list.map((t) => [t, value(t)]);
    keyed.sort(([ta, a], [tb, b]) => {
      const ba = isBlank(a);
      const bb = isBlank(b);
      if (ba || bb) return ba === bb ? ta.__i - tb.__i : ba ? 1 : -1;
      return compare(a, b) * sign || ta.__i - tb.__i;
    });
    for (const [t] of keyed) {
      out.push(t);
      walk(t.id);
    }
  };
  walk(null);
  for (const t of tasks) delete t.__i;
  return out;
}

// { text, tag } -> the tasks that match, plus the parents they sit under. A matching parent brings its whole
// branch along, so searching for "Stage 2" shows Stage 2 and everything in it.
export function filterTasks(tasks, { text = "", tag = "" } = {}) {
  const q = text.trim().toLowerCase();
  if (!q && !tag) return tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hit = (t) => {
    if (tag && !(t.tags ?? []).some((x) => x.toLowerCase() === tag.toLowerCase())) return false;
    if (!q) return true;
    const hay = [t.name, t.notes, ...(t.tags ?? []), ...Object.values(t.extra ?? {})].join("\n").toLowerCase();
    return hay.includes(q);
  };
  const keep = new Set();
  for (const t of tasks) {
    if (!hit(t)) continue;
    keep.add(t.id);
    for (let p = byId.get(t.parentId); p; p = byId.get(p.parentId)) keep.add(p.id); // ancestors
  }
  // descendants of a direct match
  for (const t of tasks) {
    if (keep.has(t.id) || !t.parentId) continue;
    for (let p = byId.get(t.parentId); p; p = byId.get(p.parentId)) {
      if (hit(p)) { keep.add(t.id); break; }
    }
  }
  return tasks.filter((t) => keep.has(t.id));
}

// Every distinct tag in the chart, most used first.
export function allTags(tasks) {
  const n = new Map();
  for (const t of tasks) for (const tag of t.tags ?? []) n.set(tag, (n.get(tag) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([tag]) => tag);
}
