import assert from "node:assert/strict";
import fs from "node:fs";
import { buildTasks, parseDuration, readMarkers, readBlockOptions, normalizeYaml } from "../src/model.js";
import { makeAxis, barsFor, bodyBars, markerShapes, weekendSpans, barColors, DAY } from "../src/timeline.js";
import { buildColumns, cellText, plannedDays } from "../src/columns.js";
import { layoutChart, buildImageSvg, buildPrintPages } from "../src/export.js";

const today = new Date(Date.UTC(2026, 9, 17));
const iso = (d) => d && d.toISOString().slice(0, 10);
const D = (s) => new Date(s + "T00:00:00Z");

// ---- durations: [start, 5d] means five days starting on start (end day included)
assert.equal(parseDuration("5d"), 5);
assert.equal(parseDuration("2w"), 14);
assert.equal(parseDuration(" 10 days "), 10);
assert.equal(parseDuration("1 week"), 7);
assert.equal(parseDuration("0d"), null);
assert.equal(parseDuration("soon"), null);
assert.equal(parseDuration(5), null);                       // bare numbers are not durations
const [dur, durMulti, durFact] = buildTasks([
  { label: "d", plan: ["2026-09-07", "5d"] },
  { label: "m", plan: [["2026-09-07", "3d"], ["2026-09-21", "2w"]] },
  { label: "f", fact: ["2026-09-07", "1w"] },
], today);
assert.equal(iso(dur.datePlannedEnd), "2026-09-11");
assert.equal(plannedDays(dur), 5);
assert.deepEqual(durMulti.planSegs.map((s) => [iso(s.start), iso(s.end)]), [["2026-09-07", "2026-09-09"], ["2026-09-21", "2026-10-04"]]);
assert.equal(iso(durFact.dateActualEnd), "2026-09-13");
assert.equal(durFact.factOpen, false);

// ---- parent rows take their dates from their subtasks (unless they set their own)
const rolled = buildTasks([
  { label: "Parent", children: [
    { label: "A", plan: ["2026-09-07", "2026-09-10"], fact: ["2026-09-07", "2026-09-12"] },
    { label: "B", plan: ["2026-09-14", "2026-09-20"], fact: ["2026-09-14"] },
    { label: "C", plan: ["2026-09-25", "2026-09-30"] },
  ] },
  { label: "Own dates", plan: ["2026-01-01", "2026-01-02"], children: [{ label: "x", plan: ["2026-09-07", "2026-09-10"] }] },
  { label: "Deep", children: [{ label: "Mid", children: [{ label: "leaf", plan: ["2026-11-02", "2026-11-06"], fact: ["2026-11-02", "2026-11-05"] }] }] },
], today);
const [parent, , , , own, , deep, mid] = rolled;
assert.equal(iso(parent.datePlannedStart), "2026-09-07");
assert.equal(iso(parent.datePlannedEnd), "2026-09-30");
assert.equal(parent.planSegs.length, 1);                    // one summary bar
assert.equal(iso(parent.dateActualStart), "2026-09-07");
assert.equal(parent.factOpen, true);                        // B is open (and C has not started)
assert.equal(iso(parent.dateActualEnd), "2026-10-17");
assert.ok(parent.planDerived && parent.factDerived);
assert.equal(iso(own.datePlannedStart), "2026-01-01");      // own dates win
assert.ok(!own.planDerived);
assert.equal(iso(mid.datePlannedEnd), "2026-11-06");        // rolls up through several levels
assert.equal(iso(deep.datePlannedStart), "2026-11-02");
assert.equal(deep.factOpen, false);                         // every subtask with a plan is finished
assert.equal(deep.progress, 100);
assert.equal(buildTasks([{ label: "p", children: [{ label: "empty" }] }], today)[0].planSegs.length, 0); // nothing to roll up

// ---- manual progress
const [p1, p2, p3, p4] = buildTasks([
  { label: "a", plan: ["2026-09-07", "2026-09-12"], progress: 40 },
  { label: "b", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-10"], progress: "60%" },
  { label: "c", progress: 250 },
  { label: "d", progress: "lots" },
], today);
assert.equal(p1.progress, 40);
assert.equal(p2.progress, 60);                              // overrides the calculated 100
assert.equal(p3.progress, 100);                             // clamped
assert.equal(p4.progress, 0);                               // unreadable: ignored
assert.equal(p1.extra.progress, undefined);                 // not a custom column any more
const cols = buildColumns([p1, p4]);
const progressCol = cols.find((c) => c.id === "progress");
assert.equal(cellText(progressCol, p1, { today }), "40%");  // shown even with no actual dates
assert.equal(cellText(progressCol, p4, { today }), "–");

// ---- colours: hex or plain names only
const [c1, c2, c3, c4] = buildTasks([
  { label: "1", color: "#e06c75" }, { label: "2", color: "teal" }, { label: "3", color: '" onload="x' }, { label: "4", color: "rgb(1,2,3)" },
], today);
assert.deepEqual([c1.color, c2.color, c3.color, c4.color], ["#e06c75", "teal", null, null]);
assert.equal(c1.extra.color, undefined);

// ---- markers
const mk = readMarkers([
  { date: "2026-10-10", label: "Deadline" },
  ["2026-09-01", "Kick-off"],
  "2026-11-02 - Half term",
  "2026-12-25",
  { date: "nonsense", label: "bad" },
  { label: "no date" },
]);
assert.deepEqual(mk.map((m) => [iso(m.date), m.label]), [["2026-09-01", "Kick-off"], ["2026-10-10", "Deadline"], ["2026-11-02", "Half term"], ["2026-12-25", ""]]);
assert.deepEqual(readMarkers(undefined), []);
assert.equal(readBlockOptions({ markers: [{ date: "2026-10-10", label: "x" }] }).markers.length, 1);
assert.equal(readBlockOptions({ weekends: true }).weekends, true);
assert.equal(readBlockOptions({ weekends: "yes" }).weekends, false);

// the axis grows to include a marker, and the marker lines up with the same column convention as today
const t1 = buildTasks([{ label: "t", plan: ["2026-09-07", "2026-09-12"] }], today);
const opts = { padding: 3, hatch: true, progress: true, markers: readMarkers([{ date: "2027-02-01", label: "Far" }]), weekends: true };
const axis = makeAxis(t1, today, "day", 3, undefined, opts.markers.map((m) => m.date));
assert.ok(axis.end > D("2027-02-01"));
const [shape] = markerShapes(axis, opts);
assert.ok(Math.abs(shape.x - (axis.x(D("2027-02-01")) + axis.ppd / 2)) < 1e-9);

// ---- weekends: Saturday + Sunday as one block each, day scale only
const spans = weekendSpans(axis, opts);
assert.ok(spans.length > 20);
assert.ok(spans.every((s) => Math.abs(s.w - 2 * axis.ppd) < 1e-9 || Math.abs(s.w - axis.ppd) < 1e-9));
const sat = spans.find((s) => Math.abs(s.x - axis.x(D("2026-09-12"))) < 1e-9);       // 12 Sep 2026 is a Saturday
assert.ok(sat && Math.abs(sat.w - 2 * axis.ppd) < 1e-9);
assert.equal(weekendSpans(makeAxis(t1, today, "week", 3), opts).length, 0);
assert.equal(weekendSpans(axis, { weekends: false }).length, 0);

// ---- colours reach the bars
const colourful = buildTasks([{ label: "c", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-10"], color: "#e06c75" }, { label: "plain", plan: ["2026-09-07", "2026-09-12"] }], today);
const bars = bodyBars(colourful, makeAxis(colourful, today, "day", 3), "both", { progress: true }, today, { rowH: 40, barTop: 7 });
assert.deepEqual(bars.map((b) => b.color), ["#e06c75", "#e06c75", null]);
assert.deepEqual(barColors(bars), ["#e06c75"]);

// ---- export: marker, weekend shading and colour appear, and the SVG stays well-formed
const colDefs = buildColumns(colourful);
const model = layoutChart({ tasks: colourful, columns: colDefs.slice(0, 2), scale: "day", mode: "both", opts, today });
const svg = buildImageSvg(model, { title: "T", legend: true }).svg;
assert.ok(svg.includes('stroke-dasharray="5 3"') && svg.includes("Far"));
assert.ok(svg.includes('fill-opacity="0.06"'));                      // weekend shading
assert.ok(svg.includes('fill="#e06c75"') && svg.includes("hatch-0"));
assert.ok(svg.includes(">Marker<"));                                 // legend entry
const tags = svg.match(/<\/?[a-zA-Z][^>]*>/g);
const stack = [];
for (const tag of tags) {
  if (tag.endsWith("/>")) continue;
  const name = tag.match(/^<\/?([a-zA-Z]+)/)[1];
  if (tag.startsWith("</")) assert.equal(stack.pop(), name);
  else stack.push(name);
}
assert.equal(stack.length, 0);
const pages = buildPrintPages(layoutChart({ tasks: colourful, columns: [], scale: "day", mode: "both", opts, today, density: "print", fit: { width: 1000 } }), { title: "T" });
assert.ok(pages.length >= 1 && pages[0].includes("Far"));

// ---- the whole thing together, from YAML text
const yamlLib = (() => { const m = { exports: {} }; new Function("module", "exports", "window", fs.readFileSync(new URL("../vendor/js-yaml.min.js", import.meta.url), "utf8"))(m, m.exports, globalThis); return m.exports.load ? m.exports : globalThis.jsyaml ?? m.exports; })();
const doc = yamlLib.load(normalizeYaml(`weekends: true
markers:
  - date: 2026-10-10
    label: Deadline
  - 2026-11-02 Half term
rows:
  - label: Phase
    color: "#98c379"
    progress: 30%
    plan: [2026-09-07, 2w], [2026-10-05, 5d]
`));
const o = readBlockOptions(doc);
assert.equal(o.weekends, true);
assert.deepEqual(o.markers.map((m) => m.label), ["Deadline", "Half term"]);
const [phase] = buildTasks(doc.rows, today);
assert.deepEqual(phase.planSegs.map((s) => [iso(s.start), iso(s.end)]), [["2026-09-07", "2026-09-20"], ["2026-10-05", "2026-10-09"]]);
assert.equal(phase.progress, 30);
assert.equal(phase.color, "#98c379");
console.log("features ok");
