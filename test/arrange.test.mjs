import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTasks, readTags, readBlockOptions } from "../src/model.js";
import { nameColors, hexToHsl, hash } from "../src/tree-colors.js";
import { parseSortSpec, sortTasks, filterTasks, allTags } from "../src/arrange.js";
import { buildColumns, sortValue } from "../src/columns.js";
import { THEMES, themeCss, themeList, getTheme, customCssTemplate, installThemeStyles } from "../src/themes.js";
import { syncVersions, readVersion, ROOT } from "../scripts/sync-version.mjs";

const today = new Date(Date.UTC(2026, 9, 17));
const rows = [
  { label: "Build", plan: ["2026-09-15", "2026-10-10"], progress: 30, tags: ["dev", "core"], children: [
    { label: "Task 10", plan: ["2026-09-20", "2026-09-25"], tags: "dev, urgent" },
    { label: "Task 2", plan: ["2026-09-15", "2026-09-18"], fact: ["2026-09-15", "2026-09-17"] },
    { label: "No dates" },
  ] },
  { label: "Plan", plan: ["2026-09-01", "2026-09-10"], fact: ["2026-09-01", "2026-09-12"], tags: ["#ops"] },
  { label: "Ship", plan: ["2026-10-12", "2026-10-16"], color: "#e06c75" },
];
const tasks = buildTasks(rows, today);
const names = (ts) => ts.map((t) => t.name);

// ---- tags
assert.deepEqual(readTags({ tags: ["a", " b ", "A", "", null], tag: "c, d; e" }), ["a", "b", "c", "d", "e"]);
assert.deepEqual(readTags({ tags: "#x, #y" }), ["x", "y"]);
assert.deepEqual(readTags({}), []);
assert.deepEqual(tasks[1].tags, ["dev", "urgent"]);
assert.equal(tasks[0].extra.tags, undefined);
assert.deepEqual(allTags(tasks), ["dev", "core", "ops", "urgent"]); // most used first, then A-Z
const cols = buildColumns(tasks);
assert.equal(cols.find((c) => c.id === "tags").get(tasks[0]), "dev, core");

// ---- sort spec
assert.deepEqual(parseSortSpec("planStart"), { key: "planStart", dir: "asc" });
assert.deepEqual(parseSortSpec("-progress"), { key: "progress", dir: "desc" });
assert.deepEqual(parseSortSpec("name desc"), { key: "name", dir: "desc" });
assert.deepEqual(parseSortSpec({ by: "status", dir: "DESC" }), { key: "status", dir: "desc" });
assert.equal(parseSortSpec("none"), null);
assert.equal(parseSortSpec(""), null);
assert.equal(parseSortSpec(undefined), null);
assert.deepEqual(readBlockOptions({ sort: "-planEnd" }).sort, { key: "planEnd", dir: "desc" });

// ---- sorting keeps the hierarchy and puts blanks last, whichever way it runs
const env = { today };
const colById = Object.fromEntries(cols.map((c) => [c.id, c]));
const by = (id) => (t) => (id === "name" ? t.name : sortValue(colById[id], t, env));
assert.deepEqual(names(sortTasks(tasks, { key: "name", dir: "asc" }, by("name"))), ["Build", "No dates", "Task 2", "Task 10", "Plan", "Ship"]); // natural: 2 before 10
assert.deepEqual(names(sortTasks(tasks, { key: "name", dir: "desc" }, by("name"))), ["Ship", "Plan", "Build", "Task 10", "Task 2", "No dates"]);
assert.deepEqual(names(sortTasks(tasks, { key: "planStart", dir: "asc" }, by("planStart"))), ["Plan", "Build", "Task 2", "Task 10", "No dates", "Ship"].slice(0, 2).concat(["Task 2", "Task 10", "No dates", "Ship"]));
const desc = names(sortTasks(tasks, { key: "planStart", dir: "desc" }, by("planStart")));
assert.deepEqual(desc, ["Ship", "Build", "Task 10", "Task 2", "No dates", "Plan"]);   // blank-dated "No dates" stays last among Build's children
const prog = names(sortTasks(tasks, { key: "progress", dir: "desc" }, by("progress")));
assert.equal(prog[0], "Plan");                                                         // 100%
assert.equal(sortTasks(tasks, null, by("name")), tasks);
// a child is always right after its own parent's subtree start
const sorted = sortTasks(tasks, { key: "planEnd", dir: "desc" }, by("planEnd"));
for (const t of sorted) if (t.parentId) assert.ok(sorted.indexOf(sorted.find((p) => p.id === t.parentId)) < sorted.indexOf(t));
assert.equal(sorted.length, tasks.length);
assert.equal(tasks[0].__i, undefined);                                                  // inputs are left clean
// status sorts by urgency, not alphabetically
const st = names(sortTasks(tasks, { key: "status", dir: "asc" }, by("status")));
assert.equal(st[st.length - 1], "Plan");                                               // completed (late) last

// ---- filtering
assert.deepEqual(names(filterTasks(tasks, { text: "task 2" })), ["Build", "Task 2"]);          // match + its parent
assert.deepEqual(names(filterTasks(tasks, { text: "build" })), ["Build", "Task 10", "Task 2", "No dates"]); // parent brings its branch
assert.deepEqual(names(filterTasks(tasks, { tag: "urgent" })), ["Build", "Task 10"]);
assert.deepEqual(names(filterTasks(tasks, { tag: "DEV" })), ["Build", "Task 10", "Task 2", "No dates"]);   // case-insensitive; tagged parent brings children
assert.deepEqual(names(filterTasks(tasks, { text: "ops" })), ["Plan"]);                         // searches tags too
assert.equal(filterTasks(tasks, { text: "  " }), tasks);
assert.deepEqual(filterTasks(tasks, { text: "zzz" }), []);

// ---- name colours: stable, readable, related within a branch
const dark = nameColors(tasks, { scheme: "dark", seed: "A" });
assert.deepEqual([...nameColors(tasks, { scheme: "dark", seed: "A" })], [...dark]);             // same input, same colours
assert.notDeepEqual([...nameColors(tasks, { scheme: "dark", seed: "B" })], [...dark]);          // another seed, another palette
const hsl = (c) => c.match(/hsl\((\d+) (\d+)% (\d+)%\)/).slice(1).map(Number);
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const light = nameColors(tasks, { scheme: "light", seed: "A" });
for (const t of tasks) {
  const [, , ld] = hsl(dark.get(t.id)); const [, , ll] = hsl(light.get(t.id));
  if (!t.color) { assert.ok(ld >= 55 && ld <= 80, `dark lightness ${ld}`); assert.ok(ll >= 28 && ll <= 46, `light lightness ${ll}`); }
}
const [b, t10, t2, nd, plan, ship] = tasks;
assert.ok(hueGap(hsl(dark.get(t10.id))[0], hsl(dark.get(b.id))[0]) <= 24);                    // children stay near their parent...
assert.ok(hueGap(hsl(dark.get(t2.id))[0], hsl(dark.get(b.id))[0]) <= 24);
assert.ok(hueGap(hsl(dark.get(plan.id))[0], hsl(dark.get(b.id))[0]) > 30);                    // ...top-level tasks are far apart
assert.notEqual(dark.get(t10.id), dark.get(t2.id));                                          // siblings are told apart
const own = hexToHsl("#e06c75");
assert.ok(hueGap(hsl(dark.get(ship.id))[0], own.h) <= 1);                                      // an own colour starts the family
assert.equal(hexToHsl("teal"), null);
assert.deepEqual(hexToHsl("#ff0000"), { h: 0, s: 100, l: 50 });
assert.ok(Math.abs(hexToHsl("#0f0").h - 120) < 1e-9);
assert.equal(hash("abc"), hash("abc")); assert.notEqual(hash("abc"), hash("abd"));
// a long chain never wanders off: depth keeps lightness inside the band
const deep = buildTasks([{ label: "r", children: [{ label: "a", children: [{ label: "b", children: [{ label: "c", children: [{ label: "d", plan: ["2026-09-01"] }] }] }] }] }], today);
for (const c of nameColors(deep, { scheme: "dark" }).values()) assert.ok(hsl(c)[2] >= 55);
assert.equal(nameColors([], {}).size, 0);

// ---- themes
assert.ok(THEMES.length >= 8);
assert.ok(THEMES.every((t) => t.id && t.name && (t.scheme === "dark" || t.scheme === "light")));
assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
assert.ok(themeList().every((t) => !t.obsidianOnly));
assert.ok(themeList({ obsidian: true }).some((t) => t.id === "obsidian"));
assert.equal(getTheme("nope").id, THEMES[0].id);
const palette = Object.keys(THEMES[0].vars);
for (const t of THEMES.filter((x) => !x.obsidianOnly)) assert.deepEqual(Object.keys(t.vars).sort(), palette.slice().sort(), t.id);   // every theme sets every variable
const css = themeCss();
assert.ok(css.includes('.epq-gantt-block[data-og-theme="nord"]') && css.includes(':root[data-og-theme="nord"]'));
// every variable a theme sets is one styles.css really defines
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
for (const k of palette) assert.ok(styles.includes(`${k}:`), `${k} missing from styles.css`);
// the stylesheet no longer carries stray hard-coded theme colours
const body = styles.slice(styles.indexOf("\n}\n", styles.indexOf(".epq-gantt-block,")));
assert.ok(!/#(1d2021|3c3836|504945|665c54|fbf1c7|ebdbb2|d5c4a1|fabd2f)\b/i.test(body), "stray Gruvbox hex left in styles.css");
// contrast: text on the background is readable in every theme
const lum = (hex) => { const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
const ratio = (a, b2) => { const [x, y] = [lum(a), lum(b2)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const t of THEMES.filter((x) => !x.obsidianOnly)) {
  assert.ok(ratio(t.vars["--og-fg"], t.vars["--og-bg"]) >= 7, `${t.id} text contrast`);
  assert.ok(ratio(t.vars["--og-on-accent"], t.vars["--og-accent"]) >= 4.5, `${t.id} accent button contrast`);
  assert.ok(ratio(t.vars["--tsg-chart-bar-color-1"], t.vars["--og-bg"]) >= 3, `${t.id} planned bar contrast`);   // graphics need 3:1
  assert.ok(ratio(t.vars["--tsg-chart-bar-color-2"], t.vars["--og-bg"]) >= 3, `${t.id} actual bar contrast`);
  assert.ok(ratio(t.vars["--og-fg-3"], t.vars["--og-bg"]) >= 4.5, `${t.id} quiet text contrast`);
}
assert.ok(customCssTemplate().includes("--og-bg:") && customCssTemplate().includes("--og-scheme"));
// installThemeStyles creates the two <style> tags once and updates them in place
const made = new Map();
const doc = { head: { appendChild: (e) => made.set(e.id, e) }, getElementById: (id) => made.get(id) ?? null, createElement: () => ({ id: "", textContent: "" }) };
installThemeStyles(doc, "a{}"); installThemeStyles(doc, "b{}");
assert.equal(made.size, 2); assert.equal(made.get("og-custom-css").textContent, "b{}"); assert.ok(made.get("og-themes").textContent.includes("nord"));

// ---- one version everywhere
const v = readVersion();
assert.match(v, /^\d+\.\d+\.\d+$/);
const { report } = syncVersions({ write: false });
for (const r of report) assert.equal(r.changed, false, `${r.file} is ${r.found}, package.json says ${v}`);
assert.ok(report.some((r) => r.file === "manifest.json"));
assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version, v);
console.log("arrange ok");
