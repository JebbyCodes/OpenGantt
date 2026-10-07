import Plugin from "gantt-main";
import { saveFile, Notice } from "obsidian";

const $ = (s) => document.querySelector(s);
const KEY = "gantt-app:doc";
const plugin = new Plugin();
await plugin.onload();
const processor = plugin.processors.gantt;
const editor = $("#editor"), pane = $("#chart"), fileLabel = $("#file");

let name = localStorage.getItem(`${KEY}:name`) || "Gantt";
let source = localStorage.getItem(KEY) ?? window.__GANTT_EXAMPLE__;
let child = null;

function render() {
  const prev = child;
  const keep = prev?.tasks && {
    state: { ...prev.state }, collapsed: [...prev.collapsed],
    sc: prev.hostEl?.querySelector(".epq-chart"),
  };
  const pos = keep?.sc && { l: keep.sc.scrollLeft, t: keep.sc.scrollTop };
  prev?.unload();
  pane.textContent = "";
  child = null;
  processor(source, pane.createDiv(), { sourcePath: `${name}.md`, addChild(c) { child = c; c.load(); } });
  if (keep && child.tasks) {            // an edit should not reset scale, mode, collapsed rows or scroll
    const ids = new Set(child.tasks.map((t) => t.id));
    child.state = keep.state;
    child.collapsed = new Set(keep.collapsed.filter((i) => ids.has(i)));
    child.syncButtons();
    child.draw(true);
    const sc = child.hostEl.querySelector(".epq-chart");
    requestAnimationFrame(() => requestAnimationFrame(() => { sc.scrollLeft = pos.l; sc.scrollTop = pos.t; }));
  }
}
const persist = () => { localStorage.setItem(KEY, source); localStorage.setItem(`${KEY}:name`, name); };
const setName = (n) => { name = n; fileLabel.textContent = n; persist(); };
function load(text, n) {
  source = text; editor.value = text; setName(n); render();
}

let timer = 0;
editor.addEventListener("input", () => {
  source = editor.value; persist();
  clearTimeout(timer); timer = setTimeout(render, 250);
});
editor.addEventListener("keydown", (e) => {   // Tab indents instead of leaving the editor
  if (e.key !== "Tab") return;
  e.preventDefault();
  document.execCommand("insertText", false, "  ");
});

function openText(text, fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const blocks = [...text.matchAll(/```(?:epq-)?gantt[^\n]*\n([\s\S]*?)```/g)];
  if (blocks.length) {
    if (blocks.length > 1) new Notice(`Opened the first of ${blocks.length} gantt blocks in this note.`);
    return load(blocks[0][1].replace(/\n$/, ""), base);
  }
  if (/\.md$/i.test(fileName)) return new Notice("No ```gantt block found in that note.");
  load(text, base);
}
const readFile = (f) => f.text().then((t) => openText(t, f.name));
$("#open").onclick = () => $("#picker").click();
$("#picker").onchange = (e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ""; };
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); });

const save = () => saveFile(`${name}.yaml`, source.endsWith("\n") ? source : source + "\n", "text/yaml");
$("#save").onclick = save;
$("#copy").onclick = async () => {
  const text = "```gantt\n" + source.replace(/\n$/, "") + "\n```\n";
  try { await navigator.clipboard.writeText(text); new Notice("Copied. Paste it into any Obsidian note."); }
  catch { editor.select(); new Notice("Couldn't copy automatically; the YAML is selected in the editor."); }
};
$("#example").onclick = () => { if (!source.trim() || confirm("Replace the current chart with the example?")) load(window.__GANTT_EXAMPLE__, "Example"); };
$("#toggle").onclick = () => {
  const hide = document.body.classList.toggle("noeditor");
  $("#toggle").textContent = hide ? "Show editor" : "Hide editor";
  child?.draw();
};
addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "s") { e.preventDefault(); save(); }
  if (e.key === "p" && child?.print) { e.preventDefault(); child.print(); }
});

editor.value = source;
fileLabel.textContent = name;
render();
