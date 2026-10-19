// The visual (form-based) editor. It edits the same chart as the YAML text editor, and every change is written back
// to the text straight away, so the two never disagree.
//
//   createVisualEditor({ parse, setText })
//     parse(text)   -> the parsed YAML document (throws on a YAML error)
//     setText(text, structural) -> called with the new YAML after every change; structural = a row or range was added,
//                              removed or moved (a host that keeps undo history should make it a step of its own)
//   returns { el, load(text), select(path), getSelected() }
//
// It works on the canonical document from serialize.js, so every YAML feature has a control: chart options, markers,
// and per task the label, any number of planned and actual ranges (dates, durations or open), progress, colour, tags,
// notes, custom fields, and nesting. Options the editor does not know are kept as they are.
import { h, clear } from "./dom.js";
import { canonicalDoc, dumpYaml, emptyRow, ops, rowAt, walkRows } from "./serialize.js";
import { parseDuration, readBlockOptions } from "./model.js";
import { buildColumns, humanize } from "./columns.js";
import { parseSortSpec } from "./arrange.js";

const DEFAULTS = readBlockOptions({});
const todayIso = () => new Date().toISOString().slice(0, 10);
const COLOR_OK = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;
const SCALES = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];
const MODES = [["planned", "Planned"], ["actual", "Actual"], ["both", "Both"]];

const field = (label, control, hint) => h("label", { class: "epq-vis-field" }, h("span", { class: "epq-vis-label", text: label }), control, hint ? h("span", { class: "epq-vis-hint", text: hint }) : null);
const btn = (text, title, onclick, cls = "") => h("button", { type: "button", class: `epq-vis-btn ${cls}`, title, "aria-label": title, text, onclick });
const select = (items, value, onchange) => h("select", { onchange: (e) => onchange(e.target.value) }, items.map(([v, t]) => h("option", { value: v, text: t, selected: v === value })));

export function createVisualEditor({ parse, setText }) {
  const el = h("div", { class: "epq-vis" });
  let canon = null;
  let sel = null; // path of the selected task
  let last = null; // the text we last wrote or loaded
  let metaRefs = new Map(); // path key -> element showing the row's summary

  const key = (p) => p.join(".");
  const same = (a, b) => a && b && key(a) === key(b);

  // ---- loading and committing --------------------------------------------------------------------------------------
  function load(text) {
    if (text === last && canon) return;
    try {
      const doc = parse(text);
      if (!doc || typeof doc !== "object") throw new Error("the chart is empty");
      canon = canonicalDoc(doc);
      last = text;
      if (sel && !rowAt(canon.rows, sel)) sel = null;
      render();
    } catch (e) {
      canon = null;
      last = null;
      clear(el);
      el.append(h("div", { class: "epq-vis-error" },
        h("b", { text: "The YAML can't be read yet." }),
        h("p", { text: String(e.message ?? e).split("\n")[0] }),
        h("p", { text: "Fix it in the YAML tab, then come back here. Nothing has been changed." })));
    }
  }

  // text: the new YAML. structural: rebuild the form (a row was added, a control swapped); otherwise just refresh the summaries.
  function commit({ structural = false } = {}) {
    const text = dumpYaml(canon);
    last = text;
    setText(text, structural); // structural changes (add, remove, move) are always their own undo step
    if (structural) render();
    else refreshMeta();
  }

  // ---- small pieces -----------------------------------------------------------------------------------------------
  function setOpt(k, v, def) {
    if (v === def || v === "" || v == null || (Array.isArray(v) && !v.length)) delete canon.opts[k];
    else canon.opts[k] = v;
    commit();
  }
  const text = (value, onInput, attrs = {}) => h("input", { type: "text", value: value ?? "", oninput: (e) => onInput(e.target.value), ...attrs });
  const number = (value, onInput, attrs = {}) => h("input", { type: "number", value: value ?? "", oninput: (e) => onInput(e.target.value === "" ? "" : Number(e.target.value)), ...attrs });
  const check = (label, value, onChange) => h("label", { class: "epq-vis-check" }, h("input", { type: "checkbox", checked: !!value, onchange: (e) => onChange(e.target.checked) }), h("span", { text: label }));

  // ---- chart settings ------------------------------------------------------------------------------------------------
  function settingsSection() {
    const o = canon.opts;
    const columns = buildColumns([]).filter((c) => c.builtin);
    const customKeys = new Set();
    walkRows(canon.rows, (r) => Object.keys(r.extra ?? {}).forEach((k) => customKeys.add(k)));
    const colChoices = [...columns.map((c) => [c.id, c.label]), ...[...customKeys].map((k) => [k, humanize(k)])];
    const sortSpec = parseSortSpec(o.sort);

    const pinned = Array.isArray(o.columns);
    const colBox = h("div", { class: "epq-vis-cols" }, pinned ? colChoices.map(([id, label]) =>
      check(label, o.columns.includes(id), (on) => {
        const set = new Set(o.columns);
        if (on) set.add(id); else set.delete(id);
        o.columns = colChoices.map(([x]) => x).filter((x) => set.has(x));
        commit();
      })) : null);

    return h("details", { class: "epq-vis-sec" }, h("summary", { text: "Chart settings" }),
      h("div", { class: "epq-vis-grid" },
        field("Title", text(o.title, (v) => setOpt("title", v.trim(), ""), { placeholder: "Defaults to the note name" })),
        field("Scale", select(SCALES, o.scale ?? DEFAULTS.scale, (v) => setOpt("scale", v, DEFAULTS.scale))),
        field("Show", select(MODES, o.mode ?? DEFAULTS.mode, (v) => setOpt("mode", v, DEFAULTS.mode))),
        field("Height (px)", number(o.height ?? DEFAULTS.height, (v) => setOpt("height", v, DEFAULTS.height), { min: 200, step: 20 })),
        field("Padding (days)", number(o.padding ?? DEFAULTS.padding, (v) => setOpt("padding", v, DEFAULTS.padding), { min: 0 })),
        field("Name colours", select([["tree", "By branch (family colours)"], ["status", "By status"], ["none", "None"]], o.nameColors ?? "tree", (v) => setOpt("nameColors", v, "tree"))),
        field("Table", select([["", "Use my saved layout"], ["true", "Always show"], ["false", "Hide"]], o.table == null ? "" : String(o.table), (v) => setOpt("table", v === "" ? "" : v === "true", ""))),
        field("Sort rows by", select([["", "Original order"], ["name", "Name"], ...colChoices], sortSpec?.key ?? "", (v) => setOpt("sort", v ? `${v}${sortSpec?.dir === "desc" ? " desc" : ""}` : "", ""))),
        field("Sort order", select([["asc", "Ascending"], ["desc", "Descending"]], sortSpec?.dir ?? "asc", (v) => { if (sortSpec) setOpt("sort", `${sortSpec.key}${v === "desc" ? " desc" : ""}`, ""); }))),
      h("div", { class: "epq-vis-checks" },
        check("Striped actual bars", o.hatch ?? DEFAULTS.hatch, (v) => setOpt("hatch", v, true)),
        check("Progress bars", o.progress ?? DEFAULTS.progress, (v) => setOpt("progress", v, true)),
        check("Shade weekends", o.weekends, (v) => setOpt("weekends", v, false)),
        check("Tags on bars", o.tagLabels ?? true, (v) => setOpt("tagLabels", v, true)),
        check("Start collapsed", o.collapsed, (v) => setOpt("collapsed", v, false))),
      h("div", { class: "epq-vis-cols-head" },
        check("Choose which columns this chart shows", pinned, (on) => {
          if (on) o.columns = ["progress", "planStart", "planEnd", "actualStart", "actualEnd"]; else delete o.columns;
          commit({ structural: true });
        })),
      colBox);
  }

  function markersSection() {
    const list = h("div", { class: "epq-vis-markers" }, canon.markers.map((m, i) =>
      h("div", { class: "epq-vis-marker" },
        h("input", { type: "date", value: m.date, "aria-label": "Marker date", oninput: (e) => { m.date = e.target.value; commit(); } }),
        text(m.label, (v) => { m.label = v; commit(); }, { placeholder: "Label (Deadline, Holiday...)", "aria-label": "Marker label" }),
        btn("\u00d7", "Remove marker", () => { canon.markers.splice(i, 1); commit({ structural: true }); }, "is-danger"))));
    return h("details", { class: "epq-vis-sec", open: canon.markers.length > 0 }, h("summary", { text: `Markers (${canon.markers.length})` }),
      list,
      btn("+ Add marker", "Add a dated line for a deadline or holiday", () => { canon.markers.push({ date: todayIso(), label: "" }); commit({ structural: true }); }, "is-add"));
  }

  // ---- ranges ---------------------------------------------------------------------------------------------------------
  function rangesEditor(row, kind) {
    const ranges = row[kind];
    const isFact = kind === "fact";
    const wrap = h("div", { class: "epq-vis-ranges" });
    ranges.forEach((r, i) => {
      const end = r[1] ?? "";
      const mode = !end ? "none" : parseDuration(end) ? "dur" : "date";
      const open = isFact && i === ranges.length - 1;
      const noneLabel = isFact ? (open ? "still open (to today)" : "single day") : "single day / milestone";
      const valueInput = mode === "date"
        ? h("input", { type: "date", value: end, "aria-label": "End date", oninput: (e) => { r[1] = e.target.value; if (!r[1]) r.length = 1; commit(); } })
        : mode === "dur"
          ? text(end, (v) => { r[1] = v.trim(); if (!r[1]) r.length = 1; commit(); }, { placeholder: "5d, 2w", size: 7, "aria-label": "Duration" })
          : h("span", { class: "epq-vis-dim", text: "" });
      wrap.append(h("div", { class: "epq-vis-range" },
        h("input", { type: "date", value: r[0] ?? "", "aria-label": "Start date", oninput: (e) => { r[0] = e.target.value; commit(); } }),
        select([["date", "to date"], ["dur", "for length"], ["none", noneLabel]], mode, (m) => {
          if (m === "none") r.length = 1;
          else if (m === "date") r[1] = /^\d{4}-\d{2}-\d{2}$/.test(r[0]) ? r[0] : todayIso();
          else r[1] = "5d";
          commit({ structural: true });
        }),
        valueInput,
        btn("\u00d7", "Remove this range", () => { ranges.splice(i, 1); commit({ structural: true }); }, "is-danger")));
    });
    wrap.append(btn(`+ Add ${isFact ? "actual" : "planned"} range`, "Add another stretch of work", () => { ranges.push([todayIso()]); commit({ structural: true }); }, "is-add"));
    return wrap;
  }

  // ---- tags -------------------------------------------------------------------------------------------------------------
  function tagsEditor(row) {
    const all = new Set();
    walkRows(canon.rows, (r) => r.tags.forEach((t) => all.add(t)));
    const listId = `epq-tags-${Math.random().toString(36).slice(2, 8)}`;
    const wrap = h("div", { class: "epq-vis-tags" });
    const add = (raw) => {
      let changed = false;
      for (const t of String(raw).split(/[,;]/).map((x) => x.trim().replace(/^#/, "")).filter(Boolean)) {
        if (!row.tags.some((x) => x.toLowerCase() === t.toLowerCase())) { row.tags.push(t); changed = true; }
      }
      if (changed) commit({ structural: true });
    };
    row.tags.forEach((t, i) => wrap.append(h("span", { class: "epq-vis-chip" }, t, h("button", { type: "button", "aria-label": `Remove tag ${t}`, text: "\u00d7", onclick: () => { row.tags.splice(i, 1); commit({ structural: true }); } }))));
    const input = h("input", { type: "text", list: listId, placeholder: row.tags.length ? "add tag" : "Add tags (Enter or comma)", class: "epq-vis-taginput",
      onkeydown: (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input.value); } else if (e.key === "Backspace" && !input.value && row.tags.length) { row.tags.pop(); commit({ structural: true }); } },
      onchange: () => add(input.value) });
    wrap.append(input, h("datalist", { id: listId }, [...all].map((t) => h("option", { value: t }))));
    return wrap;
  }

  // ---- one task's form ---------------------------------------------------------------------------------------------
  function taskForm(row, path) {
    const go = (fn) => { sel = fn(); commit({ structural: true }); };

    const colorText = text(row.color, (v) => { row.color = v.trim(); colorText.classList.toggle("is-bad", !!row.color && !COLOR_OK.test(row.color)); commit(); }, { placeholder: "#d3869b or a name", "aria-label": "Colour" });
    colorText.classList.toggle("is-bad", !!row.color && !COLOR_OK.test(row.color));
    const picker = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : "#7fc4e8", "aria-label": "Pick a colour", oninput: (e) => { row.color = e.target.value; colorText.value = row.color; colorText.classList.remove("is-bad"); commit(); } });

    const extras = h("div", { class: "epq-vis-extras" }, Object.entries(row.extra).map(([k, v]) =>
      h("div", { class: "epq-vis-extra" },
        text(k, (nk) => {
          nk = nk.trim();
          if (!nk || nk === k || nk in row.extra) return;
          const entries = Object.entries(row.extra).map(([a, b]) => (a === k ? [nk, b] : [a, b]));
          row.extra = Object.fromEntries(entries);
          k = nk;
          commit();
        }, { "aria-label": "Field name", class: "epq-vis-extra-k" }),
        text(String(v), (nv) => { row.extra[k] = nv; commit(); }, { "aria-label": "Field value" }),
        btn("\u00d7", "Remove field", () => { delete row.extra[k]; commit({ structural: true }); }, "is-danger"))));

    return h("div", { class: "epq-vis-form" },
      h("div", { class: "epq-vis-actions" },
        btn("\u2191", "Move up", () => go(() => ops.move(canon.rows, path, -1))), btn("\u2193", "Move down", () => go(() => ops.move(canon.rows, path, 1))),
        btn("\u21e4", "Outdent (make it a sibling of its parent)", () => go(() => ops.outdent(canon.rows, path))), btn("\u21e5", "Indent (make it a subtask of the task above)", () => go(() => ops.indent(canon.rows, path))),
        btn("+ Subtask", "Add a subtask", () => go(() => ops.add(canon.rows, path, { child: true }))), btn("+ Below", "Add a task below", () => go(() => ops.add(canon.rows, path))),
        btn("Duplicate", "Duplicate this task and its subtasks", () => go(() => ops.duplicate(canon.rows, path))),
        btn("Delete", "Delete this task and its subtasks", () => go(() => ops.remove(canon.rows, path)), "is-danger")),
      field("Name", text(row.label, (v) => { row.label = v; commit(); const n = metaRefs.get(`${key(path)}:name`); if (n) n.textContent = v || "(untitled)"; }, { class: "epq-vis-name-input" })),
      h("div", { class: "epq-vis-block" }, h("div", { class: "epq-vis-label", text: "Planned" }), rangesEditor(row, "plan")),
      h("div", { class: "epq-vis-block" }, h("div", { class: "epq-vis-label", text: "Actual" }), rangesEditor(row, "fact")),
      h("div", { class: "epq-vis-grid" },
        field("Progress", text(row.progress, (v) => { row.progress = v.trim(); commit(); }, { placeholder: "auto, or 60%" }), "Leave empty to calculate"),
        field("Bar colour", h("div", { class: "epq-vis-colorrow" }, picker, colorText, btn("Clear", "Use the default colour", () => { row.color = ""; commit({ structural: true }); })))),
      h("div", { class: "epq-vis-block" }, h("div", { class: "epq-vis-label", text: "Tags" }), tagsEditor(row)),
      field("Notes", h("textarea", { rows: 3, value: row.notes, "aria-label": "Notes", oninput: (e) => { row.notes = e.target.value; commit(); } })),
      h("div", { class: "epq-vis-block" }, h("div", { class: "epq-vis-label", text: "Custom fields (each becomes a table column)" }), extras,
        btn("+ Add field", "Add a custom field such as owner or cost", () => { let n = "field"; for (let i = 2; n in row.extra; i++) n = `field${i}`; row.extra[n] = ""; commit({ structural: true }); }, "is-add")));
  }

  // ---- the task list ---------------------------------------------------------------------------------------------------
  const summary = (r) => {
    const f = (r.plan[0]?.[0]) ? `${r.plan[0][0]}${r.plan[0][1] ? ` \u2192 ${r.plan[0][1]}` : ""}${r.plan.length > 1 ? ` +${r.plan.length - 1}` : ""}` : "";
    return f;
  };
  function refreshMeta() {
    walkRows(canon.rows, (r, p) => { const m = metaRefs.get(`${key(p)}:meta`); if (m) m.textContent = summary(r); });
  }

  function tasksSection() {
    metaRefs = new Map();
    const list = h("div", { class: "epq-vis-tasks", role: "tree" });
    walkRows(canon.rows, (row, path) => {
      const isSel = same(path, sel);
      const name = h("span", { class: "epq-vis-rowname", text: row.label || "(untitled)" });
      const meta = h("span", { class: "epq-vis-rowmeta", text: summary(row) });
      metaRefs.set(`${key(path)}:name`, name);
      metaRefs.set(`${key(path)}:meta`, meta);
      const head = h("button", { type: "button", class: `epq-vis-row${isSel ? " is-sel" : ""}`, style: { paddingLeft: `${8 + (path.length - 1) * 16}px` }, role: "treeitem", "aria-expanded": String(isSel),
        dataset: { path: key(path) },
        onclick: () => { sel = isSel ? null : path; render(); } },
        h("span", { class: "epq-vis-caret", text: isSel ? "\u25BE" : "\u25B8" }), name, row.children.length ? h("span", { class: "epq-vis-count", text: String(row.children.length) }) : null, meta);
      list.append(head);
      if (isSel) list.append(h("div", { class: "epq-vis-formwrap", style: { marginLeft: `${(path.length - 1) * 16}px` } }, taskForm(row, path)));
    });
    return h("section", { class: "epq-vis-tasksec" },
      h("div", { class: "epq-vis-taskhead" }, h("span", { class: "epq-vis-title", text: "Tasks" }),
        btn("+ Add task", "Add a task at the end", () => { sel = ops.add(canon.rows, null); commit({ structural: true }); }, "is-add")),
      canon.rows.length ? list : h("p", { class: "epq-vis-dim", text: "No tasks yet. Add one to start." }));
  }

  function render() {
    const keepScroll = el.scrollTop;
    clear(el);
    if (!canon) return;
    el.append(settingsSection(), markersSection(), tasksSection());
    el.scrollTop = keepScroll;
  }

  return {
    el,
    load,
    getSelected: () => sel,
    // Select a task by its path (used when you double-click a task in the chart).
    select(path) {
      if (!canon || !path || !rowAt(canon.rows, path)) return;
      sel = path;
      render();
      el.querySelector(".epq-vis-row.is-sel")?.scrollIntoView?.({ block: "center" });
    },
  };
}

// "r.0.2" (a task id from the chart) -> [0, 2]
export const pathFromId = (id) => String(id).split(".").slice(1).map(Number).filter((n) => Number.isInteger(n));
