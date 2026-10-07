// Stands in for the parts of Obsidian's API the chart code uses, so src/*.js runs unchanged in a browser.
const mk = (parent, tag, o = {}) => {
  if (typeof o === "string") o = { cls: o };
  const el = document.createElement(tag);
  if (o.cls) el.className = o.cls;
  if (o.text != null) el.textContent = o.text;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
  if (o.type) el.type = o.type;
  if (o.value != null) el.value = o.value;
  parent.appendChild(el);
  return el;
};
const P = HTMLElement.prototype;
P.createDiv = function (o) { return mk(this, "div", o); };
P.createSpan = function (o) { return mk(this, "span", o); };
P.createEl = function (tag, o) { return mk(this, tag, o); };
P.empty = function () { this.textContent = ""; };
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, on); };
P.setText = function (t) { this.textContent = t; };
P.setAttr = function (k, v) { this.setAttribute(k, v); };
Object.defineProperty(Node.prototype, "doc", { get() { return this.ownerDocument; } });

export const saveFile = (name, data, type = "application/octet-stream") => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};
// No vault in a browser: "save into the vault" becomes a normal download.
window.__app = { vault: { getAbstractFileByPath: () => null, createBinary: async (p, buf) => saveFile(p.split("/").pop(), buf) } };

const KEY = "gantt-app:state";
export class Plugin {
  constructor() { this.app = window.__app; this.processors = {}; }
  async loadData() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
  async saveData(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
  registerMarkdownCodeBlockProcessor(lang, fn) { this.processors[lang] = fn; }
}
export class MarkdownRenderChild {
  constructor(el) { this.containerEl = el; this._off = []; }
  registerDomEvent(el, type, cb) { el.addEventListener(type, cb); this._off.push(() => el.removeEventListener(type, cb)); }
  load() { this.onload?.(); }
  unload() { this._off.forEach((f) => f()); this.onunload?.(); }
}
export class Notice {
  constructor(msg) {
    const box = document.getElementById("toasts");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = typeof msg === "string" ? msg : msg.textContent;
    box.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
}
export class Menu {
  constructor() { this.items = []; }
  addItem(cb) { const it = { setTitle(t) { this.title = t; return this; }, setIcon() { return this; }, onClick(f) { this.fn = f; return this; } }; cb(it); this.items.push(it); return this; }
  addSeparator() { this.items.push({ sep: true }); return this; }
  showAtMouseEvent(e) {
    document.querySelector(".ctx")?.remove();
    const m = document.body.appendChild(Object.assign(document.createElement("div"), { className: "ctx" }));
    m.style.left = `${Math.min(e.clientX, innerWidth - 200)}px`;
    m.style.top = `${Math.min(e.clientY, innerHeight - 160)}px`;
    const close = () => { m.remove(); document.removeEventListener("pointerdown", away, true); };
    const away = (ev) => { if (!m.contains(ev.target)) close(); };
    for (const it of this.items) {
      if (it.sep) { m.appendChild(Object.assign(document.createElement("hr"))); continue; }
      const b = Object.assign(document.createElement("button"), { textContent: it.title });
      b.onclick = () => { close(); it.fn?.(); };
      m.appendChild(b);
    }
    setTimeout(() => document.addEventListener("pointerdown", away, true));
  }
}
export const Platform = { isMobile: /Android|iPhone|iPad/i.test(navigator.userAgent) };
export const normalizePath = (p) => p.replace(/\/+/g, "/").replace(/^\//, "");
export const parseYaml = (s) => window.jsyaml.load(s);
