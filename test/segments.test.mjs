import assert from "node:assert/strict";
import { buildTasks } from "../src/model.js";
import { makeAxis, barsFor, taskStatus, DAY } from "../src/timeline.js";
import { fmt, buildColumns, plannedDays, actualDays, varianceDays, cellText } from "../src/columns.js";
import { buildCsv } from "../src/export.js";

const today = new Date(Date.UTC(2026, 9, 6));
const env = { today };
const iso = (d) => d && d.toISOString().slice(0, 10);
const isoSegs = (segs) => segs.map((s) => [iso(s.start), iso(s.end), !!s.open]);

const [multi, openLast, oneStretch, unsorted, legacy] = buildTasks([
  { label: "multi", plan: [["2026-09-07", "2026-09-12"], ["2026-09-21", "2026-09-25"]], fact: [["2026-09-07", "2026-09-10"], ["2026-09-14", "2026-09-18"]] },
  { label: "open last", plan: [["2026-09-07", "2026-09-12"], ["2026-09-21", "2026-09-25"]], fact: [["2026-09-07", "2026-09-10"], ["2026-09-28"]] },
  { label: "wrapped single", plan: [["2026-09-07", "2026-09-12"]], fact: [["2026-09-07", "2026-09-14"]] },
  { label: "unsorted", plan: [["2026-09-21", "2026-09-25"], ["2026-09-12", "2026-09-07"], ["2026-09-30"]], fact: [["2026-09-20"], ["2026-09-07", "2026-09-10"]] },
  { label: "legacy", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-14"] },
], today);

// ---- parsing
assert.deepEqual(isoSegs(multi.planSegs), [["2026-09-07", "2026-09-12", false], ["2026-09-21", "2026-09-25", false]]);
assert.deepEqual(isoSegs(multi.factSegs), [["2026-09-07", "2026-09-10", false], ["2026-09-14", "2026-09-18", false]]);
assert.deepEqual(isoSegs(openLast.factSegs), [["2026-09-07", "2026-09-10", false], ["2026-09-28", "2026-10-06", true]]);
// sorted, end-before-start swapped, lone planned date = one-day milestone
assert.deepEqual(isoSegs(unsorted.planSegs), [["2026-09-07", "2026-09-12", false], ["2026-09-21", "2026-09-25", false], ["2026-09-30", "2026-09-30", false]]);
// a lone actual date is only "open" when it is the last range once sorted
assert.deepEqual(isoSegs(unsorted.factSegs), [["2026-09-07", "2026-09-10", false], ["2026-09-20", "2026-10-06", true]]);
// a one-element range list still works, and the old flat form is unchanged
assert.equal(oneStretch.planSegs.length, 1);
assert.deepEqual(isoSegs(legacy.planSegs), [["2026-09-07", "2026-09-12", false]]);
assert.deepEqual(isoSegs(legacy.factSegs), [["2026-09-07", "2026-09-14", false]]);
assert.equal(buildTasks([{ label: "x", plan: [["nonsense"], []] }], today)[0].planSegs.length, 0);

// ---- whole-task dates span every range
assert.equal(iso(multi.datePlannedStart), "2026-09-07");
assert.equal(iso(multi.datePlannedEnd), "2026-09-25");
assert.equal(iso(multi.dateActualEnd), "2026-09-18");
assert.equal(multi.factOpen, false);
assert.equal(openLast.factOpen, true);
assert.equal(iso(openLast.dateActualEnd), "2026-10-06");
assert.equal(unsorted.factOpen, true);

// ---- progress
assert.equal(multi.progress, 100);                       // last actual range is closed
// both planned ranges are behind us by 6 Oct (9 of 9 planned days), but an open task never reads 100%
assert.equal(openLast.progress, 99);
const inFlight = buildTasks([{ label: "p", plan: [["2026-09-28", "2026-10-02"], ["2026-10-12", "2026-10-16"]], fact: [["2026-09-28"]] }], today)[0];
assert.equal(inFlight.progress, Math.round((4 / 8) * 100)); // 4 of the 8 planned (end - start) days are behind us

// ---- durations count the days inside ranges, not the gaps
assert.equal(plannedDays(multi), 6 + 5);
assert.equal(actualDays(multi, today), 4 + 5);
assert.equal(plannedDays(legacy), 6);
assert.equal(actualDays(legacy, today), 8);
// overlapping ranges are not counted twice
const overlap = buildTasks([{ label: "o", plan: [["2026-09-07", "2026-09-10"], ["2026-09-09", "2026-09-12"]] }], today)[0];
assert.equal(plannedDays(overlap), 6);
// open range counts up to today
assert.equal(actualDays(openLast, today), 4 + 9);       // 7-10 Sep, then 28 Sep .. 6 Oct

// ---- variance and status use the overall span
assert.equal(varianceDays(multi, today), -7);           // last actual end 18 Sep vs last planned end 25 Sep
assert.equal(taskStatus(multi, today), "done");
assert.equal(taskStatus(openLast, today), "overdue");   // past its last planned end (25 Sep), still open
assert.equal(taskStatus(legacy, today), "late");

// ---- bars: one per range, in the same row
for (const sc of ["day", "week", "month", "year"]) {
  const ax = makeAxis([multi, openLast], today, sc, 7);
  const bars = barsFor(multi, ax, "both", { progress: true }, today);
  assert.deepEqual(bars.map((b) => b.kind), ["plan", "plan", "actual", "actual"]);
  assert.equal(bars[0].x, ax.x(multi.planSegs[0].start));
  assert.equal(bars[1].x, ax.x(multi.planSegs[1].start));
  assert.ok(bars[1].x > bars[0].x + bars[0].w);          // the gap stays empty
  assert.deepEqual(barsFor(multi, ax, "planned", { progress: true }, today).map((b) => b.kind), ["plan", "plan"]);
  assert.deepEqual(barsFor(multi, ax, "actual", { progress: true }, today).map((b) => b.kind), ["actual", "actual"]);
  const ob = barsFor(openLast, ax, "both", { progress: true }, today);
  assert.deepEqual(ob.map((b) => b.kind), ["plan", "plan", "actual", "progress"]);
  assert.ok(Math.abs(ob[3].x + ob[3].w - (ax.x(today) + ax.ppd)) < 1e-6); // open range still ends at today
  assert.equal(barsFor(openLast, ax, "both", { progress: false }, today)[3].kind, "actual");
}

// ---- columns and CSV
const cols = buildColumns([multi, openLast]);
const byId = Object.fromEntries(cols.map((c) => [c.id, c]));
const f = (m, d) => fmt(new Date(Date.UTC(2026, m - 1, d))); // locale-independent expectations
assert.equal(cellText(byId.planRanges, multi, env), `${f(9, 7)} – ${f(9, 12)}; ${f(9, 21)} – ${f(9, 25)}`);
assert.equal(cellText(byId.actualRanges, openLast, env), `${f(9, 7)} – ${f(9, 10)}; ${f(9, 28)} – ongoing`);
assert.equal(byId.planRanges.raw(multi, env), "2026-09-07..2026-09-12; 2026-09-21..2026-09-25");
assert.equal(byId.actualRanges.raw(openLast, env), "2026-09-07..2026-09-10; 2026-09-28..");
assert.equal(cellText(byId.planStart, multi, env), f(9, 7));
assert.equal(cellText(byId.planEnd, multi, env), f(9, 25));
const csv = buildCsv([multi], [byId.planRanges, byId.planDays], today);
assert.ok(csv.includes(",2026-09-07..2026-09-12; 2026-09-21..2026-09-25,"));
assert.ok(csv.includes(",11\r\n"));
console.log("segments ok");

// ---- side-by-side ranges: `fact: [a, b], [c]` is rewritten to the nested form before parsing
import { normalizeYaml } from "../src/model.js";
import { createRequire } from "node:module";
import fs from "node:fs";
const yamlLib = (() => { const m = { exports: {} }; new Function("module", "exports", "window", fs.readFileSync(new URL("../vendor/js-yaml.min.js", import.meta.url), "utf8"))(m, m.exports, globalThis); return m.exports.load ? m.exports : globalThis.jsyaml ?? m.exports; })();
const parse = (t) => yamlLib.load(normalizeYaml(t));

assert.equal(normalizeYaml("fact: [2026-09-15, 2026-09-16], [2026-10-14]"), "fact: [[2026-09-15, 2026-09-16], [2026-10-14]]");
assert.equal(normalizeYaml("    plan: [a, b],[c, d]   # note"), "    plan: [[a, b],[c, d]] # note"); // trailing comment kept
assert.equal(normalizeYaml("  - plan: [a, b], [c]\r"), "  - plan: [[a, b], [c]]\r");
for (const same of ["plan: [2026-09-07, 2026-09-12]", "fact: [2026-09-07]", "fact: [[a, b], [c]]", "notes: [a, b], [c]", "label: x"]) {
  assert.equal(normalizeYaml(same), same);                       // single form, nested form and other keys untouched
}
const doc = parse(`rows:
  - label: Stage 2 - Build
    plan: [2026-09-15, 2026-10-10]
    fact: [2026-09-15, 2026-09-16], [2026-10-14]
    notes: Still in progress
  - label: Both forms
    plan: [[2026-09-17, 2026-09-18], [2026-09-30, 2026-10-01]]
`);
const [build, both] = buildTasks(doc.rows, new Date(Date.UTC(2026, 9, 17)));
assert.deepEqual(isoSegs(build.factSegs), [["2026-09-15", "2026-09-16", false], ["2026-10-14", "2026-10-17", true]]);
assert.equal(build.notes, "Still in progress");
assert.equal(both.planSegs.length, 2);
console.log("side-by-side ranges ok");
