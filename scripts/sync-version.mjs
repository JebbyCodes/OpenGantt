// ---------------------------------------------------------------------------
// OpenGantt - version sync
//
// package.json is the one place the version lives. This copies it into every
// other file that has to carry it, so a release is a one-line change:
//
//   manifest.json            Obsidian plugin manifest
//   src-tauri/tauri.conf.json  desktop app (shown in the installer and About box)
//   src-tauri/Cargo.toml       desktop app crate
//   package-lock.json          npm's own copy
//
// The builds (npm run build, npm run build:app) run this first, so those files
// can never drift. The standalone app also reads the version from package.json
// and shows it in the page.
//
//   node scripts/sync-version.mjs          write the version everywhere
//   node scripts/sync-version.mjs --check  only report; exit 1 on a mismatch
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

export function readVersion(root = ROOT) {
  const v = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(v)) throw new Error(`package.json has an invalid version: ${v}`);
  return v;
}

// Each target: where it is, how to read its version, and how to write one in without touching anything else
// (line endings and formatting stay as they are).
const JSON_VERSION = /("version"\s*:\s*")([^"]*)(")/;
const TARGETS = [
  { file: "manifest.json", re: JSON_VERSION },
  { file: path.join("src-tauri", "tauri.conf.json"), re: JSON_VERSION },
  { file: path.join("src-tauri", "Cargo.toml"), re: /(^\[package\][\s\S]*?^version\s*=\s*")([^"]*)(")/m },
];

export function syncVersions({ root = ROOT, write = true } = {}) {
  const version = readVersion(root);
  const report = [];
  for (const { file, re } of TARGETS) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    const m = text.match(re);
    if (!m) { report.push({ file, found: null, version, changed: false }); continue; }
    const changed = m[2] !== version;
    if (changed && write) fs.writeFileSync(full, text.replace(re, `$1${version}$3`));
    report.push({ file, found: m[2], version, changed });
  }
  // package-lock.json: the top-level entry and packages[""] (parsed, since the version appears in many places).
  const lock = path.join(root, "package-lock.json");
  if (fs.existsSync(lock)) {
    const text = fs.readFileSync(lock, "utf8");
    const data = JSON.parse(text);
    const found = data.version;
    const changed = found !== version || data.packages?.[""]?.version !== version;
    if (changed && write) {
      data.version = version;
      if (data.packages?.[""]) data.packages[""].version = version;
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      fs.writeFileSync(lock, JSON.stringify(data, null, 2).replace(/\n/g, eol) + (text.endsWith("\n") ? eol : ""));
    }
    report.push({ file: "package-lock.json", found, version, changed });
  }
  return { version, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { version, report } = syncVersions({ write: !check });
  console.log(`OpenGantt ${version} (from package.json)`);
  let bad = 0;
  for (const r of report) {
    const state = r.found === null ? "no version field found" : r.changed ? (check ? `MISMATCH (${r.found})` : `updated from ${r.found}`) : "ok";
    if (r.found === null || (r.changed && check)) bad++;
    console.log(`  ${r.file.padEnd(28)} ${state}`);
  }
  if (bad) process.exit(1);
}
