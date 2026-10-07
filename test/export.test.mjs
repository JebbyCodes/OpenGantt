import assert from "node:assert/strict";
import { buildTasks, readBlockOptions, visibleTasks } from "../src/model.js";
import { buildColumns, resolveLayout, visibleColumns } from "../src/columns.js";
import { fitText, layoutChart, planPages, renderSvg, buildImageSvg, buildPrintPages, buildPrintHtml, buildCsv, exportFileName, legendLayout } from "../src/export.js";

const today = new Date(Date.UTC(2026, 9, 6));
const opts = readBlockOptions({});
const rows = [
  { label: "Stage <1> & \"co\"", plan: ["2026-09-07", "2026-09-12"], fact: ["2026-09-07", "2026-09-14"], owner: "Sam, Jr.",
    children: [{ label: "Child", plan: ["2026-09-07", "2026-09-10"], fact: ["2026-09-07"] }] },
  { label: "Later", plan: ["2027-01-01", "2027-03-01"] },
];
const tasks = buildTasks(rows, today);
const cols = buildColumns(tasks);
const shown = visibleColumns(cols, resolveLayout(cols, {}));

// ---- text fitting
assert.equal(fitText("short", 500, 13, false), "short");
const cut = fitText("a very long task name indeed", 80, 13, false);
assert.ok(cut.endsWith("\u2026") && cut.length < 20);
assert.equal(fitText("anything", 0, 13, false), "");

// ---- tiny well-formedness check: every element is closed, no raw & or < inside text, attributes quoted
function assertWellFormed(svg) {
  const tags = svg.match(/<[^>]+>/g);
  const stack = [];
  for (const t of tags) {
    if (t.startsWith("<?")) continue;
    if (t.startsWith("</")) assert.equal(stack.pop(), t.slice(2, -1).trim(), "mismatched " + t);
    else if (!t.endsWith("/>")) stack.push(t.slice(1).split(/[\s>]/)[0]);
  }
  assert.equal(stack.length, 0, "unclosed: " + stack);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(svg), "raw ampersand");
  assert.ok(!/>[^<]*<[^/a-zA-Z!?]/.test(svg));
}

// ---- image export
const screen = layoutChart({ tasks, columns: shown, scale: "week", mode: "both", opts, today });
const img = buildImageSvg(screen, { theme: "light", title: "Plan <A>", legend: true });
assertWellFormed(img.svg);
assert.ok(img.svg.includes("Stage &lt;1&gt; &amp; &quot;co&quot;"));          // names are escaped
assert.ok(img.svg.includes("Plan &lt;A&gt;"));
assert.equal(img.width, Math.round(screen.width) + 16);
assert.ok(img.svg.includes("Not started"));                                     // legend present
assert.ok(!buildImageSvg(screen, { legend: false }).svg.includes("Not started"));
assert.ok(buildImageSvg(screen, { theme: "dark" }).svg.includes("#1d2021"));
// same data, hidden table: only the name column remains
const noTable = layoutChart({ tasks, columns: [], scale: "week", mode: "both", opts, today });
assert.ok(noTable.width < screen.width);
assertWellFormed(buildImageSvg(noTable, {}).svg);
// plan / actual modes draw only their bars
const planOnly = layoutChart({ tasks, columns: [], scale: "week", mode: "planned", opts, today });
assert.ok(planOnly.bars.every((b) => b.kind === "plan"));
// column widths grow to fit long values (up to a cap)
const wide = buildTasks([{ label: "x", owner: "A".repeat(80), plan: ["2026-09-07"] }], today);
const wcols = buildColumns(wide).filter((c) => c.id === "key:owner");
const wl = layoutChart({ tasks: wide, columns: wcols, scale: "day", mode: "both", opts, today });
assert.ok(wl.cols[0].w >= 80 && wl.cols[0].w <= 320);

// ---- print fit: a long chart is squeezed to about one page wide, a short one is left alone
const longRows = Array.from({ length: 3 }, (_, i) => ({ label: `Row ${i}`, plan: ["2026-01-01", "2027-06-30"] }));
const lt = buildTasks(longRows, today);
const natural = layoutChart({ tasks: lt, columns: shown, scale: "day", mode: "both", opts, today, density: "print" });
const fitted = layoutChart({ tasks: lt, columns: shown, scale: "day", mode: "both", opts, today, density: "print", fit: { width: 1000, minTimeline: 360 } });
assert.ok(natural.width > 10000);
assert.ok(fitted.width < 1100 && fitted.width >= 1000 - 1);
assert.ok(fitted.axis.ppd < natural.axis.ppd);
const shortFit = layoutChart({ tasks, columns: [], scale: "week", mode: "both", opts, today, density: "print", fit: { width: 5000, minTimeline: 360 } });
assert.equal(shortFit.axis.ppd, 9);                                              // never stretched

// ---- page planning: contiguous, complete, balanced, never fewer than 3 rows
for (const orientation of ["landscape", "portrait"]) {
  for (const count of [0, 1, 5, 19, 20, 21, 57, 200]) {
    for (const width of [600, 1000, 3000]) {
      const r = planPages(count, { overhead: 170, rowH: 30, width, orientation });
      assert.ok(r.length >= 1);
      assert.equal(r[0][0], 0);
      assert.equal(r[r.length - 1][1], count);
      r.forEach(([a, b], i) => { assert.ok(b >= a); if (i) assert.equal(a, r[i - 1][1]); });
      const sizes = r.map(([a, b]) => b - a);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1 || count === 0, "balanced");
    }
  }
}
assert.equal(planPages(10, { overhead: 170, rowH: 30, width: 1000, orientation: "landscape" }).length, 1);
assert.ok(planPages(80, { overhead: 170, rowH: 30, width: 1000, orientation: "landscape" }).length > 1);

// a page's height must fit the sheet once scaled to the page width (A4 landscape content: 1047 x 718 css px)
const many = buildTasks(Array.from({ length: 70 }, (_, i) => ({ label: `Task ${i}`, plan: ["2026-09-07", "2026-10-30"] })), today);
const pm = layoutChart({ tasks: many, columns: shown, scale: "week", mode: "both", opts, today, density: "print", fit: { width: 1000, minTimeline: 360 } });
for (const orientation of ["landscape", "portrait"]) {
  const pages = buildPrintPages(pm, { title: "T", orientation });
  assert.ok(pages.length > 1);
  const paper = orientation === "landscape" ? { w: 1047, h: 718 } : { w: 740, h: 980 };
  // narrowest sheet we support (Letter) is the width limit; the shortest sheet is the height limit
  pages.forEach((p, i) => {
    assertWellFormed(p);
    const [, W, H] = p.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
    const scale = Math.min(1, paper.w / W);
    assert.ok(H * scale <= paper.h, `page ${i + 1} too tall (${H * scale} > ${paper.h})`);
    assert.ok(p.includes(`Page ${i + 1} of ${pages.length}`));
  });
  // every task appears exactly once across the pages
  const all = pages.join("");
  for (let i = 0; i < 70; i += 7) assert.equal(all.split(`>Task ${i}<`).length - 1, 1);
}
assert.ok(buildPrintPages(pm, { title: "T" })[0].includes(">T<"));                // title on the first page only
assert.ok(!buildPrintPages(pm, { title: "T" })[1].includes(">T<"));
const html = buildPrintHtml(["<svg/>"], { title: "A<B", orientation: "portrait" });
assert.ok(html.includes("size:portrait") && html.includes("<title>A&lt;B</title>"));

// ---- legend wraps within the width
const lg = legendLayout(screen, 300);
assert.ok(lg.h > 18);
assert.ok(lg.items.every((it) => it.x + it.w <= 300 || it.x === 0));

// ---- CSV
const csv = buildCsv(tasks, shown.concat(cols.filter((c) => c.id === "key:owner")), today);
const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
assert.equal(lines[0], "Task,Level,Progress,Start planned,End planned,Start actual,End actual,Owner");
assert.equal(lines[1], '"Stage <1> & ""co""",1,100,2026-09-07,2026-09-12,2026-09-07,2026-09-14,"Sam, Jr."');
assert.ok(lines[2].startsWith("Child,2,"));
assert.equal(lines.length, 5);                                                   // header + 3 tasks + trailing newline
assert.ok(csv.startsWith("\uFEFF"));

// ---- file names
assert.equal(exportFileName('My "plan": v1/2', "png", today), "My -plan- v1-2 gantt 2026-10-06.png");
assert.equal(exportFileName("", "csv", today), "Gantt gantt 2026-10-06.csv");
console.log("export ok");
