import Plugin from "gantt-main";
import { saveFile, Notice } from "obsidian";

const $ = (s) => document.querySelector(s);

const KEY = "gantt-app:doc";
const plugin = new Plugin();

await plugin.onload();

const processor = plugin.processors.gantt;

const editor = $("#editor");
const pane = $("#chart");
const fileLabel = $("#file");

const MD = /\.(md|markdown|mdx)$/i;

let name = localStorage.getItem(`${KEY}:name`) || "Gantt";
let source = localStorage.getItem(KEY) ?? window.__GANTT_EXAMPLE__;
let child = null;

const doc = {
  kind: "yaml",
  ext: ".yaml",
  wrap: null,
  handle: null,
  path: null,
  dirty: false,
};

/* -------------------------------------------------------------------------- */
/* File / document helpers                                                   */
/* -------------------------------------------------------------------------- */

function setName(value) {
  name = value || "Gantt";
  fileLabel.textContent = name;
  localStorage.setItem(`${KEY}:name`, name);
}

function setDirty(value) {
  doc.dirty = !!value;
  fileLabel.classList.toggle("is-dirty", doc.dirty);
}

function remember() {
  localStorage.setItem(KEY, source);
  localStorage.setItem(`${KEY}:name`, name);
}

function fullText() {
  if (doc.wrap) {
    return doc.wrap(source);
  }

  return source;
}

/* -------------------------------------------------------------------------- */
/* Gantt rendering                                                           */
/* -------------------------------------------------------------------------- */

function render() {
  const prev = child;

  const keep =
    prev?.tasks && {
      state: { ...prev.state },
      collapsed: [...prev.collapsed],
      sc: prev.hostEl?.querySelector(".epq-chart"),
    };

  const pos = keep?.sc
    ? {
        l: keep.sc.scrollLeft,
        t: keep.sc.scrollTop,
      }
    : null;

  prev?.unload();

  pane.textContent = "";
  child = null;

  processor(source, pane.createDiv(), {
    sourcePath: `${name}.md`,

    addChild(c) {
      child = c;
      c.load();
    },
  });

  if (keep && child?.tasks) {
    const ids = new Set(child.tasks.map((t) => t.id));

    child.state = keep.state;

    child.collapsed = new Set(
      keep.collapsed.filter((id) => ids.has(id))
    );

    child.syncButtons();
    child.draw(true);

    const sc = child.hostEl?.querySelector(".epq-chart");

    if (sc && pos) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sc.scrollLeft = pos.l;
          sc.scrollTop = pos.t;
        });
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Editor visibility                                                          */
/* -------------------------------------------------------------------------- */

function setEditorOpen(open) {
  document.body.classList.toggle("editor-open", open);
  document.body.classList.toggle("editor-closed", !open);

  const toggle = $("#toggle");

  if (toggle) {
    toggle.textContent = open ? "Hide editor" : "Show editor";
    toggle.setAttribute("aria-expanded", String(open));
  }

  child?.draw();
}

/* -------------------------------------------------------------------------- */
/* Editor input                                                               */
/* -------------------------------------------------------------------------- */

editor.addEventListener("input", () => {
  source = editor.value;
  setDirty(true);
  remember();

  clearTimeout(editor.__renderTimer);

  editor.__renderTimer = setTimeout(() => {
    render();
  }, 120);
});

/* -------------------------------------------------------------------------- */
/* Open                                                                       */
/* -------------------------------------------------------------------------- */

async function openFile() {
  /* Tauri / desktop-style file dialog */
  if (window.__TAURI__?.dialog?.open) {
    try {
      const selected = await window.__TAURI__.dialog.open({
        multiple: false,
        filters: [
          {
            name: "Markdown / YAML",
            extensions: ["md", "markdown", "mdx", "yaml", "yml"],
          },
          {
            name: "All files",
            extensions: ["*"],
          },
        ],
      });

      if (!selected) return;

      const path =
        typeof selected === "string"
          ? selected
          : selected.path;

      if (!path) return;

      const text = await window.__TAURI__.fs.readTextFile(path);

      source = text;
      editor.value = source;

      doc.path = path;
      doc.kind = "file";
      doc.handle = null;

      setName(path.split(/[\\/]/).pop() || "Gantt");
      setDirty(false);
      remember();
      render();

      return;
    } catch (err) {
      console.error(err);
      new Notice(`Could not open file: ${err.message || err}`);
      return;
    }
  }

  /* Browser File System Access API */
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,

        types: [
          {
            description: "Markdown / YAML",
            accept: {
              "text/plain": [
                ".md",
                ".markdown",
                ".mdx",
                ".yaml",
                ".yml",
              ],
            },
          },
        ],
      });

      if (!handle) return;

      const file = await handle.getFile();

      source = await file.text();

      editor.value = source;

      doc.handle = handle;
      doc.path = file.name;
      doc.kind = "file";

      setName(file.name);
      setDirty(false);
      remember();
      render();

      return;
    } catch (err) {
      if (err?.name === "AbortError") return;

      console.error(err);
      new Notice(`Could not open file: ${err.message || err}`);
      return;
    }
  }

  /* Fallback input */
  $("#picker").click();
}

$("#picker").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];

  if (!file) return;

  try {
    source = await file.text();

    editor.value = source;

    doc.handle = null;
    doc.path = file.name;
    doc.kind = "file";

    setName(file.name);
    setDirty(false);
    remember();
    render();
  } catch (err) {
    console.error(err);
    new Notice(`Could not read file: ${err.message || err}`);
  }

  event.target.value = "";
});

/* -------------------------------------------------------------------------- */
/* Save                                                                       */
/* -------------------------------------------------------------------------- */

async function saveCurrent() {
  const text = fullText();

  /* Tauri */
  if (window.__TAURI__?.fs && doc.path) {
    try {
      await window.__TAURI__.fs.writeTextFile(doc.path, text);

      setDirty(false);
      remember();

      new Notice("Saved");
      return true;
    } catch (err) {
      console.error(err);
      new Notice(`Could not save: ${err.message || err}`);
      return false;
    }
  }

  /* Browser File System Access API */
  if (doc.handle) {
    try {
      const writable = await doc.handle.createWritable();

      await writable.write(text);
      await writable.close();

      setDirty(false);
      remember();

      new Notice("Saved");
      return true;
    } catch (err) {
      console.error(err);
      new Notice(`Could not save: ${err.message || err}`);
      return false;
    }
  }

  /* No existing file */
  return saveAs();
}

/* -------------------------------------------------------------------------- */
/* Save as                                                                    */
/* -------------------------------------------------------------------------- */

async function saveAs() {
  const text = fullText();

  /* Tauri */
  if (window.__TAURI__?.dialog?.save) {
    try {
      const path = await window.__TAURI__.dialog.save({
        defaultPath: `${name || "Gantt"}.md`,

        filters: [
          {
            name: "Markdown",
            extensions: ["md"],
          },
          {
            name: "YAML",
            extensions: ["yaml", "yml"],
          },
        ],
      });

      if (!path) return false;

      await window.__TAURI__.fs.writeTextFile(path, text);

      doc.path = path;
      doc.kind = "file";
      doc.handle = null;

      setName(path.split(/[\\/]/).pop() || name);
      setDirty(false);
      remember();

      new Notice("Saved");
      return true;
    } catch (err) {
      console.error(err);
      new Notice(`Could not save: ${err.message || err}`);
      return false;
    }
  }

  /* Browser File System Access API */
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${name || "Gantt"}.md`,

        types: [
          {
            description: "Markdown",
            accept: {
              "text/markdown": [".md"],
              "text/plain": [".md"],
            },
          },
        ],
      });

      if (!handle) return false;

      const writable = await handle.createWritable();

      await writable.write(text);
      await writable.close();

      doc.handle = handle;
      doc.path = handle.name;
      doc.kind = "file";

      setName(handle.name);
      setDirty(false);
      remember();

      new Notice("Saved");
      return true;
    } catch (err) {
      if (err?.name === "AbortError") return false;

      console.error(err);
      new Notice(`Could not save: ${err.message || err}`);
      return false;
    }
  }

  /* Download fallback */
  const blob = new Blob([text], {
    type: "text/markdown;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");

  a.href = url;
  a.download = `${name || "Gantt"}.md`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);

  setDirty(false);
  remember();

  return true;
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

$("#open").onclick = () => {
  openFile();
};

$("#save").onclick = () => {
  saveCurrent();
};

$("#saveas").onclick = () => {
  saveAs();
};

$("#copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      `\`\`\`epq-gantt\n${source}\n\`\`\``
    );

    new Notice("Copied as Obsidian block");
  } catch (err) {
    console.error(err);
    new Notice("Could not copy to clipboard");
  }
};

$("#example").onclick = () => {
  if (
    doc.dirty &&
    !confirm(
      "Replace the current document with the example?"
    )
  ) {
    return;
  }

  source = window.__GANTT_EXAMPLE__ || "";

  editor.value = source;

  doc.path = null;
  doc.handle = null;
  doc.kind = "yaml";

  setName("Example");
  setDirty(false);
  remember();
  render();
};

$("#toggle").onclick = () => {
  const open = !document.body.classList.contains("editor-open");

  setEditorOpen(open);
};

/* -------------------------------------------------------------------------- */
/* Drag & drop                                                                */
/* -------------------------------------------------------------------------- */

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();

  const file = event.dataTransfer?.files?.[0];

  if (!file) return;

  if (!MD.test(file.name) && !/\.(ya?ml)$/i.test(file.name)) {
    new Notice("Please drop a Markdown or YAML file.");
    return;
  }

  try {
    source = await file.text();

    editor.value = source;

    doc.handle = null;
    doc.path = file.name;
    doc.kind = "file";

    setName(file.name);
    setDirty(false);
    remember();
    render();
  } catch (err) {
    console.error(err);
    new Notice(`Could not read file: ${err.message || err}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Keyboard shortcuts                                                         */
/* -------------------------------------------------------------------------- */

window.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;

  if (!mod) return;

  if (event.key.toLowerCase() === "s") {
    event.preventDefault();

    if (event.shiftKey) {
      saveAs();
    } else {
      saveCurrent();
    }

    return;
  }

  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    openFile();

    return;
  }
});

/* -------------------------------------------------------------------------- */
/* Initial state                                                              */
/* -------------------------------------------------------------------------- */

editor.value = source;

setName(name);
setDirty(false);

/*
 * Desktop-style default:
 * show the Gantt itself rather than forcing the editor beside it.
 */
setEditorOpen(false);

render();