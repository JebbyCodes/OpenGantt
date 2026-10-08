import Plugin from "gantt-main";
import { saveFile, Notice } from "obsidian";

const $ = (s) => document.querySelector(s);
const KEY = "gantt-app:doc";

const plugin = new Plugin();
await plugin.onload();
const processor = plugin.processors.gantt;

const editor = $("#editor"), pane = $("#chart"), fileLabel = $("#file");
const MD = /\.(md|markdown|mdx)$/i;

let name = localStorage.getItem(`${KEY}:name`) || "Gantt";
let source = localStorage.getItem(KEY) ?? window.__GANTT_EXAMPLE__;
let child = null;

// What the chart came from, so Save puts the YAML back into that same file instead of always dropping a
// fresh .yaml into Downloads.
//   kind   "markdown" (the chart is a ```gantt block inside a note) | "yaml" | "text"
//   ext    the extension the file had, reused when suggesting a name
//   wrap   the note text before and after the block, so everything else in the file survives a save
//   handle File System Access handle (Chrome/Edge in a plain browser): Ctrl+S writes straight back
//   path   absolute path (Tauri desktop app): the same idea, for the case where no handle exists
const doc = { kind: "yaml", ext: ".yaml", wrap: null, handle: null, path: null, dirty: false };

try {
  const saved = JSON.parse(localStorage.getItem(`${KEY}:what`) || "null");
  if (saved && saved.kind) {
    doc.kind = saved.kind;
    doc.ext = saved.ext ?? doc.ext;
    doc.wrap = saved.wrap ?? null;
    doc.path = saved.path ?? null; // reopen the app and Ctrl+S still writes to the same file
  }
} catch {}

// ---- Tauri (the desktop .exe) ----------------------------------------------------------------
// A Tauri window is a WebView2 / WebKitGTK / WKWebView, and none of them implement the File System
// Access API, so showOpenFilePicker / showSaveFilePicker never exist there. Tauri hands out a real
// absolute path instead, which we keep on doc.path and reuse: that is what makes Ctrl+S write back
// to the file with no dialog. Works with Tauri v1 and v2 as long as `withGlobalTauri` is on.
const T = window.__TAURI__;
const tauriDialog = T?.dialog ?? T?.plugin?.dialog;
const tauriFs = T?.fs ?? T?.plugin?.fs;
const hasTauri = !!(
  tauriDialog && tauriFs &&
  typeof tauriDialog.open === "function" &&
  typeof tauriDialog.save === "function" &&
  typeof tauriFs.readTextFile === "function" &&
  typeof tauriFs.writeTextFile === "function"
);
if (T && !hasTauri) {
  console.warn("Gantt: Tauri is present but the dialog/fs plugins are missing. Add tauri-plugin-dialog " +
    "and tauri-plugin-fs, and set build.withGlobalTauri (v1) / app.withGlobalTauri (v2) to true.");
}

// Filter lists, in each API's own shape.
const PICKER_TYPES = () => [
  { description: "Markdown note with a gantt block", accept: { "text/markdown": [".md", ".markdown"] } },
  { description: "Gantt chart file", accept: { "text/yaml": [".yaml", ".yml"], "text/plain": [".txt"] } },
];
const TAURI_FILTERS = [
  { name: "Markdown note", extensions: ["md", "markdown"] },
  { name: "Gantt chart", extensions: ["yaml", "yml", "txt"] },
  { name: "All files", extensions: ["*"] },
];

const baseName = (p) => String(p).split(/[\\/]/).pop() || String(p);

function render() {
  const prev = child;
  const keep = prev?.tasks && {
    state: { ...prev.state },
    collapsed: [...prev.collapsed],
    sc: prev.hostEl?.querySelector(".epq-chart"),
  };
  const pos = keep?.sc && { l: keep.sc.scrollLeft, t: keep.sc.scrollTop };
  prev?.unload();
  pane.textContent = "";
  child = null;
  processor(source, pane.createDiv(), {
    sourcePath: `${name}.md`,
    addChild(c) { child = c; c.load(); },
  });
  if (keep && child.tasks) {
    // an edit should not reset scale, mode, collapsed rows or scroll
    const ids = new Set(child.tasks.map((t) => t.id));
    child.state = keep.state;
    child.collapsed = new Set(keep.collapsed.filter((i) => ids.has(i)));
    child.syncButtons();
    child.draw(true);
    const sc = child.hostEl.querySelector(".epq-chart");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sc.scrollLeft = pos.l;
      sc.scrollTop = pos.t;
    }));
  }
}

function persist() {
  localStorage.setItem(KEY, source);
  localStorage.setItem(`${KEY}:name`, name);
  try {
    localStorage.setItem(`${KEY}:what`, JSON.stringify({
      kind: doc.kind, ext: doc.ext, wrap: doc.wrap, path: doc.path,
    }));
  } catch {}
}

function setDirty(on) {
  doc.dirty = on;
  fileLabel.classList.toggle("is-dirty", on);
  document.title = `${on ? "\u2022 " : ""}${name} \u2014 Gantt`;
}

const setName = (n) => {
  name = n;
  fileLabel.textContent = n;
  document.title = `${doc.dirty ? "\u2022 " : ""}${n} \u2014 Gantt`;
};

function load(text, fileName, opts = {}) {
  source = text;
  editor.value = text;
  doc.kind = opts.kind ?? (/\.ya?ml$/i.test(fileName) ? "yaml" : MD.test(fileName) ? "markdown" : "text");
  doc.ext = opts.ext ?? (fileName.match(/\.[^.]+$/)?.[0] || (doc.kind === "markdown" ? ".md" : ".yaml"));
  doc.wrap = opts.wrap ?? null;
  doc.handle = opts.handle ?? null;
  doc.path = opts.path ?? null;
  setName(fileName);
  setDirty(false);
  persist();
  render();
}

let timer = 0;
editor.addEventListener("input", () => {
  source = editor.value;
  setDirty(true);
  persist();
  clearTimeout(timer);
  timer = setTimeout(render, 250);
});

editor.addEventListener("keydown", (e) => {
  // Tab indents instead of leaving the editor
  if (e.key !== "Tab") return;
  e.preventDefault();
  document.execCommand("insertText", false, "  ");
});

// ---- Reading a file --------------------------------------------------------------------------

// The first ```gantt block in a note, plus the note text on either side of it, so a save puts
// everything back exactly where it was.
function splitNote(text) {
  const all = [...text.matchAll(/```(?:epq-)?gantt[^\n]*\n([\s\S]*?)```/g)];
  if (!all.length) return null;
  const m = all[0];
  return {
    count: all.length,
    yaml: m[1].replace(/\n$/, ""),
    before: text.slice(0, m.index) + m[0].slice(0, m[0].indexOf("\n") + 1),
    after: text.slice(m.index + m[0].length - 3),
  };
}

// A brand-new chart for a note that has no block yet. Saving appends the block and leaves the note alone.
function starterBlock() {
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  return `rows:\n  - label: New task\n    plan: [${day(0)}, ${day(5)}]\n`;
}

function openText(text, fileName, handle = null, path = null) {
  const part = splitNote(text);
  if (part) {
    if (part.count > 1) new Notice(`Opened the first of ${part.count} gantt blocks in this note. Saving rewrites that one and leaves the others alone.`);
    return load(part.yaml, fileName, { kind: "markdown", wrap: { before: part.before, after: part.after }, handle, path });
  }
  if (MD.test(fileName)) {
    // No chart in this note yet: keep the note, start an empty chart, and say so.
    new Notice("No ```gantt block in this note, so one is being added at the end. Saving keeps the rest of the note.");
    return load(starterBlock(), fileName, { kind: "markdown", wrap: { before: text.endsWith("\n") ? `${text}\n` : `${text}\n\n`, after: "" }, handle, path });
  }
  load(text, fileName, { handle, path });
}

const readFile = (f, handle = null) => f.text().then((t) => openText(t, f.name, handle));

$("#open").onclick = async () => {
  // Tauri first: the webview has no File System Access API, and only this gives us a path to save to.
  if (hasTauri) {
    try {
      const path = await tauriDialog.open({ multiple: false, directory: false, filters: TAURI_FILTERS });
      if (!path) return; // cancelled
      const p = Array.isArray(path) ? path[0] : path;
      return openText(await tauriFs.readTextFile(p), baseName(p), null, p);
    } catch (e) {
      console.warn("Gantt: Tauri could not open the file", e);
      new Notice("Couldn't open that file. See the console for details.");
      return;
    }
  }
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [h] = await window.showOpenFilePicker({ types: PICKER_TYPES(), multiple: false });
      const f = await h.getFile();
      return openText(await f.text(), f.name, h); // keep the handle: Ctrl+S writes back here
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.warn("Gantt: the file picker did not open, falling back to the plain file input", e);
    }
  }
  $("#picker").click();
};

$("#picker").onchange = (e) => {
  const f = e.target.files[0];
  if (f) readFile(f); // a plain <input type="file"> gives no handle: Save will fall back to a dialog
  e.target.value = "";
};

addEventListener("dragover", (e) => e.preventDefault());

addEventListener("drop", async (e) => {
  e.preventDefault();
  if (hasTauri) return; // the OS drag never reaches the DOM in a Tauri window
  // A dropped file carries a File System Access handle in Chromium, which is what lets Save write
  // straight back to the file on disk. Ask for it *before* awaiting anything: the DataTransfer
  // items are only alive for the duration of the event.
  const item = [...(e.dataTransfer.items || [])].find((i) => i.kind === "file");
  const handleP = item && typeof item.getAsFileSystemHandle === "function"
    ? item.getAsFileSystemHandle()
    : null;
  const f = (item && item.getAsFile()) || e.dataTransfer.files[0];
  if (!f) return;
  let handle = null;
  if (handleP) {
    try {
      const h = await handleP;
      if (h && h.kind === "file") handle = h;
    } catch {}
  }
  readFile(f, handle);
});

// ---- Saving ----------------------------------------------------------------------------------

const hasFs = typeof window.showSaveFilePicker === "function";
const stem = () => (name.replace(/\.[^.]+$/, "") || "Gantt").trim();
const suggestedName = () => `${stem()}${doc.ext || (doc.kind === "markdown" ? ".md" : ".yaml")}`;

// The file's full text, with the chart put back where it came from. A note keeps everything around its
// ```gantt block; anything else is just the YAML.
function fullText() {
  const body = !source || source.endsWith("\n") ? source : `${source}\n`;
  if (doc.kind !== "markdown") return body;
  if (doc.wrap) return doc.wrap.before + body + doc.wrap.after;
  return "```gantt\n" + body + "```\n"; // saved as a .md without coming from a note: wrap it so Obsidian renders it
}

// The user picked a file name in a save dialog: follow it, so the next Ctrl+S writes there too.
function adoptName(n) {
  if (!n) return;
  const wasNote = doc.kind === "markdown";
  doc.ext = n.match(/\.[^.]+$/)?.[0] || doc.ext;
  doc.kind = MD.test(n) ? "markdown" : /\.ya?ml$/i.test(n) ? "yaml" : "text";
  if (wasNote && doc.kind !== "markdown") doc.wrap = null; // saved out of the note: the YAML now stands alone
  setName(n);
}
const adoptHandle = () => adoptName(doc.handle?.name);

// Save in place when the platform allows it, otherwise download with the right name and extension.
async function saveDoc(as = false) {
  const text = fullText();

  // Tauri: write straight to the path we opened. A dialog appears only for Save-as, or the first
  // save of a chart that has no path yet (the Example, or a brand-new chart).
  if (hasTauri) {
    try {
      let path = doc.path;
      if (!path || as) {
        path = await tauriDialog.save({ defaultPath: path || suggestedName(), filters: TAURI_FILTERS });
        if (!path) return; // cancelled: change nothing
        doc.path = path;
        adoptName(baseName(path));
      }
      await tauriFs.writeTextFile(path, text);
      setDirty(false);
      persist();
      new Notice(`Saved ${baseName(path)}`);
      return;
    } catch (e) {
      console.warn("Gantt: Tauri could not write the file", e);
      new Notice("Couldn't save that file. See the console for details.");
      return;
    }
  }

  if (hasFs) {
    try {
      if (!doc.handle || as) {
        doc.handle = await window.showSaveFilePicker({ suggestedName: suggestedName(), types: PICKER_TYPES() });
        adoptHandle();
      }
      const w = await doc.handle.createWritable();
      await w.write(text);
      await w.close();
      setDirty(false);
      persist();
      new Notice(`Saved ${doc.handle.name}`);
      return;
    } catch (e) {
      if (e?.name === "AbortError") return; // the user closed the dialog: change nothing
      console.warn("Gantt: could not write the file, downloading instead", e);
      doc.handle = null;
    }
  }
  saveFile(suggestedName(), text, doc.kind === "markdown" ? "text/markdown" : "text/yaml");
  setDirty(false);
}

const save = () => saveDoc(false);
$("#save").onclick = save;
$("#saveas").onclick = () => saveDoc(true);

$("#copy").onclick = async () => {
  const text = "```gantt\n" + source.replace(/\n$/, "") + "\n```\n";
  try {
    await navigator.clipboard.writeText(text);
    new Notice("Copied. Paste it into any Obsidian note.");
  } catch {
    editor.select();
    new Notice("Couldn't copy automatically; the YAML is selected in the editor.");
  }
};

$("#example").onclick = () => {
  if (doc.dirty && !confirm("Replace the current chart with the example? Unsaved changes will be lost.")) return;
  load(window.__GANTT_EXAMPLE__, "Example.yaml", { kind: "yaml" }); // no path: Save can no longer overwrite your file
};

$("#toggle").onclick = () => {
  const hide = document.body.classList.toggle("noeditor");
  $("#toggle").textContent = hide ? "Show editor" : "Hide editor";
  child?.draw();
};

addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); saveDoc(e.shiftKey); } // Ctrl+S saves, Ctrl+Shift+S saves as…
  if (k === "o") { e.preventDefault(); $("#open").click(); }
  if (k === "p" && child?.print) { e.preventDefault(); child.print(); }
});

addEventListener("beforeunload", (e) => {
  if (doc.dirty) { e.preventDefault(); e.returnValue = ""; }
});

editor.value = source;
setName(name);
setDirty(false);
render();
