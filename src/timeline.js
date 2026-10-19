// Pure time-axis and bar geometry. No DOM, so it can be tested in Node.
// One function (axis.x) maps a date to a pixel position; planned bars, actual bars, progress bars
// and the today line ALL go through it, so they can never disagree.

import { planSegsOf, factSegsOf } from "./model.js";

export const DAY = 86400000;
export const PPD = { day: 28, week: 9, month: 3, year: 0.9 }; // pixels per day for each scale

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (d, n) => new Date(+d + n * DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function startOfUnit(d, scale) {
  if (scale === "week") return addDays(d, -((d.getUTCDay() + 6) % 7)); // Monday
  if (scale === "month") return utc(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (scale === "year") return utc(d.getUTCFullYear(), 0, 1);
  return d;
}

export function nextUnit(d, scale) {
  if (scale === "week") return addDays(d, 7);
  if (scale === "month") return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (scale === "year") return utc(d.getUTCFullYear() + 1, 0, 1);
  return addDays(d, 1);
}

// `ppdOverride` replaces the scale's pixels-per-day (print fits a long chart onto one page width).
// `extra` is a list of dates the axis must also cover (marker dates).
export function makeAxis(tasks, today, scale = "day", padding = 7, ppdOverride, extra = []) {
  const dates = [today, ...extra.filter(Boolean)];
  for (const t of tasks) {
    for (const d of [t.datePlannedStart, t.datePlannedEnd, t.dateActualStart, t.dateActualEnd]) if (d) dates.push(d);
  }
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  const start = startOfUnit(addDays(min, -padding), scale);
  const end = nextUnit(startOfUnit(addDays(max, padding), scale), scale); // exclusive
  const ppd = ppdOverride > 0 ? ppdOverride : PPD[scale] ?? PPD.day;
  const x = (d) => ((+d - +start) / DAY) * ppd;

  const bottom = [];
  for (let u = start; u < end; u = nextUnit(u, scale)) {
    const n = nextUnit(u, scale);
    let label;
    if (scale === "day") label = String(u.getUTCDate());
    else if (scale === "week") label = `${u.getUTCDate()} ${MONTHS[u.getUTCMonth()]}`;
    else if (scale === "month") label = MONTHS[u.getUTCMonth()];
    else label = String(u.getUTCFullYear());
    // Shorter labels to fall back on when a cell is too narrow (used by print, which squeezes the axis).
    const alts = scale === "week" ? [String(u.getUTCDate())] : scale === "month" ? [MONTHS[u.getUTCMonth()][0]] : [];
    bottom.push({ from: x(u), to: x(n), label, alts, date: u });
  }

  const top = [];
  if (scale === "day" || scale === "week") {
    for (let u = utc(start.getUTCFullYear(), start.getUTCMonth(), 1); u < end; u = utc(u.getUTCFullYear(), u.getUTCMonth() + 1, 1)) {
      const n = utc(u.getUTCFullYear(), u.getUTCMonth() + 1, 1);
      const m = u.getUTCMonth();
      top.push({ from: Math.max(0, x(u)), to: Math.min(x(end), x(n)), label: `${MONTHS_LONG[m]} ${u.getUTCFullYear()}`, alts: [`${MONTHS[m]} ${u.getUTCFullYear()}`, MONTHS[m]] });
    }
  } else if (scale === "month") {
    for (let u = utc(start.getUTCFullYear(), 0, 1); u < end; u = utc(u.getUTCFullYear() + 1, 0, 1)) {
      const n = utc(u.getUTCFullYear() + 1, 0, 1);
      top.push({ from: Math.max(0, x(u)), to: Math.min(x(end), x(n)), label: String(u.getUTCFullYear()), alts: [`'${String(u.getUTCFullYear()).slice(2)}`] });
    }
  }
  return { start, end, scale, ppd, width: x(end), x, bottom, top, todayX: x(today) + ppd / 2 };
}

// ---- Markers, weekends and colours ----------------------------------------------------------

export const markerDates = (opts) => (opts?.markers ?? []).map((m) => m.date);

// Vertical marker lines: x is the middle of the marked day's column, the same convention as the today line.
export function markerShapes(axis, opts) {
  return (opts?.markers ?? []).map((m) => ({ x: axis.x(m.date) + axis.ppd / 2, label: m.label, date: m.date }));
}

// Shaded Saturday + Sunday blocks as [{ x, w }]. Only the day scale shows them (other scales are too coarse).
export function weekendSpans(axis, opts) {
  if (!opts?.weekends || axis.scale !== "day") return [];
  const out = [];
  for (let d = axis.start; d < axis.end; d = new Date(+d + DAY)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) continue;
    const x = axis.x(d);
    const last = out[out.length - 1];
    if (last && Math.abs(last.x + last.w - x) < 1e-6) last.w += axis.ppd;
    else out.push({ x, w: axis.ppd });
  }
  return out;
}

// The distinct custom task colours used by a list of bars, in first-seen order (each needs its own hatch pattern).
export const barColors = (bars) => [...new Set(bars.map((b) => b.color).filter(Boolean))];

// Which colour the task's name takes (matches the legend's "Task text").
export function taskStatus(t, today) {
  if (t.dateActualStart && !t.factOpen) {
    return t.datePlannedEnd && t.dateActualEnd > t.datePlannedEnd ? "late" : "done";
  }
  if (t.datePlannedEnd && today > t.datePlannedEnd) return "overdue";
  return t.dateActualStart ? "progress" : "idle";
}

const MIN_W = 5;

// Bars for one task: [{ kind: "plan" | "actual" | "progress", x, w }]. Inclusive end dates.
// A task with several planned or actual ranges gets one bar per range, all in the same row.
export function barsFor(t, axis, mode, opts, today) {
  const out = [];
  const span = (a, b) => ({ x: axis.x(a), w: Math.max(MIN_W, ((+b - +a) / DAY + 1) * axis.ppd) });
  if (mode !== "actual") {
    for (const s of planSegsOf(t)) out.push({ kind: "plan", ...span(s.start, s.end) });
  }
  if (mode !== "planned") {
    for (const s of factSegsOf(t)) {
      const end = s.open ? (today > s.start ? today : s.start) : s.end;
      out.push({ kind: s.open && opts.progress ? "progress" : "actual", ...span(s.start, end) });
    }
  }
  return out;
}

// ---- Shared geometry for the live chart and the print/export renderer -----------------------
// Both draw from these lists, so a printed chart can never disagree with the on-screen one.

// Two-tier time header: lines and labels, in header-local coordinates.
// `pick(cell, isTop)` chooses the label for a cell (or null for none). The default keeps a cell's full label
// only if the cell is wide enough (70px top, 22px bottom), which is what the on-screen chart uses. Print passes
// its own picker that measures text and falls back to the shorter `alts` labels.
export function headerShapes(axis, headH, pick) {
  const choose = pick ?? ((c, isTop) => (c.to - c.from >= (isTop ? 70 : 22) ? c.label : null));
  const tier = headH / 2;
  const lines = [];
  const texts = [];
  for (const t of axis.top) {
    lines.push({ x1: t.to, x2: t.to, y1: 0, y2: tier });
    const label = choose(t, true);
    if (label) texts.push({ x: t.from + 8, y: tier / 2, text: label, anchor: "start", top: true });
  }
  lines.push({ x1: 0, x2: axis.width, y1: tier, y2: tier });
  for (const b of axis.bottom) {
    lines.push({ x1: b.to, x2: b.to, y1: tier, y2: headH });
    const label = choose(b, false);
    if (label) texts.push({ x: (b.from + b.to) / 2, y: tier + tier / 2, text: label, anchor: "middle", top: false });
  }
  return { lines, texts, tier };
}

// Every bar (plus the % label on progress bars) for a list of rows, in row-relative coordinates:
// `row` is the index into `tasks`, `y` is measured from the top of that row.
export function bodyBars(tasks, axis, mode, opts, today, { rowH, barTop }) {
  const barH = rowH - barTop * 2;
  const out = [];
  tasks.forEach((t, row) => {
    for (const b of barsFor(t, axis, mode, opts, today)) {
      const inset = b.kind === "progress" ? barH * 0.12 : 0;
      const bar = { row, id: t.id, kind: b.kind, color: t.color ?? null, x: b.x, y: barTop + inset, w: b.w, h: barH - inset * 2, rx: Math.min(5, barH / 2) };
      if (b.kind === "progress" && b.w >= 44 && t.progress) bar.label = { x: b.x + b.w / 2, y: rowH / 2, text: `${t.progress}%` };
      out.push(bar);
    }
  });
  return out;
}

// ---- Tag labels --------------------------------------------------------------------------------------------------------
// A small tag icon and the task's tags sit just beyond the end of its bars (or before the start when there is no room),
// quiet enough not to compete with the bars. The full list is in the tooltip.
export const TAG_ICON_D = "M1.5 1.5h4.6l4.4 4.4a1 1 0 0 1 0 1.4L7.3 10.5a1 1 0 0 1-1.4 0L1.5 6.1zM4.2 3.4a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z";
export const TAG_ICON_W = 13;

// A tag's own hue, the same everywhere for the same word.
export function tagHue(tag) {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) { h ^= tag.toLowerCase().charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % 360;
}
export const tagColor = (tag, scheme = "dark") => `hsl(${tagHue(tag)} ${scheme === "light" ? "55% 36%" : "60% 70%"})`;

// Returns Map(taskId -> { tags, text, x, textX }): x is where the icon goes, textX where the text starts.
export function tagLabels(tasks, bars, axis, measure = (t, px) => t.length * px * 0.56, px = 10) {
  const out = new Map();
  for (const t of tasks) {
    if (!t.tags?.length) continue;
    const mine = bars.filter((b) => b.id === t.id);
    if (!mine.length) continue;
    const start = Math.min(...mine.map((b) => b.x));
    const end = Math.max(...mine.map((b) => b.x + b.w));
    const shown = t.tags.slice(0, 3);
    const text = shown.join(" \u00b7 ") + (t.tags.length > shown.length ? ` +${t.tags.length - shown.length}` : "");
    const w = TAG_ICON_W + Math.ceil(measure(text, px, false));
    let x = null;
    if (end + 6 + w <= axis.width) x = end + 6; // after the bars
    else if (start - 6 - w >= 0) x = start - 6 - w; // no room there: before them
    if (x != null) out.set(t.id, { tags: t.tags, text, x, textX: x + TAG_ICON_W });
  }
  return out;
}
