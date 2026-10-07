// Bundles src/main.js (and the CSS it imports) into main.js and styles.css.
// Usage:  npm run build
//         npm run build -- "C:\path\to\your\vault"   (also copies into the vault)
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  minify: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  loader: {
    ".css": "css",
    ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl",
    ".png": "dataurl", ".svg": "dataurl", ".gif": "dataurl",
  },
  logLevel: "info",
});

// esbuild writes the bundled CSS next to main.js as main.css; Obsidian wants styles.css.
if (fs.existsSync("main.css")) {
  fs.renameSync("main.css", "styles.css");
} else {
  console.warn("No CSS was emitted - the chart will be unstyled.");
}

const vault = process.argv[2];
if (vault) {
  const dest = path.join(vault, ".obsidian", "plugins", "gantt");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) {
    fs.copyFileSync(f, path.join(dest, f));
  }
  console.log(`Installed to ${dest}\nNow in Obsidian: Settings > Community plugins > enable "Gantt".`);
} else {
  console.log("Built main.js, manifest.json, styles.css. Copy these into <vault>/.obsidian/plugins/gantt/");
}
