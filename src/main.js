import { Plugin, MarkdownRenderChild, Menu, Notice, Platform, normalizePath, parseYaml } from "obsidian";
import "./styles.css";
import { buildTasks, readBlockOptions, todayUtc, visibleTasks, parentIds, planSegsOf, factSegsOf, normalizeYaml } from "./model.js";
import { filterTasks, sortTasks, allTags } from "./arrange.js";
import { nameColors } from "./tree-colors.js";
import { tagColor, TAG_ICON_D } from "./timeline.js";
import { THEMES, DEFAULT_THEME, themeList, getTheme, schemeOf, customCssTemplate, installThemeStyles } from "./themes.js";
import { h, svgNode } from "./dom.js";
import { openDialog } from "./dialog.js";
import { renderHelp, renderAbout, renderCredits } from "./help.js";
import { createVisualEditor, pathFromId } from "./visual.js";
import { createCodeEditor } from "./codeeditor.js";
import { drawChart } from "./chart.js";
import { buildColumns, matchColumn, resolveLayout, mergeSaved, visibleColumns, moveStep, moveToVisibleSlot, humanize, sortValue } from "./columns.js";
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
    // One line per range; a task with several ranges numbers them ("Planned 1", "Planned 2", ...).
    const ranges = (name, segs, cls) => {
      segs.forEach((seg, i) => row(segs.length > 1 ? `${name} ${i + 1}` : name, rangeText(seg.start, seg.end, today), cls));
    };
    ranges("Planned", planSegsOf(task), "is-plan");
    ranges("Actual", factSegsOf(task), "is-actual");
    if (task.planDerived || task.factDerived) row("Dates", "from subtasks", "");
    const open = factSegsOf(task).find((seg) => seg.open);
    if (open) row("Progress", `${fmtDate(open.start)} – today (${dayCount(open.start, today)} days), ${task.progress}% of plan`, "is-actual");
    else if (task.dateActualStart || task.progressSet != null) row("Progress", `${task.progress}%`, "");
    for (const [key, value] of Object.entries(task.extra ?? {})) row(humanize(key), value, "");
    if (task.tags?.length) {
      const wrap = tip.createDiv({ cls: "epq-gantt-tip-tags" });
      const scheme = schemeOf(this.blockEl, this.plugin.state.theme);
      for (const tag of task.tags) {
        const chip = h("span", { class: "epq-gantt-tip-tag", title: `Tag: ${tag}` }, svgNode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="${TAG_ICON_D}" fill="${tagColor(tag, scheme)}"/></svg>`), tag);
        wrap.append(chip);
      }
    }
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

  // ---- Arranging: filter and sort -------------------------------------------------------------------------------
  scheme() {
    return schemeOf(this.blockEl, this.plugin.state.theme);
  }

  colorSeed() {
    return this.opts?.title ?? "";
  }

  sortValueOf(t, id) {
    if (id === "name") return t.name;
    const col = this.available.find((c) => c.id === id);
    return col ? sortValue(col, t, { today: this.today }) : null;
  }

  // The tasks as shown: filtered, then sorted within their parents. `this.tasks` stays in YAML order.
  arranged() {
    let list = filterTasks(this.tasks, this.filter);
    if (this.sort) list = sortTasks(list, this.sort, (t) => this.sortValueOf(t, this.sort.id));
    return list;
  }

  // Click on a heading: ascending, then descending, then back to the original order.
  cycleSort(id) {
    if (this.sort?.id !== id) this.sort = { id, dir: "asc" };
    else if (this.sort.dir === "asc") this.sort = { id, dir: "desc" };
    else this.sort = null;
    this.userSort = this.sort;
    this.syncSortButton();
    this.draw();
    this.refreshSortPanel?.();
  }

  setSort(sort) {
    this.sort = sort;
    this.userSort = sort;
    this.syncSortButton();
    this.draw();
    this.refreshSortPanel?.();
  }

  syncSortButton() {
    this.sortBtn?.toggleClass("is-active", !!this.sort);
    this.sortBtn?.setText(this.sort ? `Sort ${this.sort.dir === "desc" ? "\u25BC" : "\u25B2"}` : "Sort");
  }

  setWidth(id, px, final) {
    this.widths = { ...this.widths, [id]: px };
    this.draw();
    if (final) this.plugin.persistWidths(this);
  }

  resetWidth(id) {
    const { [id]: _drop, ...rest } = this.widths;
    this.widths = rest;
    this.draw();
    this.plugin.persistWidths(this);
  }

  // (Re)draws the chart. Scroll position is kept unless `scrollToToday` is set.
  draw(scrollToToday = false) {
    if (!this.hostEl || this.dead) return;
    try {
      this.visible = visibleTasks(this.arranged(), this.collapsed);
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
        measure: this.measurer(),
        widths: this.widths,
        sort: this.sort,
        scheme: this.scheme(),
        nameColors: nameColors(this.tasks, { scheme: this.scheme(), seed: this.colorSeed() }),
        onToggle: (id) => this.toggleTask(id),
        onReorder: (id, slot) => this.reorderVisible(id, slot),
        onHeaderMenu: (e, col) => this.headerMenu(e, col),
        onHeaderClick: (id) => this.cycleSort(id),
        onResize: (id, px, final) => this.setWidth(id, px, final),
        onResetWidth: (id) => this.resetWidth(id),
        onActivate: (id) => this.plugin.activateTask(this, id),
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
      doc = parseYaml(normalizeYaml(this.source));
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
    this.filter = this.filter ?? { text: "", tag: "" }; // kept when a chart is redrawn after an edit
    this.widths = { ...(this.plugin.state.widths ?? {}) };

    // Table columns: this block's own `columns:` / `table:` win; otherwise the layout saved for all charts.
    this.opts = opts;
    this.available = buildColumns(tasks, opts.columns ?? []);
    this.pinnedLayout = opts.columns != null;
    this.pinnedTable = opts.table != null;
    this.layout = this.startLayout();
    this.showTable = opts.table ?? this.plugin.state.table !== false;
    // Sorting: this chart's own `sort:`, unless the reader has since chosen another order.
    const sortId = opts.sort ? (opts.sort.key.toLowerCase() === "name" ? "name" : matchColumn(this.available, opts.sort.key)) : null;
    this.sort = this.userSort !== undefined ? this.userSort : sortId ? { id: sortId, dir: opts.sort.dir } : null;

    this.closePopover();
    this.disposePrintFrame();
    this.printEl = null;
    this.containerEl.empty();
    const block = this.containerEl.createDiv({ cls: "epq-gantt-block" });
    block.dataset.ogTheme = this.plugin.state.theme;
    this.blockEl = block;
    this.tasks = tasks;
    this.buildToolbar(block, parentIds(tasks).length > 0);
    const legend = this.buildLegend(block, opts);
    legend.toggleClass("is-hidden", !this.plugin.state.legend);
    this.legendEl = legend;

    this.blockEl = block;
    this.wasFull = false;
    const host = block.createDiv({ cls: "epq-gantt-host" });
    host.id = this.id;
    host.style.height = `${this.height ?? opts.height}px`;
    this.hostEl = host;
    this.addResizer(block, host);
    this.opts = opts;
    this.tasks = tasks;
    this.visible = visibleTasks(tasks, this.collapsed);
    this.info = new Map(tasks.map((t) => [t.id, t]));
    this.setupTooltip();
    this.draw(true);
  }

  // Drag the bar along the bottom edge to make the chart taller or shorter (remembered until the chart is redrawn from
  // its YAML).
  addResizer(block, host) {
    const bar = block.createDiv({ cls: "epq-gantt-resizer", attr: { title: "Drag to resize the chart" } });
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || block.classList.contains("is-expanded") || block.ownerDocument.fullscreenElement === block) return;
      e.preventDefault();
      const doc = block.ownerDocument;
      const y0 = e.clientY;
      const h0 = host.offsetHeight;
      bar.addClass("is-dragging");
      const move = (ev) => {
        this.height = Math.max(160, Math.round(h0 + ev.clientY - y0));
        host.style.height = `${this.height}px`;
      };
      const up = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        doc.removeEventListener("pointercancel", up);
        bar.removeClass("is-dragging");
        this.draw();
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", up);
    });
    bar.addEventListener("dblclick", () => { this.height = undefined; host.style.height = `${this.opts.height}px`; this.draw(); });
  }

  // The theme or custom CSS changed.
  applyTheme() {
    if (!this.blockEl || this.dead) return;
    this.blockEl.dataset.ogTheme = this.plugin.state.theme;
    this.draw();
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
    this.widths = { ...(this.plugin.state.widths ?? {}) };
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
    menu.addItem((it) => it.setTitle("Sort ascending").setIcon("arrow-up").onClick(() => this.setSort({ id: col.id, dir: "asc" })));
    menu.addItem((it) => it.setTitle("Sort descending").setIcon("arrow-down").onClick(() => this.setSort({ id: col.id, dir: "desc" })));
    menu.addItem((it) => it.setTitle("Fit width to text").setIcon("move-horizontal").onClick(() => this.resetWidth(col.id)));
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
    tools.createEl("button", { text: "Fit widths", attr: { title: "Forget dragged column widths; every column fits its text again" } }).addEventListener("click", () => {
      this.widths = {};
      this.draw();
      this.plugin.persistWidths(this);
    });
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

  // ---- Sort, theme and help --------------------------------------------------------------------------------------------
  openSort() {
    this.openPopover(this.sortBtn, "is-sort", (pop) => this.buildSortPanel(pop));
  }

  buildSortPanel(pop) {
    pop.createDiv({ cls: "epq-pop-head" }).createSpan({ cls: "epq-pop-title", text: "Sort rows" });
    const row = pop.createDiv({ cls: "epq-pop-row" });
    row.createSpan({ text: "By" });
    const pick = row.createEl("select", { attr: { "aria-label": "Sort by" } });
    pick.createEl("option", { value: "", text: "Original order" });
    pick.createEl("option", { value: "name", text: "Name" });
    for (const c of this.available) pick.createEl("option", { value: c.id, text: c.label });
    const dirRow = pop.createDiv({ cls: "epq-pop-row" });
    dirRow.createSpan({ text: "Order" });
    const seg = dirRow.createDiv({ cls: "epq-seg" });
    const asc = seg.createEl("button", { text: "Ascending" });
    const desc = seg.createEl("button", { text: "Descending" });
    const sync = () => {
      pick.value = this.sort?.id ?? "";
      asc.toggleClass("is-active", !this.sort || this.sort.dir === "asc");
      desc.toggleClass("is-active", this.sort?.dir === "desc");
      asc.disabled = desc.disabled = !this.sort;
    };
    this.refreshSortPanel = sync;
    sync();
    pick.addEventListener("change", () => this.setSort(pick.value ? { id: pick.value, dir: this.sort?.dir ?? "asc" } : null));
    asc.addEventListener("click", () => this.sort && this.setSort({ ...this.sort, dir: "asc" }));
    desc.addEventListener("click", () => this.sort && this.setSort({ ...this.sort, dir: "desc" }));
    pop.createDiv({ cls: "epq-pop-note", text: "Subtasks stay under their parent; only tasks with the same parent change places. Rows with nothing in that column go last. You can also click a column heading: once for ascending, again for descending, a third time to clear." });
  }

  openTheme() {
    this.openPopover(this.themeBtn, "is-theme", (pop) => this.buildThemePanel(pop));
  }

  buildThemePanel(pop) {
    this.plugin.buildThemePanel(pop, (blob, name) => this.deliver(blob, name));
  }

  openHelp(start = "help") {
    this.plugin.openHelp(start);
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
      widths: this.widths,
      allTasks: this.tasks,
      colorSeed: this.colorSeed(),
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

    const arrange = bar.createDiv({ cls: "epq-gantt-group" });
    this.sortBtn = arrange.createEl("button", { text: "Sort", attr: { title: "Sort the rows (or click a column heading)" } });
    this.sortBtn.addEventListener("click", () => this.openSort());

    const filter = bar.createDiv({ cls: "epq-gantt-filter" });
    const box = filter.createEl("input", { type: "search", placeholder: "Filter tasks", attr: { "aria-label": "Filter tasks by name, notes or tag" } });
    box.value = this.filter?.text ?? "";
    box.addEventListener("input", () => { this.filter = { ...this.filter, text: box.value }; this.draw(); });
    const tagList = allTags(this.tasks ?? []);
    if (tagList.length) {
      const pick = filter.createEl("select", { attr: { "aria-label": "Filter by tag" } });
      pick.createEl("option", { value: "", text: "All tags" });
      for (const t of tagList) pick.createEl("option", { value: t, text: `# ${t}` });
      pick.value = this.filter?.tag ?? "";
      pick.addEventListener("change", () => { this.filter = { ...this.filter, tag: pick.value }; this.draw(); });
    }

    const tail = bar.createDiv({ cls: "epq-gantt-group epq-gantt-tail" });
    tail.createEl("button", { text: "Today", attr: { title: "Scroll to today" } }).addEventListener("click", () => this.draw(true));
    const edit = tail.createEl("button", { text: "Edit", cls: "is-primary", attr: { title: "Edit this chart with forms or YAML" } });
    edit.addEventListener("click", () => this.plugin.activateTask(this, null));
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
    this.themeBtn = tail.createEl("button", { text: "Theme", attr: { title: "Colour theme and custom CSS" } });
    this.themeBtn.addEventListener("click", () => this.openTheme());
    tail.createEl("button", { text: "Help", attr: { title: "Help, about and credits" } }).addEventListener("click", () => this.openHelp());
    const reset = tail.createEl("button", { text: "Reset", attr: { title: "Back to the chart as the YAML describes it" } });
    reset.addEventListener("click", () => {
      this.userSort = undefined;
      this.filter = { text: "", tag: "" };
      this.height = undefined;
      this.render();
    });
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
    this.syncSortButton();
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
    if (opts.markers?.length) item(bars, "sw sw-marker", "Marker (deadline, holiday...)");

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
    this.state = { legend: true, table: true, layout: null, widths: {}, theme: DEFAULT_THEME, customCss: "", ...saved, output: { ...DEFAULT_OUTPUT, ...saved.output } };
    if (!THEMES.some((t) => t.id === this.state.theme) || (this.standalone && getTheme(this.state.theme).obsidianOnly)) this.state.theme = DEFAULT_THEME;
    this.blocks = new Set(); // live charts, so a layout change shows up in every open chart
    installThemeStyles(document, this.state.customCss);

    const processor = (source, el, ctx) => ctx.addChild(new GanttBlock(el, source, this, ctx));
    this.registerMarkdownCodeBlockProcessor("epq-gantt", processor);
    try {
      // Plain ```gantt blocks. If another plugin already owns "gantt", use ```epq-gantt instead.
      this.registerMarkdownCodeBlockProcessor("gantt", processor);
    } catch (e) {
      console.warn('Gantt: could not claim the "gantt" block; use ```epq-gantt', e);
    }
  }

  // The version, from manifest.json (Obsidian) or package.json (the standalone build), which are kept in sync.
  get version() {
    return this.manifest?.version ?? globalThis.__GANTT_VERSION__ ?? "";
  }

  get standalone() {
    return !!globalThis.__GANTT_STANDALONE__;
  }

  async setTheme(id) {
    this.state.theme = id;
    await this.saveData(this.state);
    this.applyThemeEverywhere();
  }

  async setCustomCss(css) {
    this.state.customCss = css;
    await this.saveData(this.state);
    installThemeStyles(document, css);
    this.applyThemeEverywhere();
  }

  applyThemeEverywhere() {
    this.onThemeChange?.(this.state.theme); // the standalone app themes its own page too
    for (const b of this.blocks) b.applyTheme();
  }

  // Column widths are shared by every chart, like the column layout.
  async persistWidths(source) {
    this.state.widths = { ...source.widths };
    await this.saveData(this.state);
    for (const b of this.blocks) if (b !== source) b.adoptSavedView();
  }

  // Double-click on a task name, or the Edit button (id = null). The standalone app replaces this to switch its editor
  // pane; in Obsidian it opens the editor in a dialog.
  activateTask(block, id) {
    if (this.onTaskActivate) return this.onTaskActivate(block, id);
    this.openEditorDialog(block, id);
  }

  openEditorDialog(block, id) {
    let work = block.source;
    const parse = (t) => parseYaml(normalizeYaml(t));
    const yaml = createCodeEditor({
      value: work,
      onInput: (t) => {
        work = t;
        try { parse(t); yaml.setError(0); } catch (e) { yaml.setError((e.mark?.line ?? -1) + 1); }
      },
    });
    const visual = createVisualEditor({ parse, setText: (t) => { work = t; yaml.setValue(t); } });
    const save = h("button", { class: "epq-vis-btn is-primary", text: "Save to note", onclick: async () => { if (await this.writeBack(block, work)) dlg.close(); } });
    const copy = h("button", { class: "epq-vis-btn", text: "Copy YAML", onclick: async () => { try { await navigator.clipboard.writeText(work); new Notice("Copied the YAML."); } catch { new Notice("Couldn't copy."); } } });
    const cancel = h("button", { class: "epq-vis-btn", text: "Cancel", onclick: () => dlg.close() });
    const dlg = openDialog({
      title: "Edit chart", wide: true, themeId: this.state.theme, start: "visual", footer: [copy, cancel, save],
      tabs: [
        { id: "visual", label: "Visual", render: (el) => { el.append(visual.el); visual.load(work); if (id) visual.select(pathFromId(id)); } },
        { id: "yaml", label: "YAML", render: (el) => { el.append(yaml.el); yaml.setValue(work); yaml.focus(); } },
      ],
    });
  }

  // Puts new YAML back into the ```gantt block it came from, leaving the rest of the note alone.
  async writeBack(block, newSource) {
    const body = String(newSource).replace(/\s+$/, "");
    try {
      const info = block.ctx?.getSectionInfo?.(block.containerEl);
      const file = this.app.vault.getAbstractFileByPath(block.ctx?.sourcePath ?? "");
      if (!info || !file) throw new Error("this block's place in the note could not be found (try the reading view)");
      let ok = true;
      await this.app.vault.process(file, (data) => {
        const eol = data.includes("\r\n") ? "\r\n" : "\n";
        const lines = data.split(eol);
        const first = lines[info.lineStart] ?? "";
        const current = lines.slice(info.lineStart + 1, info.lineEnd).join(eol).trim();
        if (!/^\s*(```|~~~)/.test(first) || current !== String(block.source).trim()) { ok = false; return data; } // the note changed under us
        lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...body.split("\n"));
        return lines.join(eol);
      });
      if (!ok) throw new Error("the note changed since this chart was drawn; close this and open Edit again");
      new Notice("Gantt: chart saved to the note.");
      return true;
    } catch (e) {
      console.error(e);
      try { await navigator.clipboard.writeText(body); } catch { /* clipboard unavailable */ }
      new Notice(`Gantt: couldn't save into the note (${e.message}). The new YAML is on your clipboard.`, 8000);
      return false;
    }
  }

  // The theme picker and custom-CSS box. `deliver(blob, name)` saves a downloaded file (the CSS template).
  buildThemePanel(pop, deliver) {
    const plugin = this;
    pop.createDiv({ cls: "epq-pop-head" }).createSpan({ cls: "epq-pop-title", text: "Theme" });
    const list = pop.createDiv({ cls: "epq-theme-list" });
    const paint = () => {
      list.empty();
      for (const t of themeList({ obsidian: !plugin.standalone })) {
        const item = list.createEl("button", { cls: `epq-theme-item${plugin.state.theme === t.id ? " is-active" : ""}`, attr: { "aria-pressed": String(plugin.state.theme === t.id) } });
        const sw = item.createSpan({ cls: "epq-theme-sw" });
        for (const c of [t.vars["--og-bg"], t.vars["--og-accent"], t.vars["--tsg-chart-bar-color-1"], t.vars["--tsg-chart-bar-color-2"]]) sw.createEl("i").setAttr("style", `background:${c}`);
        item.createSpan({ text: t.name });
        item.addEventListener("click", async () => { await plugin.setTheme(t.id); paint(); });
      }
    };
    paint();

    pop.createDiv({ cls: "epq-pop-sub", text: "Custom CSS" });
    const acts = pop.createDiv({ cls: "epq-pop-actions" });
    const file = h("input", { type: "file", accept: ".css,text/css", hidden: true });
    pop.append(file);
    const area = h("textarea", { class: "epq-css-area", rows: 7, spellcheck: "false", placeholder: "/* Paste CSS here, or upload a .css file */", "aria-label": "Custom CSS" });
    area.value = plugin.state.customCss ?? "";
    const status = h("div", { class: "epq-pop-note" });
    const showStatus = () => { status.textContent = (plugin.state.customCss ?? "").trim() ? `Custom CSS is on (${plugin.state.customCss.split("\n").length} lines). It is applied after the theme.` : "No custom CSS. Download the template to see every variable you can change."; };
    showStatus();
    acts.createEl("button", { text: "Upload .css\u2026" }).addEventListener("click", () => file.click());
    acts.createEl("button", { text: "Template" }).addEventListener("click", () => deliver(new Blob([customCssTemplate()], { type: "text/css" }), "OpenGantt-theme.css"));
    acts.createEl("button", { text: "Clear" }).addEventListener("click", async () => { area.value = ""; await plugin.setCustomCss(""); showStatus(); });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      area.value = await f.text();
      await plugin.setCustomCss(area.value);
      showStatus();
      file.value = "";
    });
    let timer = 0;
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => { await plugin.setCustomCss(area.value); showStatus(); }, 300);
    });
    pop.append(area, status);
  }

  openHelp(start = "help") {
    const standalone = this.standalone;
    openDialog({
      title: "OpenGantt", start, wide: true, themeId: this.state.theme,
      tabs: [
        { id: "help", label: "Help", render: (el) => renderHelp(el, { standalone }) },
        { id: "about", label: "About", render: (el) => renderAbout(el, { version: this.version, standalone }) },
        { id: "credits", label: "Credits", render: (el) => renderCredits(el) },
      ],
    });
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
