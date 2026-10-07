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

const example = R("Example Gantt.md").match(/```gantt\n([\s\S]*?)```/)[1].replace(/\n$/, "");
const safe = (s) => s.replace(/<\/(script)/gi, "<\\/$1");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gantt</title>
<style>${R("app/app.css")}</style>
</head><body>
<header class="top"><b>Gantt</b>
<button id="open">Open…</button><button id="save">Save YAML</button><button id="copy">Copy as Obsidian block</button><button id="example">Example</button>
<span id="file"></span><span class="sp"></span><button id="toggle">Hide editor</button></header>
<main><section id="editorWrap"><textarea id="editor" spellcheck="false" aria-label="Gantt YAML"></textarea></section><section id="chart"></section></main>
<input type="file" id="picker" accept=".yaml,.yml,.md,.txt" hidden><div id="toasts"></div>
<script>${safe(R("vendor/js-yaml.min.js"))}</script>
<script>window.__GANTT_EXAMPLE__=${safe(JSON.stringify(example))};</script>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module">import "gantt-shell";</script>
</body></html>
`;
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/Gantt.html", html);
console.log(`dist/Gantt.html  ${(html.length / 1024).toFixed(0)} KB`);
