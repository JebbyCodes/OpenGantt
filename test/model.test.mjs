import assert from "node:assert/strict";
import { buildTasks, toDate, readBlockOptions } from "../src/model.js";

const today = new Date(Date.UTC(2026, 9, 6));
const iso = (d) => d && d.toISOString().slice(0, 10);

// Obsidian's parseYaml may hand back strings or Date objects - both must work.
assert.equal(iso(toDate("2026-09-07")), "2026-09-07");
assert.equal(iso(toDate(new Date(Date.UTC(2026, 8, 7)))), "2026-09-07");
assert.equal(toDate("nonsense"), null);

const rows = [
  { label: "Stage 1", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-14"],
    children: [{ label: "Child", plan: [new Date(Date.UTC(2026, 8, 7)), new Date(Date.UTC(2026, 8, 10))], fact: ["2026-09-07"] }] },
  { label: "Open actual", plan: ["2026-09-30", "2026-10-16"], fact: ["2026-09-17"] },
  { label: "No dates" },
  { label: "Milestone", plan: ["2027-01-18"] },
];
const t = buildTasks(rows, today);
assert.equal(t.length, 5);
assert.equal(t[0].progress, 100);
assert.equal(t[1].parentId, t[0].id);
assert.equal(iso(t[1].dateActualEnd), "2026-10-06");           // one-date fact runs to today
assert.equal(t[2].progress, Math.round((6 / 16) * 100));         // 30 Sep -> 6 Oct of a 16-day plan
assert.equal(t[3].datePlannedStart, null);
assert.equal(iso(t[4].datePlannedEnd), "2027-01-18");            // single plan date = same-day end
assert.equal(new Set(t.map((x) => x.id)).size, t.length);        // ids unique

assert.deepEqual(readBlockOptions({}), { scale: "day", mode: "both", height: 520, padding: 7, hatch: true, progress: true, editable: false, collapsed: false, columns: null, table: null, title: null });
assert.deepEqual(readBlockOptions({ scale: "week", mode: "plan", height: 9999, editable: true }),
  { scale: "week", mode: "planned", height: 1600, padding: 7, hatch: true, progress: true, editable: true, collapsed: false, columns: null, table: null, title: null });
console.log("model tests passed");
assert.equal(readBlockOptions({ padding: 21 }).padding, 21);
console.log("padding ok");
assert.equal(readBlockOptions({ hatch: false }).hatch, false);
console.log("hatch ok");
assert.equal(readBlockOptions({ progress: false }).progress, false);
console.log("progress ok");
assert.equal(t[0].factOpen, false);
assert.equal(t[1].factOpen, true);   // child has fact: [start] only
assert.equal(t[2].factOpen, true);
assert.equal(t[3].factOpen, false);  // no fact at all

import { visibleTasks, parentIds } from "../src/model.js";
assert.equal(t[0].hasChildren, true);
assert.equal(t[1].depth, 1);
assert.deepEqual(parentIds(t), [t[0].id]);
assert.equal(visibleTasks(t, new Set()).length, 5);
assert.equal(visibleTasks(t, new Set([t[0].id])).length, 4);       // child hidden
assert.equal(readBlockOptions({ startCollapsed: true }).collapsed, true);
assert.deepEqual(t.map((x) => x.order), [0, 1, 2, 3, 4]);
console.log("order ok");


// Extra row keys become custom-column data; nested values and blanks are ignored; dates become ISO text.
import { normKey } from "../src/model.js";
const ex = buildTasks([{ label: "x", owner: "Sam", tags: ["a", "b"], nested: { a: 1 }, blank: "  ", n: 3, when: new Date(Date.UTC(2026, 8, 7)) }], today)[0].extra;
assert.deepEqual(ex, { owner: "Sam", tags: "a, b", n: "3", when: "2026-09-07" });
assert.deepEqual(buildTasks([{ label: "y", notes: "n", plan: ["2026-09-07"] }], today)[0].extra, {}); // known keys are not extras
assert.equal(normKey("Start planned"), normKey("start-planned"));
console.log("extras ok");

// columns / table / title options
assert.deepEqual(readBlockOptions({ columns: ["progress", "Owner"] }).columns, ["progress", "Owner"]);
assert.deepEqual(readBlockOptions({ columns: "progress, owner" }).columns, ["progress", "owner"]);
assert.deepEqual(readBlockOptions({ columns: "none" }).columns, []);
assert.deepEqual(readBlockOptions({ columns: [] }).columns, []);
assert.equal(readBlockOptions({}).columns, null);
assert.equal(readBlockOptions({ table: false }).table, false);
assert.equal(readBlockOptions({ table: "hidden" }).table, false);
assert.equal(readBlockOptions({ table: true }).table, true);
assert.equal(readBlockOptions({ title: "  Plan " }).title, "Plan");
console.log("layout options ok");
