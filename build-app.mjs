// ---------------------------------------------------------------------------
// OpenGantt - standalone app builder
//
// Bundles the whole application into a single HTML file that runs offline from
// a double-click: the chart code from src/, the browser shell from app/, and a
// local copy of js-yaml from vendor/. Nothing is fetched from the network, and
// no bundler is used - the ES modules are inlined as base64 data: imports and
// wired together with an import map.
//
// Two files are written, byte for byte identical:
//
//   dist/Gantt.html   the file you double-click
//   dist/index.html   the name Tauri looks for when it embeds frontendDist
//
// Run with:  npm run build:app
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

// -- configuration ----------------------------------------------------------

const OUT_DIR = "dist";
const OUT_NAME = "Gantt.html";
const ENTRY_NAME = "index.html";
const FAVICON = "logo.png";
const EXAMPLE_NOTE = "Example Gantt.md";

const CHART_MODULES = ["model", "timeline", "columns", "chart", "export", "main"];

const REQUIRED = [
  "app/app.css",
  "app/shell.js",
  "app/shim.js",
  "src/styles.css",
  "vendor/js-yaml.min.js",
  ...CHART_MODULES.map((m) => `src/${m}.js`),
];

// -- small helpers ----------------------------------------------------------

const started = Date.now();
const root = process.cwd();

const read = (file) => fs.readFileSync(file, "utf8");
const exists = (file) => fs.existsSync(file);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const bytes = (s) => Buffer.byteLength(s, "utf8");

function fail(message, hint) {
  console.error("");
  console.error(`  build failed: ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  process.exit(1);
}

function reportList(title, entries) {
  console.log("");
  console.log(title);
  const width = Math.max(...entries.map(([name]) => name.length));
  for (const [name, value] of entries) {
    console.log(`  ${name.padEnd(width)}  ${String(value).padStart(9)}`);
  }
}

// -- preflight --------------------------------------------------------------

for (const file of REQUIRED) {
  if (!exists(file)) {
    fail(
      `${file} is missing`,
      `Run this from the OpenGantt project root (currently ${root}).`,
    );
  }
}

// -- build ------------------------------------------------------------------

const rewriteImports = (code) =>
  code
    .replace(/from "\.\/(\w+)\.js"/g, 'from "gantt-$1"')
    .replace('import "./styles.css";', 'import "gantt-styles";');

const b64 = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const imports = {};
const moduleSizes = [];

for (const name of CHART_MODULES) {
  const source = rewriteImports(read(`src/${name}.js`));
  imports[`gantt-${name}`] = b64(source);
  moduleSizes.push([`src/${name}.js`, kb(bytes(source))]);
}

const styles = read("src/styles.css");
imports["gantt-styles"] = b64(
  `const s=document.createElement("style");s.textContent=${JSON.stringify(styles)};document.head.append(s);export default {};`,
);
moduleSizes.push(["src/styles.css", kb(bytes(styles))]);

imports.obsidian = b64(read("app/shim.js"));
imports["gantt-shell"] = b64(read("app/shell.js"));

moduleSizes.push(["app/shim.js", kb(fs.statSync("app/shim.js").size)]);
moduleSizes.push(["app/shell.js", kb(fs.statSync("app/shell.js").size)]);

// -- the example chart ------------------------------------------------------

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

function exampleSource() {
  if (!exists(EXAMPLE_NOTE)) return { yaml: DEFAULT_EXAMPLE, from: "built-in sample" };
  const match = read(EXAMPLE_NOTE).match(/```gantt\n([\s\S]*?)```/);
  if (!match) return { yaml: DEFAULT_EXAMPLE, from: "built-in sample" };
  return { yaml: match[1].replace(/\n$/, ""), from: EXAMPLE_NOTE };
}

// -- the favicon ------------------------------------------------------------

function faviconTag() {
  if (!exists(FAVICON)) return { tag: "", from: null };
  const data = fs.readFileSync(FAVICON).toString("base64");
  return {
    tag: `<link rel="icon" type="image/png" href="data:image/png;base64,${data}">`,
    from: `${FAVICON} (${kb(fs.statSync(FAVICON).size)})`,
  };
}

// -- assemble ---------------------------------------------------------------

const safe = (s) => s.replace(/<\/(script)/gi, "<\\/$1");

const example = exampleSource();
const favicon = faviconTag();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gantt</title>${favicon.tag}
<style>${read("app/app.css")}</style>
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
<script>${safe(read("vendor/js-yaml.min.js"))}</script>
<script>window.__GANTT_EXAMPLE__=${safe(JSON.stringify(example.yaml))};</script>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module">import "gantt-shell";</script>
</body></html>
`;

// -- write ------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });

const primary = path.join(OUT_DIR, OUT_NAME);
const entry = path.join(OUT_DIR, ENTRY_NAME);

fs.writeFileSync(primary, html);
fs.writeFileSync(entry, html);

// -- summary ----------------------------------------------------------------

console.log("");
console.log("  OpenGantt - standalone build");
console.log(`  root    ${root}`);
console.log(`  output  ${path.join(OUT_DIR, OUT_NAME)}`);
console.log(`          ${path.join(OUT_DIR, ENTRY_NAME)}  (same bytes, Tauri entry point)`);

reportList("  sources", moduleSizes);
reportList("  inlined", [
  ["js-yaml (vendor)", kb(fs.statSync("vendor/js-yaml.min.js").size)],
  ["import map", kb(bytes(JSON.stringify({ imports })))],
]);

console.log("");
console.log(`  example  ${example.from}`);
console.log(`  favicon  ${favicon.from ?? "none (drop a logo.png in the project root to add one)"}`);
console.log("");
console.log(`  ${OUT_NAME}   ${kb(bytes(html))}`);
console.log(`  ${ENTRY_NAME}  ${kb(bytes(html))}`);
console.log(`  done in ${Date.now() - started} ms`);
console.log("");
