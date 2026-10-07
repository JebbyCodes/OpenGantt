// ---------------------------------------------------------------------------
// OpenGantt - Obsidian plugin builder
//
// Bundles src/main.js (and the CSS it imports) into the two files Obsidian
// loads from a plugin folder:
//
//   main.js       the plugin bundle, CommonJS, minified
//   styles.css    the chart styles, extracted from the CSS import
//
// Obsidian, Electron and the CodeMirror packages are left external - the host
// app provides them, so bundling them would be wrong. Everything else is
// inlined.
//
// Run with:  npm run build
//            npm run build -- "C:\path\to\your\vault"    (also installs)
// ---------------------------------------------------------------------------

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

// -- configuration ----------------------------------------------------------

const ENTRY = "src/main.js";        // the plugin entry point
const OUT_JS = "main.js";           // what Obsidian loads
const OUT_CSS = "styles.css";       // what Obsidian loads alongside it
const MANIFEST = "manifest.json";   // copied into the vault, never built
const PLUGIN_DIR = "gantt";         // folder name under .obsidian/plugins

// Provided by the host at runtime - must not be bundled.
const EXTERNAL = ["obsidian", "electron", "@codemirror/*", "@lezer/*"];

// Assets referenced from CSS are inlined as data URIs so the bundle stays
// self-contained: no loose files to ship next to main.js.
const LOADERS = {
  ".css": "css",
  ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl",
  ".png": "dataurl", ".svg": "dataurl", ".gif": "dataurl",
};

// -- small helpers ----------------------------------------------------------

const started = Date.now();
const root = process.cwd();

const exists = (f) => fs.existsSync(f);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const sizeOf = (f) => kb(fs.statSync(f).size);

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

if (!exists(ENTRY)) {
  fail(
    `${ENTRY} is missing`,
    `Run this from the OpenGantt project root (currently ${root}).`,
  );
}

// The vault path is optional. When given it must be a directory, not a file.
const vaultArg = process.argv[2];
if (vaultArg && exists(vaultArg) && !fs.statSync(vaultArg).isDirectory()) {
  fail(`"${vaultArg}" is a file, not a vault folder`);
}

// -- bundle -----------------------------------------------------------------

// metafile: true makes esbuild return a description of what went in, which is
// what the "largest sources" section below is built from.
let result;
try {
  result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUT_JS,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    minify: true,
    external: EXTERNAL,
    loader: LOADERS,
    metafile: true,
    // "warning" keeps esbuild's own errors and warnings visible but suppresses
    // its "built in Xms" line, which the summary below replaces.
    logLevel: "warning",
  });
} catch (e) {
  // esbuild has already printed the detailed error and its source location.
  fail("esbuild could not bundle the plugin", "See the error above for the file and line.");
}

// esbuild writes the extracted CSS next to the JS as main.css. Obsidian wants
// it called styles.css, so rename it.
if (exists("main.css")) {
  fs.renameSync("main.css", OUT_CSS);
} else {
  console.warn("");
  console.warn("  warning: no CSS was emitted - the chart will be unstyled.");
  console.warn("  check that src/main.js still has:  import \"./styles.css\";");
}

// -- summary ----------------------------------------------------------------

// Largest inputs first, so it is obvious what dominates the bundle. The vendor
// and shim files are tiny; the chart modules are the interesting ones.
const sources = Object.entries(result.metafile.inputs)
  .map(([file, info]) => [file.replace(/\\/g, "/"), info.bytes])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([file, bytes]) => [file, kb(bytes)]);

const outputs = [[OUT_JS, sizeOf(OUT_JS)]];
if (exists(OUT_CSS)) outputs.push([OUT_CSS, sizeOf(OUT_CSS)]);

console.log("");
console.log("  OpenGantt - Obsidian plugin build");
console.log(`  root     ${root}`);
console.log(`  entry    ${ENTRY}`);

reportList("  output", outputs);
reportList("  largest sources", sources);

// -- optional install -------------------------------------------------------

if (vaultArg) {
  const dest = path.join(vaultArg, ".obsidian", "plugins", PLUGIN_DIR);
  const copied = [];

  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const file of [OUT_JS, MANIFEST, OUT_CSS]) {
      if (!exists(file)) continue;
      fs.copyFileSync(file, path.join(dest, file));
      copied.push([file, sizeOf(file)]);
    }
  } catch (e) {
    fail(`could not install into ${dest}`, e.message);
  }

  if (!exists(MANIFEST)) {
    console.warn("");
    console.warn(`  warning: ${MANIFEST} is missing, so the plugin will not load.`);
  }

  reportList(`  installed to ${dest}`, copied);

  console.log("");
  console.log("  In Obsidian: Settings > Community plugins > enable \"OpenGantt\".");
} else {
  console.log("");
  console.log("  Next: copy main.js, manifest.json and styles.css into");
  console.log("        <vault>/.obsidian/plugins/gantt/");
  console.log("");
  console.log("  Or install automatically by passing the vault folder:");
  console.log("        npm run build -- \"C:\\path\\to\\your\\vault\"");
}

console.log("");
console.log(`  done in ${Date.now() - started} ms`);
console.log("");
