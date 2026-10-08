import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const read = (file) =>
  fs.readFileSync(path.join(ROOT, file), "utf8");

const write = (file, text) => {
  const full = path.join(ROOT, file);

  fs.mkdirSync(path.dirname(full), {
    recursive: true,
  });

  fs.writeFileSync(full, text);
};

const safe = (text) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

/* ==========================================================================
   Modules
   ========================================================================== */

const CHART_MODULES = [
  "model",
  "timeline",
  "columns",
  "chart",
  "export",
  "main",
];

/*
 * These are the modules that the generated standalone web application
 * needs in order to run the exact same Gantt implementation.
 */
const REQUIRED = [
  "app/app.css",
  "app/shell.js",
  "app/shim.js",

  "src/styles.css",

  "vendor/js-yaml.min.js",

  ...CHART_MODULES.map(
    (name) => `src/${name}.js`
  ),
];

/* ==========================================================================
   Validation
   ========================================================================== */

for (const file of REQUIRED) {
  const full = path.join(ROOT, file);

  if (!fs.existsSync(full)) {
    throw new Error(
      `Missing required build file: ${file}`
    );
  }
}

/* ==========================================================================
   Import rewriting
   ========================================================================== */

function rewriteImports(source) {
  let out = source;

  /*
   * Local JS imports:
   *
   *   ./model.js
   *   ./timeline.js
   *
   * become:
   *
   *   gantt-model
   *   gantt-timeline
   */
  out = out.replace(
    /(["'])\.\/([A-Za-z0-9_-]+)\.js\1/g,
    (_, quote, name) =>
      `${quote}gantt-${name}${quote}`
  );

  /*
   * CSS imports are represented by the generated CSS
   * module instead.
   */
  out = out.replace(
    /(["'])\.\/styles\.css\1/g,
    (_, quote) =>
      `${quote}gantt-styles${quote}`
  );

  return out;
}

/* ==========================================================================
   Module loader
   ========================================================================== */

const imports = {};

/*
 * Obsidian compatibility shim
 */
imports.obsidian = "data:text/javascript," +
  encodeURIComponent(
    rewriteImports(read("app/shim.js"))
  );

/*
 * Application shell
 */
imports["gantt-shell"] = "data:text/javascript," +
  encodeURIComponent(
    rewriteImports(read("app/shell.js"))
  );

/*
 * Gantt CSS
 */
imports["gantt-styles"] =
  "data:text/css;charset=utf-8," +
  encodeURIComponent(
    read("src/styles.css")
  );

/*
 * Gantt source modules
 */
for (const name of CHART_MODULES) {
  imports[`gantt-${name}`] =
    "data:text/javascript," +
    encodeURIComponent(
      rewriteImports(
        read(`src/${name}.js`)
      )
    );
}

/* ==========================================================================
   Favicon
   ========================================================================== */

const faviconPath = path.join(
  ROOT,
  "app",
  "favicon.svg"
);

let favicon = {
  tag: "",
};

if (fs.existsSync(faviconPath)) {
  const svg = read("app/favicon.svg");

  favicon.tag =
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(svg)}">`;
}

/* ==========================================================================
   Example document
   ========================================================================== */

const example =
  fs.existsSync(
    path.join(ROOT, "app", "example.yaml")
  )
    ? read("app/example.yaml")
    : `title: Example Gantt
start: 2026-09-07
days: 30
events:
  - label: Example task
    start: 2026-09-07
    end: 2026-09-10
    color: blue`;

/* ==========================================================================
   HTML
   ========================================================================== */

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<meta
  name="theme-color"
  content="#282828"
/>

<title>Gantt</title>

${favicon.tag}

<style>
${read("app/app.css")}
</style>

</head>

<body>

<header class="top">

  <b>Gantt</b>

  <button
    id="open"
    type="button"
    title="Open a Markdown or YAML file"
  >
    Open…
  </button>

  <button
    id="save"
    type="button"
    title="Save"
  >
    Save
  </button>

  <button
    id="saveas"
    type="button"
    title="Save as"
  >
    Save as…
  </button>

  <button
    id="copy"
    type="button"
    title="Copy as an Obsidian Gantt block"
  >
    Copy as Obsidian block
  </button>

  <button
    id="example"
    type="button"
    title="Load the example"
  >
    Example
  </button>

  <span id="file"></span>

  <span class="sp"></span>

  <button
    id="toggle"
    type="button"
    aria-expanded="false"
    title="Show or hide the YAML editor"
  >
    Show editor
  </button>

</header>

<main>

  <section id="editorWrap">
    <textarea
      id="editor"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      aria-label="Gantt YAML"
    ></textarea>
  </section>

  <section id="chart"></section>

</main>

<input
  type="file"
  id="picker"
  accept=".md,.markdown,.mdx,.yaml,.yml,text/plain,text/markdown"
  hidden
/>

<div id="toasts"></div>

<script>
window.__GANTT_EXAMPLE__ = \`${safe(example)}\`;
</script>

<script>
window.__GANTT_WEB__ = true;
</script>

<script type="importmap">
${JSON.stringify({ imports })}
</script>

<script type="module">
import "gantt-shell";
</script>

</body>
</html>`;

/* ==========================================================================
   Output
   ========================================================================== */

const dist = path.join(ROOT, "dist");

fs.rmSync(dist, {
  recursive: true,
  force: true,
});

fs.mkdirSync(dist, {
  recursive: true,
});

/*
 * Keep both names.
 *
 * Gantt.html:
 *   Direct standalone version.
 *
 * index.html:
 *   GitHub Pages entry point.
 */
write(
  "dist/Gantt.html",
  html
);

write(
  "dist/index.html",
  html
);

console.log(
  "OpenGantt web build complete."
);

console.log(
  "Generated:"
);

console.log(
  "  dist/index.html"
);

console.log(
  "  dist/Gantt.html"
);