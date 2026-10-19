import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeYaml, buildTasks, readBlockOptions } from "../src/model.js";
import { canonicalDoc, dumpYaml, emptyRow, ops, rowAt, walkRows } from "../src/serialize.js";

const lib = (() => { const m = { exports: {} }; new Function("module", "exports", "window", fs.readFileSync(new URL("../vendor/js-yaml.min.js", import.meta.url), "utf8"))(m, m.exports, globalThis); return m.exports.load ? m.exports : globalThis.jsyaml ?? m.exports; })();
const parse = (t) => lib.load(normalizeYaml(t));
const today = new Date(Date.UTC(2026, 9, 17));

const SRC = `title: "Launch: v2"
scale: week
mode: both
weekends: true
tagLabels: false
sort: -progress
markers:
  - date: 2026-10-10
    label: Build deadline
  - [2026-11-02, Half term]
  - 2026-12-25 Christmas
rows:
  - label: Stage 1 - Plan
    plan: [2026-09-07, 2026-09-12]
    fact: [2026-09-07, 2026-09-14]
    tags: [design, "needs: review"]
    owner: Sam
    children:
      - label: Collect requirements
        plan: [2026-09-07, 3d]
        progress: 60%
      - label: "true"
        plan: [[2026-09-10, 2026-09-12]]
  - label: Stage 2 - Build
    plan: [2026-09-15, 2026-10-10]
    fact: [2026-09-15, 2026-09-16], [2026-10-14]
    color: "#d3869b"
    notes: |
      Paused, then restarted.
      Two lines.
    cost: 1200
    sprint: 2026-09-15
  - label: 12345
    tag: a, b
`;

const raw = parse(SRC);
const canon = canonicalDoc(raw);

// ---- canonical shape
assert.equal(canon.opts.title, "Launch: v2");
assert.equal(canon.markers.length, 3);
assert.deepEqual(canon.markers[1], { date: "2026-11-02", label: "Half term" });
assert.deepEqual(canon.rows[0].plan, [["2026-09-07", "2026-09-12"]]);
assert.deepEqual(canon.rows[1].fact, [["2026-09-15", "2026-09-16"], ["2026-10-14"]]);
assert.deepEqual(canon.rows[0].tags, ["design", "needs: review"]);
assert.deepEqual(canon.rows[2].tags, ["a", "b"]);
assert.equal(canon.rows[0].extra.owner, "Sam");
assert.equal(canon.rows[1].extra.sprint, "2026-09-15");   // a date-valued extra stays a date text
assert.equal(canon.rows[1].extra.cost, 1200);
assert.equal(canon.rows[2].label, "12345");
assert.equal(canon.rows[0].children[0].progress, "60%");

// ---- the dumped YAML reads back to the same canonical document (and the same chart)
const text = dumpYaml(canon);
const again = canonicalDoc(parse(text));
assert.deepEqual(again, canon);
assert.deepEqual(dumpYaml(again), text);                  // stable: dumping twice gives identical text
const fromText = buildTasks(parse(text).rows, today);
const fromSrc = buildTasks(raw.rows, today);
assert.deepEqual(fromText.map((t) => [t.name, t.planSegs.map((s) => +s.start), t.factSegs.length, t.progress, t.color, t.tags]),
                 fromSrc.map((t) => [t.name, t.planSegs.map((s) => +s.start), t.factSegs.length, t.progress, t.color, t.tags]));
assert.deepEqual(readBlockOptions(parse(text)).markers.map((m) => m.label), ["Build deadline", "Half term", "Christmas"]);

// ---- what it writes looks hand-written
assert.ok(text.includes('title: "Launch: v2"'));
assert.ok(text.includes("fact: [2026-09-15, 2026-09-16], [2026-10-14]"));   // the side-by-side range form
assert.ok(text.includes('tags: [design, "needs: review"]'));
assert.ok(text.includes('color: "#d3869b"'));
assert.ok(text.includes("progress: 60%"));
assert.ok(text.includes('label: "true"') && text.includes('label: "12345"'));  // would be misread unquoted
assert.ok(text.includes("notes: |\n      Paused, then restarted.\n      Two lines."));
assert.ok(!/\bnull\b/.test(text));

// ---- nasty strings survive
const odd = { opts: {}, markers: [], rows: [{ ...emptyRow('He said "hi": # not a comment'), notes: "  indented\n\nblank line above  ", extra: { "my key": "a, b", flag: "yes", n: "007" }, tags: ["a,b", "c d"] }] };
const o2 = canonicalDoc(parse(dumpYaml(odd)));
assert.equal(o2.rows[0].label, 'He said "hi": # not a comment');
assert.equal(o2.rows[0].notes, "  indented\n\nblank line above  ");
assert.deepEqual(o2.rows[0].extra, { "my key": "a, b", flag: "yes", n: "007" });
assert.deepEqual(o2.rows[0].tags, ["a,b", "c d"]);

// ---- unknown options and empty things
assert.deepEqual(canonicalDoc(parse("rows:\n  - label: a\ncustomOption: 5\nlist: [1, 2]\n")).opts, { customOption: 5, list: [1, 2] });
assert.ok(dumpYaml(canonicalDoc(parse("rows:\n  - label: a\ncustomOption: 5\n"))).startsWith("customOption: 5\nrows:"));
assert.equal(dumpYaml({ opts: {}, markers: [], rows: [] }), "rows:\n");

// ---- row operations
const rows = [emptyRow("A"), emptyRow("B"), emptyRow("C")];
let sel = ops.add(rows, [0]);                       // after A
assert.deepEqual(sel, [1]); assert.deepEqual(rows.map((r) => r.label), ["A", "New task", "B", "C"]);
rows[1].label = "A2";
sel = ops.indent(rows, [1]);                         // A2 becomes a child of A
assert.deepEqual(sel, [0, 0]); assert.equal(rows[0].children[0].label, "A2"); assert.equal(rows.length, 3);
assert.deepEqual(ops.indent(rows, [0]), [0]);        // the first row cannot be indented
sel = ops.add(rows, [0], { child: true });
assert.deepEqual(sel, [0, 1]);
sel = ops.move(rows, [0, 1], -1);
assert.deepEqual(sel, [0, 0]);
assert.deepEqual(ops.move(rows, [0, 0], -1), [0, 0]); // already first: stays
sel = ops.outdent(rows, [0, 0]);                     // out to just after A
assert.deepEqual(sel, [1]); assert.equal(rows[1].label, "New task");
sel = ops.duplicate(rows, [0]);
assert.equal(rows[1].label, "A (copy)");
assert.equal(rowAt(rows, [0, 0]).label, "A2");
sel = ops.remove(rows, [0, 0]);                      // last child removed: parent selected
assert.deepEqual(sel, [0]);
assert.equal(ops.remove([emptyRow("only")], [0]), null);
const seen = [];
walkRows(rows, (r, p) => seen.push(`${p.join(".")}:${r.label}`));
assert.deepEqual(seen, ["0:A", "1:A (copy)", "1.0:A2", "2:New task", "3:B", "4:C"]);
console.log("serialize ok");
