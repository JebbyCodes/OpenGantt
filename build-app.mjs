// Builds dist/Gantt.html: the whole app (chart code from src/, the app shell, js-yaml) in ONE file that runs
// offline from a double-click. No dependencies; the src/ modules are used as they are.
import fs from "node:fs";
const R = (f) => fs.readFileSync(f, "utf8");
const b64 = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const rewrite = (c) => c.replace(/from "\.\/(\w+)\.js"/g, 'from "gantt-$1"').replace('import "./styles.css";', 'import "gantt-styles";');

const imports = {};
for (const f of ["model", "timeline", "columns", "chart", "export", "main"]) imports[`gantt-${f}`] = b64(rewrite(R(`src/${f}.js`)));
imports["gantt-styles"] = b64(`const s=document.createElement("style");s.textContent=${JSON.stringify(R("src/styles.css"))};document.head.append(s);export default {};`);
imports.obsidian = b64(R("app/shim.js"));
imports["gantt-shell"] = b64(R("app/shell.js"));

// The chart behind the Example button. "Example Gantt.md" wins if it is there; otherwise this stands in,
// so the build works whether or not that note is kept in the repo.
const DEFAULT_EXAMPLE = `scale: week
mode: both
title: Example project
rows:
  - label: Stage 1 - Plan
    plan: [2026-09-07, 2026-09-12]
    fact: [2026-09-07, 2026-09-14]
    children:
      - label: Collect requirements
        plan: [2026-09-07, 2026-09-09]
        fact: [2026-09-07, 2026-09-10]
      - label: Write the spec
        plan: [2026-09-10, 2026-09-12]
        fact: [2026-09-11, 2026-09-14]
  - label: Stage 2 - Build
    plan: [2026-09-15, 2026-10-10]
    fact: [2026-09-15]
    notes: Still in progress - the bar runs to today.
  - label: Stage 3 - Ship
    plan: [2026-10-12, 2026-10-16]
`;

function example() {
  const file = "Example Gantt.md";
  if (!fs.existsSync(file)) return DEFAULT_EXAMPLE;
  const m = R(file).match(/```gantt\n([\s\S]*?)```/);
  return m ? m[1].replace(/\n$/, "") : DEFAULT_EXAMPLE;
}

// Favicon: a logo.png in the project root is embedded as a data URI, so dist/Gantt.html stays one
// self-contained file - no separate image to lose and no network request. The very same logo.png is what
// `npx tauri icon logo.png` turns into the desktop app's icons, so there is only one image to keep.
let icon = "";
if (fs.existsSync("logo.png")) {
  icon = `<link rel="icon" type="image/png" href="data:image/png;base64,${fs.readFileSync("logo.png").toString("base64")}">`;
}

const safe = (s) => s.replace(/<\/(script)/gi, "<\\/$1");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gantt</title>${icon}
<style>${R("app/app.css")}</style>
</head><body>
<header class="top"><b>Gantt</b>
<button id="open" title="Open a .md note, a .yaml chart or any text file (Ctrl+O)">Open&hellip;</button>
<button id="save" title="Save back to the file you opened (Ctrl+S)">Save</button>
<button id="saveas" title="Save as a new .yaml chart or .md note (Ctrl+Shift+S)">Save as&hellip;</button>
<button id="copy" title="Copy the chart as a gantt block, ready to paste into a note">Copy as Obsidian block</button>
<button id="example">Example</button>
<span id="file"></span><span class="sp"></span><button id="toggle">Hide editor</button></header>
<main><section id="editorWrap"><textarea id="editor" spellcheck="false" aria-label="Gantt YAML"></textarea></section><section id="chart"></section></main>
<input type="file" id="picker" accept=".yaml,.yml,.md,.markdown,.txt" hidden><div id="toasts"></div>
<script>${safe(R("vendor/js-yaml.min.js"))}</script>
<script>window.__GANTT_EXAMPLE__=${safe(JSON.stringify(example()))};</script>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module">import "gantt-shell";</script>
</body></html>
`;
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/Gantt.html", html);
console.log(`dist/Gantt.html  ${(html.length / 1024).toFixed(0)} KB  (example: ${fs.existsSync("Example Gantt.md") ? "Example Gantt.md" : "built-in"})`);
console.log(icon ? "favicon: logo.png embedded" : "favicon: none (drop a logo.png in the project root to add one)");
