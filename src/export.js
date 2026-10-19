// Static (non-interactive) renderings of the chart: one standalone SVG per printed page, one SVG/PNG for
// image export, and CSV. Pure string building with no DOM, so it runs under Node tests.
//
// The whole chart is laid out here (no scrolling, no viewport), using the same axis and bar geometry as the
// live chart (see timeline.js), so what you print is what you see.
import { makeAxis, headerShapes, bodyBars, taskStatus, markerDates, markerShapes, weekendSpans, barColors, tagLabels, tagColor, TAG_ICON_D, DAY } from "./timeline.js";
import { cellText, columnWidths } from "./columns.js";
import { nameColors } from "./tree-colors.js";

export const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const PAD = 8;

export const THEMES = {
  dark: {
    bg: "#1d2021", fg: "#fbf1c7", muted: "#d5c4a1", line: "#7c6f64", lineAlpha: 0.5, headBg: "#504945",
    plan: "#7fc4e8", actual: "#b8e04a", today: "#ff5544", accent: "#fabd2f",
    status: { idle: "#d5c4a1", progress: "#fabd2f", overdue: "#ff6b5a", done: "#b8e04a", late: "#ffa040" },
  },
  light: {
    bg: "#ffffff", fg: "#282828", muted: "#504945", line: "#a89984", lineAlpha: 0.65, headBg: "#ebdbb2",
    plan: "#5aa6d6", actual: "#5f8a0e", today: "#cc241d", accent: "#b57614",
    status: { idle: "#504945", progress: "#b57614", overdue: "#cc241d", done: "#5f7a0a", late: "#af3a03" },
  },
};

const n = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Strip characters XML cannot hold, then escape.
const esc = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Text width. The plugin passes a real canvas measurement; this rough estimate keeps Node tests simple.
export const estimate = (text, px, bold) => String(text).length * px * (bold ? 0.6 : 0.54);

// Longest prefix of `text` that fits `maxW`, with an ellipsis if cut.
export function fitText(text, maxW, px, bold, measure = estimate) {
  text = String(text);
  if (maxW <= 0) return "";
  if (measure(text, px, bold) <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid) + "\u2026", px, bold) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + "\u2026" : "\u2026";
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const longDate = (d) => `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

// ---- Layout ----------------------------------------------------------------------------------

// Works out every size once: row height, column widths, the axis and the bars.
// density "screen" matches the on-screen chart; "print" is more compact.
// fit = { width, minTimeline } squeezes the timeline so the whole chart is about `width` px wide.
export function layoutChart({ tasks, collapsed = new Set(), columns, scale, mode, opts, today, density = "screen", fit = null, measure = estimate, widths = {}, allTasks = null, colorSeed = "" }) {
  const print = density === "print";
  const rowH = print ? 30 : 40;
  const barTop = print ? 6 : 7;
  const headH = print ? 48 : 56;
  const px = print ? 12 : 13;
  const env = { today };

  // Same widths as on screen: fit the text, unless a column was dragged to a size.
  const W = columnWidths({ tasks, columns, measure, env, px, manual: widths, headPad: 22 });
  const nameW = W.name;
  let x = nameW;
  const cols = columns.map((col) => {
    const w = W.cols.get(col.id);
    const c = { col, x, w };
    x += w;
    return c;
  });
  const tableTotal = x; // name + detail columns

  let axis = makeAxis(tasks, today, scale, opts.padding, undefined, markerDates(opts));
  if (fit) {
    const span = (+axis.end - +axis.start) / DAY;
    const target = Math.max(fit.minTimeline ?? 360, fit.width - tableTotal);
    const ppd = Math.min(axis.ppd, target / span);
    if (ppd < axis.ppd - 1e-9) axis = makeAxis(tasks, today, scale, opts.padding, ppd, markerDates(opts));
  }
  const bars = bodyBars(tasks, axis, mode, opts, today, { rowH, barTop });
  const tags = opts.tagLabels === false ? new Map() : tagLabels(tasks, bars, axis, (t, size) => measure(t, size, false), px - 3);
  return { tasks, allTasks: allTasks ?? tasks, colorSeed, collapsed, cols, nameW, tableTotal, axis, bars, tags, rowH, headH, barTop, px, width: tableTotal + axis.width, scale, mode, opts, today, env, density };
}

// ---- Legend ----------------------------------------------------------------------------------

function legendItems(model) {
  const items = [
    { kind: "plan", text: "Planned" },
    { kind: "actual", text: "Actual (striped, over planned)" },
  ];
  if (model.opts.progress && model.tasks.some((t) => t.factOpen)) items.push({ kind: "progress", text: "Progress (started, no end \u2013 to today)" });
  items.push({ kind: "today", text: "Today" });
  if (model.opts.markers?.length) items.push({ kind: "marker", text: "Marker" });
  items.push(
    { kind: "dot", status: "idle", text: "Not started" },
    { kind: "dot", status: "progress", text: "In progress" },
    { kind: "dot", status: "overdue", text: "Overdue" },
    { kind: "dot", status: "done", text: "Completed" },
    { kind: "dot", status: "late", text: "Completed late" },
  );
  return items;
}

const SWATCH_W = { plan: 26, actual: 26, progress: 26, today: 2, marker: 2, dot: 9 };

// Flows the legend onto as many lines as needed for `width`.
export function legendLayout(model, width, measure = estimate) {
  const px = 11;
  const lineH = 18;
  const gap = 18;
  let x = 0;
  let y = 0;
  const placed = [];
  for (const it of legendItems(model)) {
    const w = SWATCH_W[it.kind] + 6 + Math.ceil(measure(it.text, px, false));
    if (x > 0 && x + w > width) { x = 0; y += lineH; }
    placed.push({ ...it, x, y, w });
    x += w + gap;
  }
  return { items: placed, h: y + lineH, px };
}

// ---- Pages -----------------------------------------------------------------------------------

const TITLE_H = 46;
const FOOTER_H = 18;

// Page content sizes in CSS px for the smaller of A4/Letter (h) and the larger (wMax), 10 mm margins.
const PAPER = {
  landscape: { h: 718, wMax: 1047, design: 1000 },
  portrait: { h: 980, wMax: 740, design: 720 },
};
export const printDesignWidth = (orientation) => (PAPER[orientation] ?? PAPER.landscape).design;

// Splits rows over pages so no row is cut and every page (header repeated) fits the paper.
// Rows are spread evenly, so the last page is never a stray row or two.
export function planPages(rowCount, { overhead, rowH, width, orientation }) {
  const paper = PAPER[orientation] ?? PAPER.landscape;
  const maxH = paper.h * Math.max(1, width / paper.wMax); // a wider chart is scaled down, so it may be taller
  const cap = Math.max(3, Math.floor((maxH - overhead) / rowH));
  const pages = Math.max(1, Math.ceil(rowCount / cap));
  const base = Math.floor(rowCount / pages);
  const extra = rowCount % pages; // the first `extra` pages take one more row
  const out = [];
  let at = 0;
  for (let p = 0; p < pages; p++) {
    const size = base + (p < extra ? 1 : 0);
    out.push([at, at + size]);
    at += size;
  }
  return out;
}

// ---- SVG -------------------------------------------------------------------------------------

// One SVG for rows [rowStart, rowEnd) of the model.
export function renderSvg(model, o = {}) {
  const T = THEMES[o.theme] ?? THEMES.light;
  const measure = o.measure ?? estimate;
  const { rowH, headH, px, axis, nameW, tableTotal, cols } = model;
  const tasks = model.tasks;
  const rowStart = o.rowStart ?? 0;
  const rowEnd = o.rowEnd ?? tasks.length;
  const uid = esc(o.uid ?? "g");
  const rows = Math.max(0, rowEnd - rowStart);
  const bodyH = rows * rowH;

  const W = model.width + PAD * 2;
  const hasTitle = !!(o.title || o.subtitle);
  const legend = o.legend ? legendLayout(model, W - PAD * 2, measure) : null;
  const footer = o.page && o.page.of > 1 ? FOOTER_H : 0;
  const y0 = PAD + (hasTitle ? TITLE_H : 0);
  const legendY = y0 + headH + bodyH + 12;
  const H = Math.ceil((legend ? legendY + legend.h : y0 + headH + bodyH) + footer + PAD);
  const tier = headH / 2;
  const tints = (model.opts.nameColors ?? "tree") === "tree" ? nameColors(model.allTasks, { scheme: o.theme === "light" ? "light" : "dark", seed: model.colorSeed }) : new Map();

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="${px}">`);
  const colors = barColors(model.bars);
  const hatchId = (c) => (c ? `${uid}-hatch-${colors.indexOf(c)}` : `${uid}-hatch`);
  const patterns = [null, ...colors].map((c) => `<pattern id="${hatchId(c)}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="3.5" height="8" fill="${esc(c ?? T.actual)}"/></pattern>`);
  out.push(`<defs>${patterns.join("")}</defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="${T.bg}"/>`);

  if (o.title) out.push(`<text x="${PAD}" y="${PAD + 16}" font-size="18" font-weight="700" fill="${T.fg}">${esc(fitText(o.title, W - PAD * 2, 18, true, measure))}</text>`);
  if (o.subtitle) out.push(`<text x="${PAD}" y="${PAD + 34}" font-size="11" fill="${T.muted}">${esc(fitText(o.subtitle, W - PAD * 2, 11, false, measure))}</text>`);

  out.push(`<g transform="translate(${PAD} ${y0})">`);

  // header band
  out.push(`<rect width="${n(model.width)}" height="${headH}" fill="${T.headBg}"/>`);
  const line = (x1, y1, x2, y2, extra = "") =>
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${T.line}"${extra}/>`;
  const dim = ` stroke-opacity="${T.lineAlpha}"`;

  out.push(`<text x="10" y="${headH / 2}" dy=".35em" font-weight="600" fill="${T.fg}">Name</text>`);
  for (const c of cols) {
    out.push(`<text x="${n(c.x + 10)}" y="${headH / 2}" dy=".35em" font-weight="600" fill="${T.fg}">${esc(fitText(c.col.label, c.w - 14, px, true, measure))}</text>`);
  }

  // timeline header; bottom-tier ticks are dropped when a unit is too narrow to read (a squeezed print)
  const unit = axis.bottom.length ? axis.bottom[0].to - axis.bottom[0].from : 0;
  const thin = unit < 6;
  const hfont = px - 1;
  const variant = (c, v) => (v === 0 ? c.label : c.alts?.[v - 1]);
  // Bottom tier: every cell shares one label style (or none) so the row never looks patchy.
  let bv = -1;
  for (let v = 0; v <= 2 && bv < 0; v++) {
    if (axis.bottom.length && axis.bottom.every((c) => { const t = variant(c, v); return t && measure(t, hfont, false) <= c.to - c.from - 3; })) bv = v;
  }
  // Top tier: cells differ in width (partial months at the ends), so each takes the longest label that fits.
  const hdr = headerShapes(axis, headH, (c, isTop) => {
    if (!isTop) return bv >= 0 ? variant(c, bv) : null;
    for (let v = 0; v <= 2; v++) {
      const t = variant(c, v);
      if (t && measure(t, hfont, true) <= c.to - c.from - 12) return t;
    }
    return null;
  });
  out.push(`<g transform="translate(${n(tableTotal)} 0)">`);
  for (const l of hdr.lines) {
    if (thin && l.x1 === l.x2 && l.y1 >= hdr.tier) continue;
    out.push(line(l.x1, l.y1, l.x2, l.y2));
  }
  for (const t of hdr.texts) {
    out.push(`<text x="${n(t.x)}" y="${n(t.y)}" dy=".35em"${t.anchor === "middle" ? ' text-anchor="middle"' : ""}${t.top ? ' font-weight="600"' : ""} fill="${T.fg}" font-size="${px - 1}">${esc(t.text)}</text>`);
  }
  out.push(`<path d="M${n(axis.todayX - 6)},${headH} L${n(axis.todayX + 6)},${headH} L${n(axis.todayX)},${headH - 9} Z" fill="${T.today}"/>`);
  out.push(`</g>`);

  // body
  out.push(`<g transform="translate(0 ${headH})">`);
  const grid = thin ? axis.top.map((t) => t.to) : axis.bottom.map((b) => b.to);
  out.push(`<g transform="translate(${n(tableTotal)} 0)">`);
  for (const w of weekendSpans(axis, model.opts)) out.push(`<rect x="${n(w.x)}" y="0" width="${n(w.w)}" height="${n(bodyH)}" fill="${T.fg}" fill-opacity="0.06"/>`);
  for (const gx of grid) out.push(line(gx, 0, gx, bodyH, dim));
  out.push(`</g>`);
  for (let i = 1; i <= rows; i++) out.push(line(0, i * rowH, model.width, i * rowH, dim));

  for (let r = rowStart; r < rowEnd; r++) {
    const t = tasks[r];
    const cy = (r - rowStart) * rowH + rowH / 2;
    const status = taskStatus(t, model.today);
    const ix = 10 + (t.depth ?? 0) * 18;
    const mode_ = model.opts.nameColors ?? "tree";
    const chevColor = mode_ === "status" ? T.status[status] : T.fg;
    if (t.hasChildren) out.push(`<text x="${ix}" y="${cy}" dy=".35em" fill="${chevColor}">${model.collapsed.has(t.id) ? "\u25B8" : "\u25BE"}</text>`);
    let tx = ix + 18;
    let nameFill = mode_ === "status" ? T.status[status] : T.fg;
    if (mode_ === "tree") {
      out.push(`<circle cx="${tx + 4}" cy="${cy}" r="4" fill="${T.status[status]}"/>`);
      tx += 14;
      nameFill = tints.get(t.id) ?? T.fg;
    }
    out.push(`<text x="${tx}" y="${cy}" dy=".35em" fill="${nameFill}">${esc(fitText(t.name, nameW - tx - 8, px, false, measure))}</text>`);
    for (const c of cols) {
      const colour = c.col.cls ? T.status[c.col.cls(t, model.env).replace("epq-st-", "")] ?? T.muted : T.muted;
      out.push(`<text x="${n(c.x + 10)}" y="${cy}" dy=".35em" fill="${colour}">${esc(fitText(cellText(c.col, t, model.env), c.w - 20, px, false, measure))}</text>`);
    }
  }

  // table column rules (over the full header + body height)
  out.push(line(nameW, -headH, nameW, bodyH));
  for (const c of cols) out.push(line(c.x + c.w, -headH, c.x + c.w, bodyH));
  out.push(line(0, 0, model.width, 0));

  // bars
  out.push(`<g transform="translate(${n(tableTotal)} 0)">`);
  const small = model.density === "print";
  for (const b of model.bars) {
    if (b.row < rowStart || b.row >= rowEnd) continue;
    const y = (b.row - rowStart) * rowH + b.y;
    const geo = `x="${n(b.x)}" y="${n(y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(b.rx)}"`;
    const col = b.color ? esc(b.color) : null;
    if (b.kind === "plan") out.push(`<rect ${geo} fill="${col ?? T.plan}"/>`);
    else if (b.kind === "actual") out.push(`<rect ${geo} fill="${model.opts.hatch ? `url(#${hatchId(b.color)})` : col ?? T.actual}" stroke="${col ?? T.actual}" stroke-width="1.5"/>`);
    else out.push(`<rect ${geo} fill="${col ?? T.actual}" fill-opacity="0.28" stroke="${col ?? T.actual}" stroke-width="${small ? 2 : 2.5}" stroke-dasharray="${small ? "5 3" : "7 4"}"/>`);
    if (b.label) out.push(`<text x="${n(b.label.x)}" y="${n((b.row - rowStart) * rowH + b.label.y)}" dy=".35em" text-anchor="middle" font-size="${px - 2}" font-weight="700" fill="${T.fg}">${esc(b.label.text)}</text>`);
  }
  for (const [id, lab] of model.tags) {
    const r = tasks.findIndex((t) => t.id === id);
    if (r < rowStart || r >= rowEnd) continue;
    const ty = (r - rowStart) * rowH + rowH / 2;
    out.push(`<g opacity=".72"><path transform="translate(${n(lab.x)} ${n(ty - 6)})" d="${TAG_ICON_D}" fill="${tagColor(lab.tags[0], o.theme === "light" ? "light" : "dark")}"/><text x="${n(lab.textX)}" y="${n(ty)}" dy=".35em" font-size="${px - 3}" fill="${T.muted}">${esc(lab.text)}</text></g>`);
  }
  for (const m of markerShapes(axis, model.opts)) {
    out.push(`<path d="M${n(m.x)},-11 L${n(m.x + 5)},-6 L${n(m.x)},-1 L${n(m.x - 5)},-6 Z" fill="${T.accent}"/>`);
    out.push(`<line x1="${n(m.x)}" y1="0" x2="${n(m.x)}" y2="${n(bodyH)}" stroke="${T.accent}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
    const label = m.label ? fitText(m.label, bodyH - 12, px - 2, true, measure) : "";
    if (label && bodyH > 24) out.push(`<text transform="translate(${n(m.x + 3)} 6) rotate(90)" font-size="${px - 2}" font-weight="600" fill="${T.accent}" stroke="${T.bg}" stroke-width="3" paint-order="stroke">${esc(label)}</text>`);
  }
  out.push(`<line x1="${n(axis.todayX)}" y1="${-9}" x2="${n(axis.todayX)}" y2="${n(bodyH)}" stroke="${T.today}" stroke-width="2"/>`);
  out.push(`</g>`);
  out.push(`</g>`); // body

  out.push(`</g>`); // chart origin

  if (legend) {
    out.push(`<g transform="translate(${PAD} ${n(legendY)})" font-size="${legend.px}" fill="${T.fg}">`);
    for (const it of legend.items) {
      const cy = it.y + 9;
      const sw = SWATCH_W[it.kind];
      let shape;
      if (it.kind === "plan") shape = `<rect x="${it.x}" y="${cy - 4}" width="${sw}" height="8" rx="3" fill="${T.plan}"/>`;
      else if (it.kind === "actual") shape = `<rect x="${it.x}" y="${cy - 4}" width="${sw}" height="8" rx="3" fill="url(#${uid}-hatch)" stroke="${T.actual}" stroke-width="1.2"/>`;
      else if (it.kind === "progress") shape = `<rect x="${it.x + 1}" y="${cy - 3}" width="${sw - 2}" height="6" rx="2" fill="${T.actual}" fill-opacity="0.28" stroke="${T.actual}" stroke-width="1.5" stroke-dasharray="4 2"/>`;
      else if (it.kind === "marker") shape = `<rect x="${it.x}" y="${cy - 6}" width="2" height="12" fill="${T.accent}"/>`;
      else if (it.kind === "today") shape = `<rect x="${it.x}" y="${cy - 6}" width="2" height="12" fill="${T.today}"/>`;
      else shape = `<circle cx="${it.x + 4.5}" cy="${cy}" r="4.5" fill="${T.status[it.status]}"/>`;
      out.push(shape);
      out.push(`<text x="${it.x + sw + 6}" y="${cy}" dy=".35em">${esc(it.text)}</text>`);
    }
    out.push(`</g>`);
  }

  if (footer) out.push(`<text x="${W - PAD}" y="${H - PAD}" text-anchor="end" font-size="10" fill="${T.muted}">Page ${o.page.n} of ${o.page.of}</text>`);
  out.push(`</svg>`);
  return { svg: out.join(""), width: W, height: H };
}

export function describeView(model) {
  const what = model.mode === "planned" ? "Planned" : model.mode === "actual" ? "Actual" : "Planned and actual";
  const scale = model.scale[0].toUpperCase() + model.scale.slice(1);
  return `${what} \u00B7 ${scale} scale \u00B7 ${longDate(model.today)}`;
}

// One standalone SVG for the whole chart (PNG and SVG export). Pass a model laid out with density "screen".
export function buildImageSvg(model, { theme = "light", uid = "img", title = "", legend = true, measure = estimate } = {}) {
  return renderSvg(model, { theme, uid, title, subtitle: title ? describeView(model) : "", legend, measure });
}

// SVG strings, one per printed page, for a model laid out with density "print" and `fit`.
export function buildPrintPages(model, { title = "", legend = true, orientation = "landscape", uid = "pg", measure = estimate } = {}) {
  const W = model.width + PAD * 2;
  const overhead = PAD * 2 + (title ? TITLE_H : 0) + model.headH + (legend ? 12 + legendLayout(model, W - PAD * 2, measure).h : 0) + FOOTER_H;
  const ranges = planPages(model.tasks.length, { overhead, rowH: model.rowH, width: W, orientation });
  return ranges.map(([a, b], i) =>
    renderSvg(model, {
      theme: "light", uid: `${uid}-${i}`, rowStart: a, rowEnd: b,
      title: i === 0 ? title : "", subtitle: i === 0 && title ? describeView(model) : "",
      legend, page: { n: i + 1, of: ranges.length }, measure,
    }).svg,
  );
}

// A standalone HTML document that prints those pages: landscape or portrait, one SVG per page, scaled down
// (never up) to the page width.
export function buildPrintHtml(pages, { title = "Gantt", orientation = "landscape" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:${orientation === "portrait" ? "portrait" : "landscape"};margin:10mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.page svg{display:block;max-width:100%;height:auto}
</style></head><body>${pages.map((p) => `<div class="page">${p}</div>`).join("")}</body></html>`;
}

// ---- CSV -------------------------------------------------------------------------------------

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Every task (collapsed or not) with its level, then the chosen columns as plain values: ISO dates, numbers.
export function buildCsv(tasks, columns, today) {
  const env = { today };
  const rows = [["Task", "Level", ...columns.map((c) => c.label)]];
  for (const t of tasks) {
    rows.push([t.name, (t.depth ?? 0) + 1, ...columns.map((c) => (c.raw ? c.raw(t, env) : cellText(c, t, env)))]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function exportFileName(title, ext, today) {
  const base = String(title || "Gantt").replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-").replace(/\s+/g, " ").trim() || "Gantt";
  return `${base} gantt ${today.toISOString().slice(0, 10)}.${ext}`;
}
