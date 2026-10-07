// Draws the whole Gantt chart (table + timeline) with plain DOM/SVG. No third-party chart library.
import { makeAxis, taskStatus, headerShapes, bodyBars } from "./timeline.js";
import { cellText } from "./columns.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const ROW_H = 40;
export const HEAD_H = 56;
export const NAME_W = 280;
export const BAR_TOP = 7;

const svg = (name, attrs = {}, parent) => {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
};
const html = (tag, cls, parent, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
};

// Drag a header cell sideways to move its column. A thin marker shows where it will land; on release
// onReorder(id, slot) is called, where slot is the position among the other visible columns.
// Mouse and pen only: on touch the same drag would fight with scrolling, so touch uses the Columns panel.
function enableHeaderDrag(inner, cells, ctx, extentH) {
  if (!ctx.onReorder || cells.length < 2) return;
  let drag = null;
  let marker = null;

  const slotAt = (x) => {
    let slot = 0;
    for (const c of cells) {
      if (c.id === drag.id) continue;
      const r = c.el.getBoundingClientRect();
      if (x > r.left + r.width / 2) slot++;
    }
    return slot;
  };
  const markerX = (slot) => {
    const others = cells.filter((c) => c.id !== drag.id);
    const base = inner.getBoundingClientRect().left;
    if (slot < others.length) return others[slot].el.getBoundingClientRect().left - base;
    return others[others.length - 1].el.getBoundingClientRect().right - base;
  };
  const end = (commit) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove("is-dragging");
    marker?.remove();
    marker = null;
    if (commit && d.active) ctx.onReorder(d.id, d.slot);
  };

  for (const c of cells) {
    c.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      drag = { id: c.id, el: c.el, startX: e.clientX, active: false, slot: 0 };
      c.el.setPointerCapture?.(e.pointerId);
    });
    c.el.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== c.id) return;
      if (!drag.active) {
        if (Math.abs(e.clientX - drag.startX) < 5) return;
        drag.active = true;
        c.el.classList.add("is-dragging");
        marker = html("div", "epq-drop", inner);
        marker.style.height = `${extentH}px`;
      }
      drag.slot = slotAt(e.clientX);
      marker.style.left = `${markerX(drag.slot)}px`;
    });
    c.el.addEventListener("pointerup", () => end(true));
    c.el.addEventListener("pointercancel", () => end(false));
  }
}

// ctx: { tasks (visible rows, in order), collapsed:Set, scale, mode, opts, today, patternId,
//        columns (visible column definitions, in order), showTable:boolean,
//        onToggle(id), onReorder(id, slot), onHeaderMenu(event, column), scrollToToday:boolean }
export function drawChart(host, ctx) {
  const { tasks, collapsed, scale, mode, opts, today, patternId } = ctx;
  const cols = ctx.showTable === false ? [] : ctx.columns ?? [];
  const env = { today };
  const detailW = cols.reduce((a, c) => a + c.width, 0);

  const old = host.querySelector(".epq-chart");
  const keep = old && !ctx.scrollToToday ? { left: old.scrollLeft, top: old.scrollTop } : null;
  const keepTop = old ? old.scrollTop : 0;
  host.textContent = "";

  const axis = makeAxis(tasks, today, scale, opts.padding);
  const totalW = NAME_W + detailW + axis.width;
  const bodyH = Math.max(1, tasks.length) * ROW_H;

  const scroller = html("div", "epq-chart", host);
  const inner = html("div", "epq-inner", scroller);
  inner.style.width = `${totalW}px`;

  // ---- header ----
  const head = html("div", "epq-head", inner);
  head.style.height = `${HEAD_H}px`;
  const nh = html("div", "epq-nh epq-hcell", head, "Name");
  nh.style.width = `${NAME_W}px`;
  const headCells = [];
  if (cols.length) {
    const dh = html("div", "epq-dh", head);
    dh.style.width = `${detailW}px`;
    for (const col of cols) {
      const c = html("div", "epq-hcell epq-hcol", dh, col.label);
      c.style.width = `${col.width}px`;
      c.dataset.col = col.id;
      c.addEventListener("contextmenu", (e) => {
        if (!ctx.onHeaderMenu) return;
        e.preventDefault();
        ctx.onHeaderMenu(e, col);
      });
      headCells.push({ id: col.id, el: c });
    }
  }
  enableHeaderDrag(inner, headCells, ctx, HEAD_H + bodyH);

  const ch = html("div", "epq-ch", head);
  ch.style.width = `${axis.width}px`;
  const hs = svg("svg", { width: axis.width, height: HEAD_H, class: "epq-hsvg" }, ch);
  const hdr = headerShapes(axis, HEAD_H);
  for (const l of hdr.lines) svg("line", { x1: l.x1, x2: l.x2, y1: l.y1, y2: l.y2, class: "epq-hline" }, hs);
  for (const t of hdr.texts) {
    const attrs = { x: t.x, y: t.y, class: t.top ? "epq-htext epq-htop" : "epq-htext" };
    if (t.anchor === "middle") attrs["text-anchor"] = "middle";
    svg("text", attrs, hs).textContent = t.text;
  }
  svg("path", { d: `M${axis.todayX - 6},${HEAD_H} L${axis.todayX + 6},${HEAD_H} L${axis.todayX},${HEAD_H - 9} Z`, class: "epq-today-mark" }, hs);

  // ---- body: table rows (HTML) ----
  const body = html("div", "epq-body", inner);
  body.style.height = `${bodyH}px`;
  tasks.forEach((t, i) => {
    const row = html("div", "epq-row", body);
    row.style.height = `${ROW_H}px`;
    row.style.top = `${i * ROW_H}px`;
    row.dataset.task = t.id;
    const nc = html("div", `epq-nc epq-st-${taskStatus(t, today)}`, row);
    nc.style.width = `${NAME_W}px`;
    nc.dataset.task = t.id;
    nc.style.paddingLeft = `${10 + (t.depth ?? 0) * 18}px`;
    html("span", "epq-chev", nc, t.hasChildren ? (collapsed.has(t.id) ? "\u25B8" : "\u25BE") : "");
    html("span", "epq-nname", nc, t.name);
    if (t.hasChildren) {
      nc.classList.add("has-children");
      nc.addEventListener("click", () => ctx.onToggle?.(t.id));
    }
    if (cols.length) {
      const dc = html("div", "epq-dc", row);
      dc.style.width = `${detailW}px`;
      for (const col of cols) {
        const extra = col.cls ? ` ${col.cls(t, env)}` : "";
        const c = html("div", `epq-cell${extra}`, dc);
        c.style.width = `${col.width}px`;
        html("span", "epq-ct", c, cellText(col, t, env));
      }
    }
  });

  // ---- body: timeline (one SVG) ----
  const bs = svg("svg", { width: axis.width, height: bodyH, class: "epq-bsvg" }, body);
  bs.style.left = `${NAME_W + detailW}px`;
  const defs = svg("defs", {}, bs);
  const pat = svg("pattern", { id: patternId, patternUnits: "userSpaceOnUse", width: 8, height: 8, patternTransform: "rotate(45)" }, defs);
  svg("rect", { width: 3.5, height: 8, class: "epq-stripe" }, pat);

  for (const b of axis.bottom) svg("line", { x1: b.to, x2: b.to, y1: 0, y2: bodyH, class: "epq-grid" }, bs);
  tasks.forEach((t, i) => {
    const y = i * ROW_H;
    svg("rect", { x: 0, y, width: axis.width, height: ROW_H, class: "epq-rowhit", "data-task": t.id }, bs);
    svg("line", { x1: 0, x2: axis.width, y1: y + ROW_H, y2: y + ROW_H, class: "epq-grid" }, bs);
  });

  for (const b of bodyBars(tasks, axis, mode, opts, today, { rowH: ROW_H, barTop: BAR_TOP })) {
    const y = b.row * ROW_H;
    const attrs = { x: b.x, y: y + b.y, width: b.w, height: b.h, rx: b.rx, class: `epq-bar epq-bar-${b.kind}`, "data-task": b.id };
    if (b.kind === "actual") attrs.class += opts.hatch ? " is-hatched" : " is-solid";
    const r = svg("rect", attrs, bs);
    if (b.kind === "actual" && opts.hatch) r.style.fill = `url(#${patternId})`;
    if (b.label) svg("text", { x: b.label.x, y: y + b.label.y, "text-anchor": "middle", class: "epq-bar-label" }, bs).textContent = b.label.text;
  }

  // Today line: same axis as the bars, drawn last so it is always on top.
  svg("line", { x1: axis.todayX, x2: axis.todayX, y1: 0, y2: bodyH, class: "epq-today" }, bs);
  svg("line", { x1: axis.todayX, x2: axis.todayX, y1: HEAD_H - 9, y2: HEAD_H, class: "epq-today" }, hs);

  // ---- scroll position ----
  const apply = () => {
    if (keep) { scroller.scrollLeft = keep.left; scroller.scrollTop = keep.top; return; }
    const view = scroller.clientWidth || host.clientWidth || 800;
    // Bring today into view. Snap so the timeline starts flush against the name column (no
    // half-hidden detail column); scroll left to see the detail columns.
    const want = detailW + axis.todayX - (view - NAME_W) * 0.4;
    scroller.scrollLeft = want < detailW / 2 ? 0 : Math.max(detailW, want);
    scroller.scrollTop = keepTop;
  };
  apply();
  requestAnimationFrame(apply);
  return { scroller, axis, detailW };
}
