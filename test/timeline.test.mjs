import assert from "node:assert/strict";
import { buildTasks } from "../src/model.js";
import { makeAxis, barsFor, taskStatus, DAY } from "../src/timeline.js";
const today = new Date(Date.UTC(2026, 9, 6));
const t = buildTasks([{label:"a",plan:["2026-09-07","2026-09-12"],fact:["2026-09-07","2026-09-14"]},{label:"b",plan:["2026-09-30","2026-10-16"],fact:["2026-09-17"]}], today);
for (const sc of ["day","week","month","year"]) {
  const ax = makeAxis(t, today, sc, 7);
  const [p,a] = barsFor(t[0], ax, "both", {progress:true}, today);
  assert.equal(p.x, ax.x(t[0].datePlannedStart));
  assert.ok(a.w > p.w);
  const [,pr] = barsFor(t[1], ax, "both", {progress:true}, today);
  assert.equal(pr.kind, "progress");
  // progress bar ends at the same x as the today line's day column
  assert.ok(Math.abs((pr.x + pr.w) - (ax.x(today) + ax.ppd)) < 1e-6);
  assert.ok(Math.abs(ax.todayX - (ax.x(today) + ax.ppd/2)) < 1e-6);
  assert.ok(ax.bottom.length > 0 && ax.width > 0);
}
assert.equal(taskStatus(t[0], today), "late"); // actual end 14 Sep > plan end 12 Sep
assert.equal(taskStatus(t[1], today), "progress");
console.log("timeline ok");
