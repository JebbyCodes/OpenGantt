// Draws the whole Gantt chart (table + timeline) with plain DOM/SVG. No third-party chart library.
import { makeAxis, taskStatus, headerShapes, bodyBars, markerDates, markerShapes, weekendSpans, barColors, tagLabels, tagColor, TAG_ICON_D } from "./timeline.js";
import { cellText, columnWidths, WIDTH_LIMITS } from "./columns.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const ROW_H = 40;
export const HEAD_H = 56;
export const NAME_W = 280; // the old fixed width; columns now size themselves (see columnWidths)
export const BAR_TOP = 7;
const STATUS_TITLE = { idle: "Not started", progress: "In progress", overdue: "Overdue", done: "Completed", late: "Completed late" };

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
  if (!ctx.onReorder || !cells.length) return;
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
    else if (commit && !d.active && ctx.onHeaderClick) ctx.onHeaderClick(d.id); // a plain click
  };

  for (const c of cells) {
    c.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.pointerType === "touch" || e.target.closest?.(".epq-resize")) return;
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
      if (cells.length < 2) return;
      drag.slot = slotAt(e.clientX);
      marker.style.left = `${markerX(drag.slot)}px`;
    });
    c.el.addEventListener("pointerup", (e) => { if (!e.target.closest?.(".epq-resize")) end(true); });
    c.el.addEventListener("pointercancel", () => end(false));
  }
}

// A thin grip on the right edge of a header cell. Drag to resize, double-click to go back to automatic width.
// Listens on the document while dragging (not pointer capture), because every resize step redraws the chart and
// replaces the grip under the pointer.
function addResizeGrip(cell, id, width, limits, ctx) {
  const g = html("div", "epq-resize", cell);
  g.title = "Drag to resize, double-click to fit";
  g.addEventListener("click", (e) => e.stopPropagation());
  g.addEventListener("dblclick", (e) => { e.stopPropagation(); ctx.onResetWidth?.(id); });
  g.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !ctx.onResize) return;
    e.preventDefault();
    e.stopPropagation();
    const doc = g.ownerDocument;
    const x0 = e.clientX;
    let last = width;
    let frame = 0;
    let moved = false; // a plain click (or the first half of a double-click) must not change anything
    const next = (ev) => Math.min(limits[1], Math.max(limits[0], Math.round(width + ev.clientX - x0)));
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      last = next(ev);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; ctx.onResize(id, last, false); });
    };
    const up = (ev) => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", up);
      doc.body.classList.remove("epq-resizing");
      cancelAnimationFrame(frame);
      if (!moved) return;
      last = next(ev);
      ctx.onResize(id, last, true);
    };
    doc.body.classList.add("epq-resizing");
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
    doc.addEventListener("pointercancel", up);
  });
}

// ctx: { tasks (visible rows, in order), collapsed:Set, scale, mode, opts, today, patternId,
//        columns (visible column definitions, in order), showTable:boolean,
//        onToggle(id), onReorder(id, slot), onHeaderMenu(event, column), scrollToToday:boolean,
//        measure(text, px, bold), widths { name?, [columnId]? } (manual), onResize(id, px, final), onResetWidth(id),
//        onHeaderClick(id), sort { id, dir }, nameColors Map(taskId -> css colour), scheme "dark"|"light" }
export function drawChart(host, ctx) {
  const { tasks, collapsed, scale, mode, opts, today, patternId } = ctx;
  const env = { today };
  const measure = ctx.measure ?? ((t, px, bold) => String(t).length * px * (bold ? 0.6 : 0.55));
  const shown = ctx.showTable === false ? [] : ctx.columns ?? [];
  // Widths: automatic (fit the text) unless the user dragged a column to a size.
  const W = columnWidths({ tasks, columns: shown, measure, env, manual: ctx.widths ?? {} });
  const nameW = W.name;
  const cols = shown.map((c) => ({ ...c, width: W.cols.get(c.id) }));
  const detailW = cols.reduce((a, c) => a + c.width, 0);

  const old = host.querySelector(".epq-chart");
  const keep = old && !ctx.scrollToToday ? { left: old.scrollLeft, top: old.scrollTop } : null;
  const keepTop = old ? old.scrollTop : 0;
  host.textContent = "";

  const axis = makeAxis(tasks, today, scale, opts.padding, undefined, markerDates(opts));
  const totalW = nameW + detailW + axis.width;
  const bodyH = Math.max(1, tasks.length) * ROW_H;

  const scroller = html("div", "epq-chart", host);
  const inner = html("div", "epq-inner", scroller);
  inner.style.width = `${totalW}px`;

  // ---- header ----
  const arrow = (id) => (ctx.sort?.id === id ? (ctx.sort.dir === "desc" ? " \u25BC" : " \u25B2") : "");
  const head = html("div", "epq-head", inner);
  head.style.height = `${HEAD_H}px`;
  const nh = html("div", "epq-nh epq-hcell", head, `Name${arrow("name")}`);
  nh.style.width = `${nameW}px`;
  nh.classList.toggle("is-sorted", ctx.sort?.id === "name");
  if (ctx.onHeaderClick) {
    nh.classList.add("is-sortable");
    nh.addEventListener("click", (e) => { if (!e.target.closest(".epq-resize")) ctx.onHeaderClick("name"); });
  }
  addResizeGrip(nh, "name", nameW, WIDTH_LIMITS.name, ctx);
  const headCells = [];
  if (cols.length) {
    const dh = html("div", "epq-dh", head);
    dh.style.width = `${detailW}px`;
    for (const col of cols) {
      const c = html("div", "epq-hcell epq-hcol", dh, `${col.label}${arrow(col.id)}`);
      c.style.width = `${col.width}px`;
      c.dataset.col = col.id;
      c.classList.toggle("is-sorted", ctx.sort?.id === col.id);
      if (ctx.onHeaderClick) c.classList.add("is-sortable");
      c.addEventListener("contextmenu", (e) => {
        if (!ctx.onHeaderMenu) return;
        e.preventDefault();
        ctx.onHeaderMenu(e, col);
      });
      addResizeGrip(c, col.id, col.width, WIDTH_LIMITS.column, ctx);
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
  const markers = markerShapes(axis, opts);
  for (const m of markers) svg("path", { d: `M${m.x},${HEAD_H - 11} L${m.x + 5},${HEAD_H - 6} L${m.x},${HEAD_H - 1} L${m.x - 5},${HEAD_H - 6} Z`, class: "epq-marker-mark" }, hs);

  // ---- body: table rows (HTML) ----
  const body = html("div", "epq-body", inner);
  body.style.height = `${bodyH}px`;
  tasks.forEach((t, i) => {
    const row = html("div", "epq-row", body);
    row.style.height = `${ROW_H}px`;
    row.style.top = `${i * ROW_H}px`;
    row.dataset.task = t.id;
    // Name colouring: "tree" gives every branch its own family colour and shows status as a dot; "status" colours the
    // text by status; "none" leaves it plain.
    const status = taskStatus(t, today);
    const mode_ = opts.nameColors ?? "tree";
    const nc = html("div", `epq-nc${mode_ === "status" ? ` epq-st-${status}` : ""}`, row);
    nc.style.width = `${nameW}px`;
    nc.dataset.task = t.id;
    nc.style.paddingLeft = `${10 + (t.depth ?? 0) * 18}px`;
    html("span", "epq-chev", nc, t.hasChildren ? (collapsed.has(t.id) ? "\u25B8" : "\u25BE") : "");
    if (mode_ === "tree") html("span", `epq-sdot epq-st-${status}`, nc).title = STATUS_TITLE[status];
    const nm = html("span", "epq-nname", nc, t.name);
    const tint = mode_ === "tree" ? ctx.nameColors?.get(t.id) : null;
    if (tint) nm.style.color = tint;
    if (t.hasChildren) {
      nc.classList.add("has-children");
      nc.addEventListener("click", () => ctx.onToggle?.(t.id));
    }
    nc.addEventListener("dblclick", (e) => { if (!t.hasChildren || e.target === nm) ctx.onActivate?.(t.id); });
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
  bs.style.left = `${nameW + detailW}px`;
  const defs = svg("defs", {}, bs);
  const pat = svg("pattern", { id: patternId, patternUnits: "userSpaceOnUse", width: 8, height: 8, patternTransform: "rotate(45)" }, defs);
  svg("rect", { width: 3.5, height: 8, class: "epq-stripe" }, pat);
  // A task with its own `color` gets a striped pattern in that colour.
  const bars = bodyBars(tasks, axis, mode, opts, today, { rowH: ROW_H, barTop: BAR_TOP });
  const colorIds = new Map(barColors(bars).map((c, i) => [c, `${patternId}-c${i}`]));
  for (const [color, id] of colorIds) {
    const cp = svg("pattern", { id, patternUnits: "userSpaceOnUse", width: 8, height: 8, patternTransform: "rotate(45)" }, defs);
    svg("rect", { width: 3.5, height: 8 }, cp).style.fill = color;
  }

  for (const w of weekendSpans(axis, opts)) svg("rect", { x: w.x, y: 0, width: w.w, height: bodyH, class: "epq-weekend" }, bs);
  for (const b of axis.bottom) svg("line", { x1: b.to, x2: b.to, y1: 0, y2: bodyH, class: "epq-grid" }, bs);
  tasks.forEach((t, i) => {
    const y = i * ROW_H;
    svg("rect", { x: 0, y, width: axis.width, height: ROW_H, class: "epq-rowhit", "data-task": t.id }, bs);
    svg("line", { x1: 0, x2: axis.width, y1: y + ROW_H, y2: y + ROW_H, class: "epq-grid" }, bs);
  });

  for (const b of bars) {
    const y = b.row * ROW_H;
    const attrs = { x: b.x, y: y + b.y, width: b.w, height: b.h, rx: b.rx, class: `epq-bar epq-bar-${b.kind}`, "data-task": b.id };
    if (b.kind === "actual") attrs.class += opts.hatch ? " is-hatched" : " is-solid";
    const r = svg("rect", attrs, bs);
    if (b.kind === "actual" && opts.hatch) r.style.fill = `url(#${b.color ? colorIds.get(b.color) : patternId})`;
    if (b.color) {
      if (b.kind === "plan") r.style.fill = b.color;
      else {
        r.style.stroke = b.color;
        if (b.kind === "progress" || (b.kind === "actual" && !opts.hatch)) r.style.fill = b.color;
      }
    }
    if (b.label) svg("text", { x: b.label.x, y: y + b.label.y, "text-anchor": "middle", class: "epq-bar-label" }, bs).textContent = b.label.text;
  }

  // Tag labels: a small icon and the task's tags just beyond its bars; quiet on purpose, the tooltip has the full list.
  if (opts.tagLabels !== false) {
    const scheme = ctx.scheme ?? "dark";
    const labels = tagLabels(tasks, bars, axis, (t, px) => measure(t, px, false));
    tasks.forEach((t, i) => {
      const lab = labels.get(t.id);
      if (!lab) return;
      const g = svg("g", { class: "epq-tag", "data-task": t.id, transform: `translate(${lab.x} ${i * ROW_H + ROW_H / 2 - 6})` }, bs);
      svg("path", { d: TAG_ICON_D, class: "epq-tag-icon" }, g).style.fill = tagColor(t.tags[0], scheme);
      svg("text", { x: 13, y: 9.5, class: "epq-tag-text" }, g).textContent = lab.text;
    });
  }

  // Marker lines: a dashed line the full height of the chart with its label running down beside it.
  for (const m of markers) {
    const line = svg("line", { x1: m.x, x2: m.x, y1: 0, y2: bodyH, class: "epq-marker" }, bs);
    if (m.label) {
      svg("title", {}, line).textContent = m.label;
      const room = Math.max(0, Math.floor((bodyH - 12) / 6.5));
      const text = m.label.length > room ? `${m.label.slice(0, Math.max(0, room - 1))}\u2026` : m.label;
      if (room > 0) svg("text", { transform: `translate(${m.x + 3} 6) rotate(90)`, class: "epq-marker-text" }, bs).textContent = text;
    }
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
    const want = detailW + axis.todayX - (view - nameW) * 0.4;
    scroller.scrollLeft = want < detailW / 2 ? 0 : Math.max(detailW, want);
    scroller.scrollTop = keepTop;
  };
  apply();
  requestAnimationFrame(apply);
  return { scroller, axis, detailW };
}
