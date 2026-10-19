// Task-name colours: every top-level task gets its own colour, and each subtask drifts gradually away from its
// parent's, so a branch of the tree reads as one family. Colours are generated, not typed, and are the same
// every time for the same chart (they are seeded from the chart, not from Math.random).
//
// They are chosen to stay readable: lightness is held in a band that suits the theme (bright on dark
// backgrounds, deep on light ones) and saturation is kept moderate, so no hue can come out too dark, too
// pale or neon. A task with its own `color:` starts a new family from that colour.

// 32-bit FNV-1a: small, fast and well spread for short strings.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const GOLDEN_ANGLE = 137.508; // consecutive top-level tasks land far apart on the colour wheel
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (h) => ((h % 360) + 360) % 360;

// Lightness / saturation bands per scheme, as [base, step per depth, limit].
const BANDS = {
  dark: { l: [70, -3, 58], s: [74, -2, 58] },
  light: { l: [33, 2, 44], s: [66, -2, 50] },
};

function band([base, step, limit], depth) {
  const v = base + step * depth;
  return step < 0 ? Math.max(limit, v) : Math.min(limit, v);
}

// "#rgb" / "#rrggbb" -> { h, s, l } (0-360, 0-100, 0-100), or null for anything else.
export function hexToHsl(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: wrap(hue), s: s * 100, l: l * 100 };
}

const css = (h, s, l) => `hsl(${Math.round(wrap(h))} ${Math.round(s)}% ${Math.round(l)}%)`;

// tasks: the flat list from buildTasks (parents before children). Returns Map(task id -> CSS colour).
//   scheme  "dark" | "light": the theme the colours must be readable on
//   seed    any string; the same seed always gives the same colours
export function nameColors(tasks, { scheme = "dark", seed = "" } = {}) {
  const bands = BANDS[scheme === "light" ? "light" : "dark"];
  const out = new Map();
  const hues = new Map(); // task id -> hue its children drift from
  const kids = new Map(); // parent id -> children, in order
  // Siblings are numbered by their place in the YAML (`order`), not by where they are now, so a task keeps its
  // colour when the table is sorted or filtered.
  for (const t of [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (!kids.has(t.parentId)) kids.set(t.parentId, []);
    kids.get(t.parentId).push(t);
  }
  const offset = hash(`${seed}`) % 360;

  const place = (t, baseHue, index, count, depth, parentHue) => {
    // A task's own colour wins and becomes the start of a new family.
    const own = t.color ? hexToHsl(t.color) : null;
    let hue;
    if (own) hue = own.h;
    else if (parentHue == null) hue = baseHue;
    else {
      // Siblings fan out around the parent's hue, a few degrees each, so they stay clearly related. Deeper levels
      // fan out a little less, so the drift stays gradual instead of running round the whole wheel.
      const spread = Math.max(6, 18 - depth * 3);
      hue = parentHue + (index - (count - 1) / 2) * spread;
    }
    hues.set(t.id, hue);
    const l = band(bands.l, depth);
    const s = band(bands.s, depth);
    // Alternating siblings differ slightly in lightness too, which helps tell neighbouring rows apart.
    const wobble = (index % 2 ? 1 : -1) * (depth > 0 ? 2 : 0);
    out.set(t.id, css(hue, s, clamp(l + wobble, 20, 85)));
    const children = kids.get(t.id) ?? [];
    children.forEach((c, i) => place(c, 0, i, children.length, depth + 1, hue));
  };

  const roots = kids.get(null) ?? [];
  roots.forEach((t, i) => place(t, wrap(offset + hash(t.name) % 23 + i * GOLDEN_ANGLE), i, roots.length, 0, null));
  return out;
}
