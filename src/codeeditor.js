// A plain <textarea> editor with line numbers, a highlighted current line, an error marker, and the small comforts a
// YAML editor needs (Tab indents, Enter keeps the indentation, Ctrl+/ comments lines). It is a real textarea underneath,
// so undo, spell-check off, selection, IME and mobile keyboards all behave natively.
import { h } from "./dom.js";

const LINE_H = 20;

export function createCodeEditor({ value = "", label = "YAML", onInput } = {}) {
  const nums = h("div", { class: "epq-gutter", "aria-hidden": "true" });
  const hilite = h("div", { class: "epq-curline", "aria-hidden": "true" });
  const ta = h("textarea", { class: "epq-codearea", spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": label });
  const wrap = h("div", { class: "epq-codewrap" }, hilite, ta);
  const el = h("div", { class: "epq-code" }, nums, wrap);
  let lines = 0;
  let errorLine = 0;

  const caretLine = () => ta.value.slice(0, ta.selectionStart).split("\n").length;

  function paintGutter() {
    const n = ta.value.split("\n").length;
    if (n !== lines || errorLine !== paintGutter.err) {
      lines = n;
      paintGutter.err = errorLine;
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= n; i++) frag.append(h("div", { class: i === errorLine ? "is-error" : "", text: String(i) }));
      nums.textContent = "";
      nums.append(frag);
      nums.style.minWidth = `${Math.max(3, String(n).length + 1)}ch`;
    }
    nums.scrollTop = ta.scrollTop;
  }
  function paintCaret() {
    const line = caretLine();
    hilite.style.transform = `translateY(${(line - 1) * LINE_H - ta.scrollTop + 8}px)`;
    const rows = nums.children;
    for (const r of rows) r.classList.remove("is-current");
    rows[line - 1]?.classList.add("is-current");
  }
  const sync = () => { paintGutter(); paintCaret(); };

  // Replace [from, to) with text through the browser's own edit stack, so Ctrl+Z still works.
  function edit(from, to, text, selFrom = from + text.length, selTo = selFrom) {
    ta.focus();
    ta.setSelectionRange(from, to);
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
    if (!ok) { ta.setRangeText(text, from, to, "end"); ta.dispatchEvent(new Event("input", { bubbles: true })); }
    ta.setSelectionRange(selFrom, selTo);
  }
  const lineBounds = () => {
    const v = ta.value;
    const a = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let b = v.indexOf("\n", ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === "\n" ? ta.selectionEnd - 1 : ta.selectionEnd);
    if (b < 0) b = v.length;
    return [a, b];
  };
  const mapLines = (fn) => {
    const [a, b] = lineBounds();
    const next = ta.value.slice(a, b).split("\n").map(fn).join("\n");
    edit(a, b, next, a, a + next.length);
  };

  ta.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Tab") {
      e.preventDefault();
      if (ta.selectionStart === ta.selectionEnd && !e.shiftKey) edit(ta.selectionStart, ta.selectionEnd, "  ");
      else mapLines((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : `  ${l}`));
    } else if (e.key === "Enter" && !mod && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      // keep the indentation; one level deeper after a line ending in ":"
      const v = ta.value;
      const at = ta.selectionStart;
      const line = v.slice(v.lastIndexOf("\n", at - 1) + 1, at);
      const indent = line.match(/^\s*(?:-\s+)?/)[0].replace(/-/, " ");
      if (indent || /:\s*$/.test(line)) {
        e.preventDefault();
        edit(at, at, `\n${indent}${/:\s*$/.test(line) ? "  " : ""}`);
      }
    } else if (mod && e.key === "/") {
      e.preventDefault();
      const [a, b] = lineBounds();
      const ls = ta.value.slice(a, b).split("\n");
      const allCommented = ls.filter((l) => l.trim()).every((l) => /^\s*#/.test(l));
      mapLines((l) => (!l.trim() ? l : allCommented ? l.replace(/^(\s*)# ?/, "$1") : l.replace(/^(\s*)/, "$1# ")));
    }
  });
  ta.addEventListener("input", () => { errorLine = 0; sync(); onInput?.(ta.value); });
  ta.addEventListener("scroll", sync);
  for (const ev of ["keyup", "click", "focus", "select"]) ta.addEventListener(ev, paintCaret);
  document.addEventListener("selectionchange", () => { if (document.activeElement === ta) paintCaret(); });

  ta.value = value;
  queueMicrotask(sync);

  return {
    el,
    textarea: ta,
    getValue: () => ta.value,
    setValue(v) { ta.value = v; errorLine = 0; sync(); },
    setError(line) { errorLine = line > 0 ? line : 0; sync(); },
    focus: () => ta.focus(),
    // Jump to a 1-based line (used when an error is reported).
    goto(line) {
      const at = ta.value.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(at, at);
      ta.scrollTop = Math.max(0, (line - 4) * LINE_H);
      sync();
    },
    refresh: sync,
  };
}
