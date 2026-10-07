import { Plugin, MarkdownRenderChild, Menu, Notice, Platform, normalizePath, parseYaml } from "obsidian";
import "./styles.css";
import { buildTasks, readBlockOptions, todayUtc, visibleTasks, parentIds } from "./model.js";
import { drawChart } from "./chart.js";
import { buildColumns, resolveLayout, mergeSaved, visibleColumns, moveStep, moveToVisibleSlot, humanize } from "./columns.js";
import { layoutChart, buildImageSvg, buildPrintPages, buildPrintHtml, buildCsv, exportFileName, printDesignWidth, estimate, FONT } from "./export.js";

const SCALE_LABELS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];
const MODE_LABELS = [["planned", "Plan"], ["actual", "Actual"], ["both", "Both"]];

const DEFAULT_OUTPUT = { orientation: "landscape", theme: "light", title: true, legend: true, toVault: false };

let blockCounter = 0;

// Parse an SVG string into a node of `doc` (also checks it is well-formed).
function parseSvg(doc, text) {
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("the print layout is not valid SVG");
  return doc.importNode(parsed.documentElement, true);
}

// ---- Hover tooltip -----------------------------------------------------------------------
const fmtDate = (d) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

const dayCount = (a, b) => Math.round((b - a) / 86400000) + 1;

function rangeText(start, end, today) {
  if (!start) return null;
  if (!end || +end === +start) return fmtDate(start);
  const days = dayCount(start, end);
  const endText = +end === +today ? "today" : fmtDate(end);
  return `${fmtDate(start)} – ${endText} (${days} day${days === 1 ? "" : "s"})`;
}

class GanttBlock extends MarkdownRenderChild {
  constructor(containerEl, source, plugin, ctx) {
    super(containerEl);
    this.source = source;
    this.plugin = plugin;
    this.ctx = ctx;
    this.dead = false;
    this.id = `epq-gantt-${++blockCounter}`;
  }

  onload() {
    this.plugin.blocks.add(this);
    this.render();
    this.registerDomEvent(document, "fullscreenchange", () => this.onFullChange());
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key === "Escape" && this.blockEl?.classList.contains("is-expanded")) this.setExpanded(false);
    });
  }

  onunload() {
    this.dead = true;
    this.plugin.blocks.delete(this);
    this.closePopover();
    this.disposePrintFrame();
    if (this.blockEl && document.fullscreenElement === this.blockEl) document.exitFullscreen?.();
  }

  isFull() {
    return !!this.blockEl && (document.fullscreenElement === this.blockEl || this.blockEl.classList.contains("is-expanded"));
  }

  async toggleFullscreen() {
    if (!this.blockEl) return;
    if (this.isFull()) {
      if (document.fullscreenElement === this.blockEl) await document.exitFullscreen();
      else this.setExpanded(false);
      return;
    }
    try {
      if (this.blockEl.requestFullscreen) {
        await this.blockEl.requestFullscreen();
        return; // onFullChange() takes it from here
      }
    } catch (e) {
      console.warn("Gantt: real fullscreen refused, using in-window view", e);
    }
    this.setExpanded(true); // e.g. mobile, where element fullscreen isn't supported
  }

  setExpanded(on) {
    this.blockEl.classList.toggle("is-expanded", on);
    this.onFullChange();
  }

  onFullChange() {
    const full = this.isFull();
    if (full === !!this.wasFull) return;
    this.wasFull = full;
    if (this.fullBtn) this.fullBtn.setText(full ? "Exit full screen" : "Full screen");
    this.fullBtn?.toggleClass("is-active", full);
    requestAnimationFrame(() => this.draw());
  }

  setupTooltip() {
    const tip = this.blockEl.createDiv({ cls: "epq-gantt-tooltip" });
    this.tipEl = tip;
    const hide = () => tip.removeClass("is-visible");
    let last = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const e = last;
      const el = e?.target?.closest?.("[data-task]");
      const task = el && this.info.get(el.dataset.task);
      if (!task) return hide();
      this.fillTooltip(tip, task);
      tip.addClass("is-visible");
      const box = this.blockEl.getBoundingClientRect();
      let x = e.clientX - box.left + 14;
      const y = e.clientY - box.top + 16;
      if (x + tip.offsetWidth > box.width - 6) x = Math.max(6, e.clientX - box.left - tip.offsetWidth - 14);
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.min(y, Math.max(6, box.height - tip.offsetHeight - 6))}px`;
    };
    this.hostEl.addEventListener("pointermove", (e) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(update);
    });
    this.hostEl.addEventListener("pointerleave", () => { last = null; hide(); });
    this.hostEl.addEventListener("pointerdown", hide);
    this.hostEl.addEventListener("scroll", hide, true);
  }

  fillTooltip(tip, task) {
    tip.empty();
    tip.createDiv({ cls: "epq-gantt-tip-title", text: task.name });
    const row = (label, value, cls) => {
      if (!value) return;
      const r = tip.createDiv({ cls: "epq-gantt-tip-row" });
      r.createSpan({ cls: `epq-gantt-tip-label ${cls}`, text: label });
      r.createSpan({ text: value });
    };
    const today = this.today;
    row("Planned", rangeText(task.datePlannedStart, task.datePlannedEnd, today), "is-plan");
    row("Actual", rangeText(task.dateActualStart, task.dateActualEnd, today), "is-actual");
    if (task.factOpen) row("Progress", `${fmtDate(task.dateActualStart)} – today (${dayCount(task.dateActualStart, today)} days), ${task.progress}% of plan`, "is-actual");
    else if (task.dateActualStart) row("Progress", `${task.progress}%`, "");
    for (const [key, value] of Object.entries(task.extra ?? {})) row(humanize(key), value, "");
    if (task.notes) tip.createDiv({ cls: "epq-gantt-tip-notes", text: task.notes });
  }

  toggleTask(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    this.draw();
  }

  setAllCollapsed(collapse) {
    this.collapsed = new Set(collapse ? parentIds(this.tasks) : []);
    this.draw();
  }

  // (Re)draws the chart. Scroll position is kept unless `scrollToToday` is set.
  draw(scrollToToday = false) {
    if (!this.hostEl || this.dead) return;
    try {
      this.visible = visibleTasks(this.tasks, this.collapsed);
      drawChart(this.hostEl, {
        tasks: this.visible,
        collapsed: this.collapsed,
        scale: this.state.scale,
        mode: this.state.mode,
        opts: this.opts,
        today: this.today,
        patternId: `${this.id}-hatch`,
        columns: visibleColumns(this.available, this.layout),
        showTable: this.showTable,
        onToggle: (id) => this.toggleTask(id),
        onReorder: (id, slot) => this.reorderVisible(id, slot),
        onHeaderMenu: (e, col) => this.headerMenu(e, col),
        scrollToToday,
      });
    } catch (e) {
      console.error(e);
      this.hostEl.textContent = "";
      this.hostEl.createDiv({ cls: "epq-gantt-error", text: `Gantt: could not draw the chart - ${e.message}` });
      return;
    }
    this.refreshPrintPages();
  }

  async render() {
    let doc;
    try {
      doc = parseYaml(this.source);
    } catch (e) {
      return this.showError(`YAML problem - ${e.message}`);
    }
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.rows) || !doc.rows.length) {
      return this.showError("no rows found. Put tasks under rows:");
    }

    const opts = readBlockOptions(doc);
    this.today = todayUtc();
    const tasks = buildTasks(doc.rows, this.today);
    this.state = { scale: opts.scale, mode: opts.mode };
    this.collapsed = new Set(opts.collapsed ? parentIds(tasks) : []);

    // Table columns: this block's own `columns:` / `table:` win; otherwise the layout saved for all charts.
    this.opts = opts;
    this.available = buildColumns(tasks, opts.columns ?? []);
    this.pinnedLayout = opts.columns != null;
    this.pinnedTable = opts.table != null;
    this.layout = this.startLayout();
    this.showTable = opts.table ?? this.plugin.state.table !== false;

    this.closePopover();
    this.disposePrintFrame();
    this.printEl = null;
    this.containerEl.empty();
    const block = this.containerEl.createDiv({ cls: "epq-gantt-block" });
    this.buildToolbar(block, parentIds(tasks).length > 0);
    const legend = this.buildLegend(block, opts);
    legend.toggleClass("is-hidden", !this.plugin.state.legend);
    this.legendEl = legend;

    this.blockEl = block;
    this.wasFull = false;
    const host = block.createDiv({ cls: "epq-gantt-host" });
    host.id = this.id;
    host.style.height = `${opts.height}px`;
    this.hostEl = host;
    this.opts = opts;
    this.tasks = tasks;
    this.visible = visibleTasks(tasks, this.collapsed);
    this.info = new Map(tasks.map((t) => [t.id, t]));
    this.setupTooltip();
    this.draw(true);
  }

  // ---- Table layout: show / hide / add / reorder columns ---------------------------------------
  startLayout() {
    return resolveLayout(this.available, this.pinnedLayout ? { yaml: this.opts.columns } : { saved: this.plugin.state.layout });
  }

  // Redraw after a layout change and remember it. `jump` re-snaps the scroll, needed when the table's width changes.
  applyLayout({ jump = true } = {}) {
    this.draw(jump);
    this.syncTableButton();
    this.refreshColumnsPanel?.();
    this.plugin.persistView(this);
  }

  // Another chart changed the saved layout.
  adoptSavedView() {
    if (!this.available || this.dead) return;
    if (!this.pinnedLayout) this.layout = this.startLayout();
    if (!this.pinnedTable) this.showTable = this.plugin.state.table !== false;
    this.draw(true);
    this.syncTableButton();
    this.refreshColumnsPanel?.();
  }

  toggleTable() {
    this.showTable = !this.showTable;
    this.applyLayout();
  }

  setShown(id, on) {
    if (on) this.layout.shown.add(id);
    else this.layout.shown.delete(id);
    this.applyLayout();
  }

  reorderVisible(id, slot) {
    this.layout.order = moveToVisibleSlot(this.layout.order, this.layout.shown, id, slot);
    this.applyLayout({ jump: false });
  }

  resetColumns() {
    this.layout = resolveLayout(this.available, this.pinnedLayout ? { yaml: this.opts.columns } : {});
    this.showTable = this.pinnedTable ? this.opts.table : true;
    this.applyLayout();
  }

  headerMenu(evt, col) {
    const menu = new Menu();
    const vis = visibleColumns(this.available, this.layout).map((c) => c.id);
    const i = vis.indexOf(col.id);
    menu.addItem((it) => it.setTitle(`Hide "${col.label}"`).setIcon("eye-off").onClick(() => this.setShown(col.id, false)));
    if (i > 0) menu.addItem((it) => it.setTitle("Move left").setIcon("arrow-left").onClick(() => this.reorderVisible(col.id, i - 1)));
    if (i >= 0 && i < vis.length - 1) menu.addItem((it) => it.setTitle("Move right").setIcon("arrow-right").onClick(() => this.reorderVisible(col.id, i + 1)));
    menu.addSeparator();
    menu.addItem((it) => it.setTitle("Choose columns\u2026").setIcon("columns").onClick(() => this.openColumns()));
    menu.showAtMouseEvent(evt);
  }

  // ---- Popovers (inside the block, so they also show in full screen) ---------------------------
  closePopover() {
    this.popoverCleanup?.();
    this.popoverCleanup = null;
    this.popover?.remove();
    this.popover = null;
    this.popoverAnchor?.removeClass?.("is-open");
    this.popoverAnchor = null;
    this.refreshColumnsPanel = null;
  }

  openPopover(anchor, cls, build) {
    const toggleOff = this.popover && this.popoverAnchor === anchor;
    this.closePopover();
    if (toggleOff || !this.blockEl) return;
    const doc = this.containerEl.ownerDocument;
    const pop = this.blockEl.createDiv({ cls: `epq-gantt-popover ${cls}` });
    this.popover = pop;
    this.popoverAnchor = anchor;
    anchor.addClass("is-open");
    build(pop);

    const bb = this.blockEl.getBoundingClientRect();
    const tb = this.toolbarEl.getBoundingClientRect();
    const ab = anchor.getBoundingClientRect();
    const top = tb.bottom - bb.top + 4;
    pop.style.top = `${top}px`;
    pop.style.maxHeight = `${Math.max(160, bb.height - top - 8)}px`;
    pop.style.left = `${Math.max(8, Math.min(ab.left - bb.left, bb.width - pop.offsetWidth - 8))}px`;

    const onDown = (e) => {
      if (!pop.contains(e.target) && !anchor.contains(e.target)) this.closePopover();
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // don't also leave full screen
      this.closePopover();
    };
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("keydown", onKey, true);
    this.popoverCleanup = () => {
      doc.removeEventListener("pointerdown", onDown, true);
      doc.removeEventListener("keydown", onKey, true);
    };
  }

  openColumns() {
    this.openPopover(this.columnsBtn, "is-columns", (pop) => this.buildColumnsPanel(pop));
  }

  buildColumnsPanel(pop) {
    const head = pop.createDiv({ cls: "epq-pop-head" });
    head.createSpan({ cls: "epq-pop-title", text: "Table columns" });
    const tools = head.createDiv({ cls: "epq-pop-tools" });
    tools.createEl("button", { text: "Show all" }).addEventListener("click", () => {
      this.layout.shown = new Set(this.layout.order);
      this.showTable = true;
      this.applyLayout();
    });
    tools.createEl("button", { text: "Reset" }).addEventListener("click", () => this.resetColumns());
    const list = pop.createDiv({ cls: "epq-col-list" });
    this.refreshColumnsPanel = () => this.fillColumnList(list);
    this.fillColumnList(list);
    pop.createDiv({
      cls: "epq-pop-note",
      text: "Name is always shown. Drag \u2807 or use the arrows to reorder; you can also drag a column heading in the chart. Extra keys on a task (e.g. owner: Sam) appear here as their own columns.",
    });
  }

  fillColumnList(list) {
    list.empty();
    const byId = new Map(this.available.map((c) => [c.id, c]));
    const order = this.layout.order;
    order.forEach((id, i) => {
      const col = byId.get(id);
      if (!col) return;
      const row = list.createDiv({ cls: "epq-col-item", attr: { "data-id": id } });
      const grip = row.createSpan({ cls: "epq-grip", text: "\u2807", attr: { title: "Drag to reorder" } });
      grip.addEventListener("pointerdown", (e) => this.startListDrag(e, row, list));
      const label = row.createEl("label", { cls: "epq-col-label" });
      const cb = label.createEl("input", { type: "checkbox" });
      cb.checked = this.layout.shown.has(id);
      cb.addEventListener("change", () => this.setShown(id, cb.checked));
      label.createSpan({ text: col.label });
      if (!col.builtin) row.createSpan({ cls: "epq-col-tag", text: "YAML" });
      const up = row.createEl("button", { cls: "epq-mini", text: "\u25B2", attr: { "aria-label": `Move ${col.label} up` } });
      const down = row.createEl("button", { cls: "epq-mini", text: "\u25BC", attr: { "aria-label": `Move ${col.label} down` } });
      up.disabled = i === 0;
      down.disabled = i === order.length - 1;
      up.addEventListener("click", () => { this.layout.order = moveStep(this.layout.order, id, -1); this.applyLayout({ jump: false }); });
      down.addEventListener("click", () => { this.layout.order = moveStep(this.layout.order, id, 1); this.applyLayout({ jump: false }); });
    });
  }

  // Drag a row of the column list. Uses pointer events on the document (not capture) because the row itself is
  // moved in the DOM while dragging, which would drop a pointer capture.
  startListDrag(e, row, list) {
    if (e.button !== 0) return;
    e.preventDefault();
    const doc = row.ownerDocument;
    const before = [...list.children].map((r) => r.dataset.id).join("|");
    row.addClass("is-dragging");
    const move = (ev) => {
      const others = [...list.children].filter((r) => r !== row);
      const next = others.find((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY < b.top + b.height / 2;
      });
      if (next) {
        if (row.nextElementSibling !== next) list.insertBefore(row, next);
      } else if (list.lastElementChild !== row) list.appendChild(row);
    };
    const done = () => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", done);
      doc.removeEventListener("pointercancel", done);
      row.removeClass("is-dragging");
      const order = [...list.children].map((r) => r.dataset.id);
      if (order.join("|") !== before) {
        this.layout.order = order;
        this.applyLayout({ jump: false });
      }
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", done);
    doc.addEventListener("pointercancel", done);
  }

  // ---- Print and export --------------------------------------------------------------------------
  openExport() {
    this.openPopover(this.exportBtn, "is-export", (pop) => this.buildExportPanel(pop));
  }

  buildExportPanel(pop) {
    const out = this.plugin.state.output;
    pop.createDiv({ cls: "epq-pop-head" }).createSpan({ cls: "epq-pop-title", text: "Export" });
    const acts = pop.createDiv({ cls: "epq-pop-actions" });
    acts.createEl("button", { text: "PNG image" }).addEventListener("click", () => this.exportPng());
    acts.createEl("button", { text: "SVG (vector)" }).addEventListener("click", () => this.exportSvg());
    acts.createEl("button", { text: "CSV table" }).addEventListener("click", () => this.exportCsv());

    pop.createDiv({ cls: "epq-pop-sub", text: "Options" });
    const seg = (label, items, current, key) => {
      const r = pop.createDiv({ cls: "epq-pop-row" });
      r.createSpan({ text: label });
      const g = r.createDiv({ cls: "epq-seg" });
      const btns = {};
      for (const [value, text] of items) {
        const b = g.createEl("button", { text });
        btns[value] = b;
        b.toggleClass("is-active", value === current);
        b.addEventListener("click", () => {
          for (const [v, x] of Object.entries(btns)) x.toggleClass("is-active", v === value);
          this.plugin.setOutput({ [key]: value });
        });
      }
    };
    const check = (label, key) => {
      const l = pop.createEl("label", { cls: "epq-opt" });
      const cb = l.createEl("input", { type: "checkbox" });
      cb.checked = !!out[key];
      l.createSpan({ text: label });
      cb.addEventListener("change", () => this.plugin.setOutput({ [key]: cb.checked }));
    };
    seg("Print page", [["landscape", "Landscape"], ["portrait", "Portrait"]], out.orientation, "orientation");
    seg("Image colours", [["light", "Light"], ["dark", "Dark"]], out.theme, "theme");
    check("Include title", "title");
    check("Include legend", "legend");
    check("Save into the vault, next to this note", "toVault");
    pop.createDiv({
      cls: "epq-pop-note",
      text: "Print and exports show the whole chart with the rows and columns you have now. To make a PDF, choose Save as PDF in the print dialog. CSV lists every task and the columns shown in the table.",
    });
  }

  // Text width in the chart's font, so print and export columns fit their text.
  measurer() {
    if (this._measure) return this._measure;
    let c = null;
    try {
      c = this.containerEl.ownerDocument.createElement("canvas").getContext("2d");
    } catch (e) {
      c = null;
    }
    if (!c) return (this._measure = estimate);
    const cache = new Map();
    this._measure = (text, px, bold) => {
      const key = `${bold ? 1 : 0}|${px}|${text}`;
      let w = cache.get(key);
      if (w == null) {
        c.font = `${bold ? 600 : 400} ${px}px ${FONT}`;
        w = c.measureText(text).width;
        cache.set(key, w);
      }
      return w;
    };
    return this._measure;
  }

  chartTitle() {
    if (this.opts.title) return this.opts.title;
    return (this.ctx?.sourcePath ?? "").split("/").pop().replace(/\.md$/i, "") || "Gantt";
  }

  // The rows and columns as they are on screen right now.
  exportModel(density) {
    const out = this.plugin.state.output;
    return layoutChart({
      tasks: this.visible,
      collapsed: this.collapsed,
      columns: this.showTable ? visibleColumns(this.available, this.layout) : [],
      scale: this.state.scale,
      mode: this.state.mode,
      opts: this.opts,
      today: this.today,
      density,
      fit: density === "print" ? { width: printDesignWidth(out.orientation), minTimeline: 360 } : null,
      measure: this.measurer(),
    });
  }

  imageSvg() {
    const out = this.plugin.state.output;
    return buildImageSvg(this.exportModel("screen"), {
      theme: out.theme, uid: `${this.id}-img`, title: out.title ? this.chartTitle() : "", legend: out.legend, measure: this.measurer(),
    });
  }

  printSvgs() {
    const out = this.plugin.state.output;
    return buildPrintPages(this.exportModel("print"), {
      title: out.title ? this.chartTitle() : "", legend: out.legend, orientation: out.orientation, uid: `${this.id}-pp`, measure: this.measurer(),
    });
  }

  // A hidden copy of the print pages lives in the block, shown only by @media print. That way Obsidian's own
  // "Export to PDF" (or printing the note) gets a clean, complete chart instead of the clipped on-screen one.
  refreshPrintPages() {
    if (!this.blockEl || this.dead || !this.visible) return;
    try {
      const host = this.printEl ?? (this.printEl = this.blockEl.createDiv({ cls: "epq-gantt-printpages" }));
      host.empty();
      const doc = this.containerEl.ownerDocument;
      for (const svg of this.printSvgs()) host.createDiv({ cls: "epq-gantt-page" }).appendChild(parseSvg(doc, svg));
    } catch (e) {
      console.error("Gantt: could not lay out the print pages", e);
    }
  }

  disposePrintFrame(frame = this.printFrame) {
    frame?.remove();
    if (this.printFrame === frame) this.printFrame = null;
  }

  // Prints from an isolated iframe so Obsidian's own page layout and theme can't interfere.
  print() {
    this.closePopover();
    let pages;
    try {
      pages = this.printSvgs();
    } catch (e) {
      console.error(e);
      new Notice(`Gantt: could not prepare the print layout - ${e.message}`);
      return;
    }
    const doc = this.containerEl.ownerDocument;
    this.disposePrintFrame();
    const frame = doc.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1100px;height:800px;border:0;opacity:0;pointer-events:none";
    frame.srcdoc = buildPrintHtml(pages, { title: this.chartTitle(), orientation: this.plugin.state.output.orientation });
    frame.addEventListener("load", () => {
      const win = frame.contentWindow;
      try {
        win.addEventListener("afterprint", () => setTimeout(() => this.disposePrintFrame(frame), 500));
        win.focus();
        win.print();
      } catch (e) {
        console.warn("Gantt: printing is not available here", e);
        new Notice("Gantt: printing isn't available here, so the chart is being exported as a PNG instead.");
        this.disposePrintFrame(frame);
        this.exportPng();
      }
    }, { once: true });
    doc.body.appendChild(frame);
    this.printFrame = frame;
  }

  async exportPng() {
    try {
      const { svg, width, height } = this.imageSvg();
      const blob = await this.rasterise(svg, width, height);
      await this.deliver(blob, exportFileName(this.chartTitle(), "png", this.today));
    } catch (e) {
      console.error(e);
      new Notice(`Gantt: could not export the image - ${e.message}`);
    }
  }

  async exportSvg() {
    try {
      const { svg } = this.imageSvg();
      const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: "image/svg+xml" });
      await this.deliver(blob, exportFileName(this.chartTitle(), "svg", this.today));
    } catch (e) {
      console.error(e);
      new Notice(`Gantt: could not export the SVG - ${e.message}`);
    }
  }

  async exportCsv() {
    try {
      const csv = buildCsv(this.tasks, visibleColumns(this.available, this.layout), this.today);
      await this.deliver(new Blob([csv], { type: "text/csv;charset=utf-8" }), exportFileName(this.chartTitle(), "csv", this.today));
    } catch (e) {
      console.error(e);
      new Notice(`Gantt: could not export the table - ${e.message}`);
    }
  }

  // SVG -> PNG at up to 2x, kept inside the browser's canvas size limits.
  async rasterise(svg, width, height) {
    const doc = this.containerEl.ownerDocument;
    const k = Math.min(2, 16000 / Math.max(width, height), Math.sqrt(1e8 / (width * height)));
    if (!(k > 0.1)) throw new Error("the chart is too large for an image; export SVG instead");
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("the chart could not be drawn to an image"));
        img.src = url;
      });
      const canvas = doc.createElement("canvas");
      canvas.width = Math.round(width * k);
      canvas.height = Math.round(height * k);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Desktop: a normal download (the system asks where to save). Mobile, or "Save into the vault": a file beside the note.
  async deliver(blob, name) {
    if (this.plugin.state.output.toVault || Platform.isMobile) return this.saveToVault(blob, name);
    try {
      const doc = this.containerEl.ownerDocument;
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      console.warn("Gantt: download failed, saving into the vault instead", e);
      return this.saveToVault(blob, name);
    }
  }

  async saveToVault(blob, name) {
    const vault = this.plugin.app.vault;
    const src = this.ctx?.sourcePath ?? "";
    const dir = src.includes("/") ? src.replace(/\/[^/]*$/, "") : "";
    let path = normalizePath(dir ? `${dir}/${name}` : name);
    const dot = path.lastIndexOf(".");
    const stem = path.slice(0, dot);
    const ext = path.slice(dot);
    for (let i = 2; vault.getAbstractFileByPath(path); i++) path = `${stem} ${i}${ext}`;
    await vault.createBinary(path, await blob.arrayBuffer());
    new Notice(`Gantt: saved ${path}`);
  }

  showError(message) {
    this.containerEl.empty();
    const box = this.containerEl.createDiv({ cls: "epq-gantt-block" });
    box.createDiv({ cls: "epq-gantt-error", text: `Gantt: ${message}` });
  }

  buildToolbar(block, hasParents) {
    const bar = block.createDiv({ cls: "epq-gantt-toolbar" });
    this.buttons = { scale: {}, mode: {} };

    const group = (kind, items) => {
      const g = bar.createDiv({ cls: "epq-gantt-group" });
      for (const [value, label] of items) {
        const btn = g.createEl("button", { text: label });
        this.buttons[kind][value] = btn;
        btn.addEventListener("click", () => {
          this.state[kind] = value;
          this.draw(kind === "scale"); // a new scale changes every x position, so jump to today
          this.syncButtons();
        });
      }
    };
    group("scale", SCALE_LABELS);
    group("mode", MODE_LABELS);

    if (hasParents) {
      const g = bar.createDiv({ cls: "epq-gantt-group" });
      g.createEl("button", { text: "Expand all" }).addEventListener("click", () => this.setAllCollapsed(false));
      g.createEl("button", { text: "Collapse all" }).addEventListener("click", () => this.setAllCollapsed(true));
    }

    const tbl = bar.createDiv({ cls: "epq-gantt-group" });
    this.tableBtn = tbl.createEl("button", { text: "Table", attr: { title: "Show or hide the left-hand table" } });
    this.tableBtn.addEventListener("click", () => this.toggleTable());
    this.columnsBtn = tbl.createEl("button", { text: "Columns", attr: { title: "Choose, add and reorder table columns" } });
    this.columnsBtn.addEventListener("click", () => this.openColumns());
    this.toolbarEl = bar;

    const tail = bar.createDiv({ cls: "epq-gantt-group epq-gantt-tail" });
    this.legendBtn = tail.createEl("button", { text: "Legend" });
    this.legendBtn.addEventListener("click", async () => {
      const show = !this.plugin.state.legend;
      await this.plugin.setLegend(show);
      this.plugin.applyLegendEverywhere();
    });
    tail.createEl("button", { text: "Print", attr: { title: "Print the whole chart (or save it as a PDF)" } }).addEventListener("click", () => this.print());
    this.exportBtn = tail.createEl("button", { text: "Export", attr: { title: "Export as PNG, SVG or CSV" } });
    this.exportBtn.addEventListener("click", () => this.openExport());
    this.fullBtn = tail.createEl("button", { text: "Full screen" });
    this.fullBtn.addEventListener("click", () => this.toggleFullscreen());
    const reset = tail.createEl("button", { text: "Reset" });
    reset.addEventListener("click", () => this.render());
    this.syncButtons();
  }

  syncButtons() {
    for (const kind of ["scale", "mode"]) {
      for (const [value, btn] of Object.entries(this.buttons[kind])) {
        btn.toggleClass("is-active", this.state[kind] === value);
      }
    }
    this.legendBtn?.toggleClass("is-active", !!this.plugin.state.legend);
    this.syncTableButton();
  }

  syncTableButton() {
    this.tableBtn?.toggleClass("is-active", !!this.showTable);
  }

  buildLegend(block, opts) {
    const legend = block.createDiv({ cls: "epq-gantt-legend" });
    const item = (parent, swatchCls, text, style) => {
      const it = parent.createSpan({ cls: "epq-gantt-legend-item" });
      const sw = it.createEl("i", { cls: swatchCls });
      if (style) sw.setAttr("style", style);
      it.createSpan({ text });
    };

    const bars = legend.createDiv({ cls: "epq-gantt-legend-group" });
    bars.createSpan({ cls: "epq-gantt-legend-title", text: "Bars" });
    item(bars, "sw sw-plan", "Planned");
    item(bars, "sw sw-actual", "Actual (striped, over planned)");
    if (opts.progress) item(bars, "sw sw-progress", "Progress (started, no end - to today)");
    item(bars, "sw sw-today", "Today");

    const text = legend.createDiv({ cls: "epq-gantt-legend-group" });
    text.createSpan({ cls: "epq-gantt-legend-title", text: "Task text" });
    item(text, "dot", "Not started", "background:var(--tsg-not-started-fg-color)");
    item(text, "dot", "In progress", "background:var(--tsg-in-progress-fg-color)");
    item(text, "dot", "Overdue", "background:var(--tsg-overdue-fg-color)");
    item(text, "dot", "Completed", "background:var(--tsg-completed-fg-color)");
    item(text, "dot", "Completed late", "background:var(--tsg-completed-late-fg-color)");

    const note = legend.createDiv({ cls: "epq-gantt-legend-note" });
    note.createSpan({ text: "A one-date actual, " });
    note.createEl("code", { text: "fact: [date]" });
    note.createSpan({ text: ", shows as a progress bar from that date to today." });
    return legend;
  }
}

export default class EpqGanttPlugin extends Plugin {
  async onload() {
    const saved = (await this.loadData()) ?? {};
    this.state = { legend: true, table: true, layout: null, ...saved, output: { ...DEFAULT_OUTPUT, ...saved.output } };
    this.blocks = new Set(); // live charts, so a layout change shows up in every open chart

    const processor = (source, el, ctx) => ctx.addChild(new GanttBlock(el, source, this, ctx));
    this.registerMarkdownCodeBlockProcessor("epq-gantt", processor);
    try {
      // Plain ```gantt blocks. If another plugin already owns "gantt", use ```epq-gantt instead.
      this.registerMarkdownCodeBlockProcessor("gantt", processor);
    } catch (e) {
      console.warn('Gantt: could not claim the "gantt" block; use ```epq-gantt', e);
    }
  }

  async setLegend(show) {
    this.state.legend = show;
    await this.saveData(this.state);
  }

  // A chart changed its table layout: remember it, and update the other open charts.
  async persistView(source) {
    if (source.pinnedLayout && source.pinnedTable) return;
    if (!source.pinnedLayout) this.state.layout = mergeSaved(source.layout, this.state.layout);
    if (!source.pinnedTable) this.state.table = source.showTable;
    await this.saveData(this.state);
    for (const b of this.blocks) if (b !== source) b.adoptSavedView();
  }

  async setOutput(patch) {
    this.state.output = { ...this.state.output, ...patch };
    await this.saveData(this.state);
    for (const b of this.blocks) b.refreshPrintPages();
  }

  applyLegendEverywhere() {
    document.querySelectorAll(".epq-gantt-legend").forEach((el) => {
      el.classList.toggle("is-hidden", !this.state.legend);
    });
    document.querySelectorAll(".epq-gantt-toolbar .epq-gantt-tail button:first-child").forEach((b) => {
      b.classList.toggle("is-active", !!this.state.legend);
    });
  }
}
