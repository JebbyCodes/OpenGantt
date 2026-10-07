// Pure time-axis and bar geometry. No DOM, so it can be tested in Node.
// One function (axis.x) maps a date to a pixel position; planned bars, actual bars, progress bars
// and the today line ALL go through it, so they can never disagree.

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
export function makeAxis(tasks, today, scale = "day", padding = 7, ppdOverride) {
  const dates = [today];
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
export function barsFor(t, axis, mode, opts, today) {
  const out = [];
  const span = (a, b) => ({ x: axis.x(a), w: Math.max(MIN_W, ((+b - +a) / DAY + 1) * axis.ppd) });
  if (t.datePlannedStart && mode !== "actual") {
    out.push({ kind: "plan", ...span(t.datePlannedStart, t.datePlannedEnd ?? t.datePlannedStart) });
  }
  if (t.dateActualStart && mode !== "planned") {
    const open = t.factOpen;
    const end = open ? (today > t.dateActualStart ? today : t.dateActualStart) : t.dateActualEnd ?? t.dateActualStart;
    out.push({ kind: open && opts.progress ? "progress" : "actual", ...span(t.dateActualStart, end) });
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
      const bar = { row, id: t.id, kind: b.kind, x: b.x, y: barTop + inset, w: b.w, h: barH - inset * 2, rx: Math.min(5, barH / 2) };
      if (b.kind === "progress" && b.w >= 44 && t.progress) bar.label = { x: b.x + b.w / 2, y: rowH / 2, text: `${t.progress}%` };
      out.push(bar);
    }
  });
  return out;
}
