// A modal dialog with optional tabs, built from plain DOM so it behaves identically in Obsidian and in the standalone
// app. Esc or a click outside closes it; focus is returned to wherever it was.
import { h, clear } from "./dom.js";

// tabs: [{ id, label, render(container) }]. Returns { close, el, show(tabId) }.
export function openDialog({ title, tabs = [], start, wide = false, themeId = null, onClose, footer = null, body = null }) {
  const returnTo = document.activeElement;
  const overlay = h("div", { class: "epq-overlay", role: "presentation", dataset: themeId ? { ogTheme: themeId } : {} });
  const panel = h("div", { class: `epq-dialog${wide ? " is-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title });
  const head = h("div", { class: "epq-dialog-head" }, h("span", { class: "epq-dialog-title", text: title }));
  const closeBtn = h("button", { class: "epq-dialog-x", "aria-label": "Close", title: "Close (Esc)", text: "\u00d7" });
  head.append(closeBtn);
  const nav = tabs.length > 1 ? h("div", { class: "epq-dialog-tabs", role: "tablist" }) : null;
  const content = h("div", { class: "epq-dialog-body" });
  panel.append(head);
  if (nav) panel.append(nav);
  panel.append(content);
  if (footer) panel.append(h("div", { class: "epq-dialog-foot" }, footer));
  overlay.append(panel);

  const buttons = new Map();
  const show = (id) => {
    const tab = tabs.find((t) => t.id === id) ?? tabs[0];
    for (const [k, b] of buttons) { b.classList.toggle("is-active", k === tab?.id); b.setAttribute("aria-selected", k === tab?.id ? "true" : "false"); }
    clear(content);
    tab?.render(content);
    content.scrollTop = 0;
  };
  for (const t of tabs) {
    if (!nav) break;
    const b = h("button", { class: "epq-dialog-tab", role: "tab", text: t.label, onclick: () => show(t.id) });
    buttons.set(t.id, b);
    nav.append(b);
  }

  let closed = false;
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    try { returnTo?.focus?.(); } catch { /* element is gone */ }
    onClose?.();
  }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);

  document.body.append(overlay);
  if (body) body(content); else show(start ?? tabs[0]?.id);
  closeBtn.focus();
  return { close, el: panel, content, show };
}
