import assert from "node:assert/strict";
import { buildTasks } from "../src/model.js";
import {
  buildColumns, matchColumn, resolveLayout, mergeSaved, visibleColumns, moveBefore, moveStep, moveToVisibleSlot,
  varianceDays, plannedDays, actualDays, cellText, humanize, DEFAULT_SHOWN,
} from "../src/columns.js";

const today = new Date(Date.UTC(2026, 9, 6));
const env = { today };
const tasks = buildTasks([
  { label: "done late", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-14"], owner: "Sam", assigned_to: "Alex" },
  { label: "done early", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-10"] },
  { label: "overdue open", plan: ["2026-09-21", "2026-09-29"], fact: ["2026-09-17"], status: "Blocked" },
  { label: "future", plan: ["2026-11-01", "2026-11-05"] },
  { label: "milestone", plan: ["2026-11-10"] },
  { label: "no dates", notes: "  a\n note  " },
], today);
const [late, early, open, future, milestone, none] = tasks;

// ---- values
assert.equal(varianceDays(late, today), 2);          // finished 2 days after plan
assert.equal(varianceDays(early, today), -2);        // finished 2 days early
assert.equal(varianceDays(open, today), 7);          // 29 Sep -> 6 Oct, still open
assert.equal(varianceDays(future, today), null);     // not due yet
assert.equal(varianceDays(none, today), null);
assert.equal(plannedDays(late), 6);                  // inclusive
assert.equal(plannedDays(milestone), 1);
assert.equal(plannedDays(none), null);
assert.equal(actualDays(open, today), 20);           // 17 Sep .. 6 Oct inclusive
assert.equal(actualDays(future, today), null);

// ---- built-in + custom columns
const cols = buildColumns(tasks);
const byId = Object.fromEntries(cols.map((c) => [c.id, c]));
assert.deepEqual(cols.slice(0, 5).map((c) => c.id), DEFAULT_SHOWN);                // v3 columns first, v3 widths
assert.deepEqual(cols.slice(0, 5).map((c) => c.width), [70, 92, 92, 92, 92]);
assert.ok(byId["key:owner"] && !byId["key:owner"].builtin);
assert.equal(byId["key:owner"].label, "Owner");
assert.equal(byId["key:assignedto"].label, "Assigned to");
assert.equal(byId["key:status"].label, "Status (custom)");                          // clashes with built-in Status
assert.equal(cellText(byId["key:owner"], late, env), "Sam");
assert.equal(cellText(byId["key:owner"], early, env), "");
assert.equal(cellText(byId.variance, late, env), "+2 d");
assert.equal(cellText(byId.variance, early, env), "\u22122 d");
assert.equal(cellText(byId.variance, future, env), "–");
assert.equal(cellText(byId.status, late, env), "Completed late");
assert.equal(byId.status.cls(open, env), "epq-st-overdue");
assert.equal(cellText(byId.notes, none, env), "a note");                              // whitespace collapsed
assert.equal(cellText(byId.actualEnd, open, env), "ongoing");
assert.equal(byId.actualEnd.raw(open, env), "");                                      // CSV: no fake end date
assert.equal(byId.planStart.raw(late, env), "2026-09-07");
assert.equal(humanize("assigned_to"), "Assigned to");

// a `columns:` entry for a key no row has yet becomes an (empty) custom column
const withExtra = buildColumns(tasks, ["Reviewer", "progress"]);
assert.ok(withExtra.find((c) => c.id === "key:reviewer"));
assert.equal(withExtra.filter((c) => c.id === "progress").length, 1);                 // known names are not duplicated

// ---- matching
assert.equal(matchColumn(cols, "Start planned"), "planStart");
assert.equal(matchColumn(cols, "start-planned"), "planStart");
assert.equal(matchColumn(cols, "planStart"), "planStart");
assert.equal(matchColumn(cols, "OWNER"), "key:owner");
assert.equal(matchColumn(cols, "nonsense"), null);
assert.equal(matchColumn(cols, ""), null);

// ---- layouts
const ids = cols.map((c) => c.id);
let L = resolveLayout(cols, {});
assert.deepEqual(L.order, ids);
assert.deepEqual([...L.shown], DEFAULT_SHOWN);
L = resolveLayout(cols, { yaml: ["owner", "Start planned", "bogus", "owner"] });
assert.deepEqual(L.order.slice(0, 2), ["key:owner", "planStart"]);
assert.deepEqual([...L.shown], ["key:owner", "planStart"]);                           // yaml list = exactly what is shown
assert.equal(L.order.length, ids.length);                                              // the rest follow, hidden
assert.deepEqual([...resolveLayout(cols, { yaml: [] }).shown], []);                    // `columns: none`
// saved layout from another chart mentions columns this one lacks, and misses ones it has
L = resolveLayout(cols, { saved: { order: ["ghost", "status", "progress"], shown: ["ghost", "status"] } });
assert.deepEqual(L.order.slice(0, 2), ["status", "progress"]);
assert.ok(!L.order.includes("ghost"));
assert.equal(L.order.length, ids.length);
assert.deepEqual([...L.shown], ["status"]);
assert.deepEqual(visibleColumns(cols, L).map((c) => c.id), ["status"]);
// saving from a chart keeps the other chart's columns
const saved = mergeSaved({ order: ["status", "progress"], shown: new Set(["status"]) }, { order: ["ghost", "progress"], shown: ["ghost"] });
assert.deepEqual(saved, { order: ["status", "progress", "ghost"], shown: ["status", "ghost"] });

// ---- reordering
assert.deepEqual(moveBefore(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
assert.deepEqual(moveBefore(["a", "b", "c"], "a", null), ["b", "c", "a"]);
assert.deepEqual(moveBefore(["a", "b"], "a", "zzz"), ["a", "b"]);                      // unknown target: no change
assert.deepEqual(moveStep(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
assert.deepEqual(moveStep(["a", "b", "c"], "a", -1), ["a", "b", "c"]);                 // at the edge: no change
assert.deepEqual(moveStep(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
// dragging among visible columns while hidden ones stay put:  order a(h) b c(h) d e   shown b d e
const order = ["a", "b", "c", "d", "e"];
const shown = new Set(["b", "d", "e"]);
assert.deepEqual(moveToVisibleSlot(order, shown, "e", 0), ["a", "e", "b", "c", "d"]);   // to the front of the visible ones
assert.deepEqual(moveToVisibleSlot(order, shown, "b", 2), ["a", "c", "d", "e", "b"]);   // past the last visible
assert.deepEqual(moveToVisibleSlot(order, shown, "b", 1), ["a", "c", "d", "b", "e"]);
assert.deepEqual(moveToVisibleSlot(order, shown, "d", 1), order);                        // already there
for (const id of ["b", "d", "e"]) for (let slot = 0; slot <= 2; slot++) {               // never loses or duplicates a column
  assert.deepEqual([...moveToVisibleSlot(order, shown, id, slot)].sort(), [...order].sort());
}
assert.deepEqual(moveToVisibleSlot(["a", "b"], new Set(["a"]), "a", 0), ["a", "b"]);     // the only visible column
console.log("columns ok");
