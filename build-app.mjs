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
import { syncVersions } from "./scripts/sync-version.mjs";

// -- configuration ----------------------------------------------------------

const OUT_DIR = "dist";
const OUT_NAME = "Gantt.html";
const ENTRY_NAME = "index.html";
const FAVICON = "logo.png";
const EXAMPLE_NOTE = "Example Gantt.md";

const CHART_MODULES = [
  "arrange", "tree-colors", "themes", "serialize", "dom", "dialog", "help", "codeeditor", "visual",
  "model", "timeline", "columns", "chart", "export", "main",
];

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
    .replace(/from "\.\/([\w-]+)\.js"/g, 'from "gantt-$1"')
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

const DEFAULT_EXAMPLE = `scale: day
mode: both
title: Example project
weekends: true
markers:
  - date: 2026-10-10
    label: Build deadline
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
    fact: [2026-09-15, 2026-09-16], [2026-10-14]
    color: "#d3869b"
    notes: Paused, then restarted - each stretch gets its own bar.
  - label: Stakeholder reviews
    plan: [2026-09-17, 2d], [2026-09-30, 2d]
    fact: [2026-09-17, 2026-09-19], [2026-10-02, 2026-10-03]
    notes: Two separate review rounds - each range gets its own bar.
  - label: Stage 3 - Ship
    children:
      - label: Final checks
        plan: [2026-10-12, 3d]
        progress: 40%
      - label: Release
        plan: [2026-10-15, 2026-10-16]
        notes: Stage 3 has no dates of its own - it spans its subtasks.
`;

function exampleSource() {
  if (!exists(EXAMPLE_NOTE)) return { yaml: DEFAULT_EXAMPLE, from: "built-in sample" };
  const match = read(EXAMPLE_NOTE).match(/```gantt\n([\s\S]*?)```/);
  if (!match) return { yaml: DEFAULT_EXAMPLE, from: "built-in sample" };
  return { yaml: match[1].replace(/\n$/, ""), from: EXAMPLE_NOTE };
}

// -- the favicon ------------------------------------------------------------

// The page icons are small pre-made sizes of logo.png (app/icons), so the HTML does not carry the 1 MB original.
// The page's brand mark and favicons are all the same picture; regenerate them from logo.png if the logo changes.
const ICONS = [32, 64, 180];

function iconData(size) {
  const file = path.join("app", "icons", `icon-${size}.png`);
  return exists(file) ? `data:image/png;base64,${fs.readFileSync(file).toString("base64")}` : null;
}

function faviconTags() {
  const [i32, i64, i180] = ICONS.map(iconData);
  if (!i64) return { tags: "", brand: "", from: null };
  return {
    tags: [
      i32 && `<link rel="icon" type="image/png" sizes="32x32" href="${i32}">`,
      `<link rel="icon" type="image/png" sizes="64x64" href="${i64}">`,
      i180 && `<link rel="apple-touch-icon" href="${i180}">`,
    ].filter(Boolean).join("\n"),
    brand: `<img class="brand" src="${i64}" alt="" width="26" height="26">`,
    from: `app/icons (${ICONS.map((n) => `${n}px`).join(", ")}, from ${FAVICON})`,
  };
}

// -- assemble ---------------------------------------------------------------

const safe = (s) => s.replace(/<\/(script)/gi, "<\\/$1");

const example = exampleSource();
const favicon = faviconTags();
// package.json is the one home of the version; this also brings manifest.json, Tauri and the lockfile into line.
const { version, report: versionReport } = syncVersions();
// All colour themes go straight into the page so it never flashes the wrong colours while the scripts load.
const { themeCss } = await import("./src/themes.js");

const html = `<!doctype html>
<html lang="en" data-og-theme="gruvbox-dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenGantt</title>
<meta name="description" content="OpenGantt: Gantt charts from plain YAML, with a visual editor. Works offline.">
<meta name="theme-color" content="#1d2021">
${favicon.tags}
<style>${read("app/app.css")}</style>
<style id="og-themes">${themeCss()}</style><style id="og-custom-css"></style>
<script>try{var __t=JSON.parse(localStorage.getItem("gantt-app:state")).theme;if(__t)document.documentElement.dataset.ogTheme=__t}catch(e){}</script>
</head><body>
<header class="top">${favicon.brand}<b>OpenGantt</b><button id="version" class="ver" title="About OpenGantt">v${version}</button>
<button id="open" title="Open a .md note, a .yaml chart or any text file (Ctrl+O)">Open&hellip;</button>
<button id="save" title="Save back to the file you opened (Ctrl+S)">Save</button>
<button id="saveas" title="Save as a new .yaml chart or .md note (Ctrl+Shift+S)">Save as&hellip;</button>
<button id="copy" title="Copy the chart as a gantt block, ready to paste into a note">Copy as Obsidian block</button>
<button id="example">Example</button>
<span class="sep"></span>
<button id="undo" title="Undo (Ctrl+Z)" aria-label="Undo">&#8630; Undo</button><button id="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">Redo &#8631;</button>
<span id="file"></span><span class="sp"></span>
<button id="toggle">Hide editor</button></header>
<main><section id="editorWrap"><div class="tabs" role="tablist" aria-label="Editor"><button id="tabVisual" role="tab" aria-controls="paneVisual">Visual</button><button id="tabYaml" role="tab" aria-controls="paneYaml">YAML</button></div>
<div id="paneVisual" role="tabpanel" aria-labelledby="tabVisual"></div><div id="paneYaml" role="tabpanel" aria-labelledby="tabYaml" hidden></div></section>
<div id="split" role="separator" aria-orientation="vertical" aria-label="Resize the editor" aria-valuemin="280" tabindex="0" title="Drag to resize. Double-click to reset."></div>
<section id="chart"></section></main>
<input type="file" id="picker" accept=".yaml,.yml,.md,.markdown,.txt" hidden><div id="toasts"></div>
<script>${safe(read("vendor/js-yaml.min.js"))}</script>
<script>window.__GANTT_STANDALONE__=true;window.__GANTT_VERSION__=${JSON.stringify(version)};window.__GANTT_EXAMPLE__=${safe(JSON.stringify(example.yaml))};</script>
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
console.log(`  version  ${version} (from package.json; ${versionReport.filter((r) => r.changed).length} other file(s) brought into line)`);
console.log(`  icons    ${favicon.from ?? "none (run the icon step, see README)"}`);
console.log("");
console.log(`  ${OUT_NAME}   ${kb(bytes(html))}`);
console.log(`  ${ENTRY_NAME}  ${kb(bytes(html))}`);
console.log(`  done in ${Date.now() - started} ms`);
console.log("");
