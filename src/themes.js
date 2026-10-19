// Built-in colour themes, plus the plumbing for your own CSS.
//
// A theme is just values for the variables defined at the top of styles.css (--og-* for the palette, --tsg-* for
// status, bar and today colours). themeCss() turns the list into one stylesheet of
//     .epq-gantt-block[data-og-theme="nord"], :root[data-og-theme="nord"] { ... }
// rules, so a theme is switched by setting data-og-theme on a chart block (or on <html> in the standalone app).
// Custom CSS is applied after the themes and can change any of the same variables, or style the chart outright.

const P = (o) => ({ ...o });

// bg, surface (buttons), surface2 (hover/header), line (borders), line2 (grid), fg, fg2, fg3, muted, accent, onAccent,
// focus, pop (menus), tip (tooltip), error, errorBg, code, shadow
const pal = (scheme, [bg, surface, surface2, line, line2, fg, fg2, fg3, muted, accent, onAccent, focus, pop, tip, error, errorBg, code, shadow], chart) => ({
  scheme,
  vars: P({
    "--og-scheme": scheme, "--og-bg": bg, "--og-surface": surface, "--og-surface-2": surface2, "--og-line": line, "--og-line-2": line2,
    "--og-fg": fg, "--og-fg-2": fg2, "--og-fg-3": fg3, "--og-muted": muted, "--og-accent": accent, "--og-on-accent": onAccent,
    "--og-focus": focus, "--og-pop-bg": pop, "--og-tip-bg": tip, "--og-error": error, "--og-error-bg": errorBg, "--og-code": code,
    "--og-shadow": shadow,
    ...chart,
  }),
});

// chart colours: not started, overdue, completed, completed late, today line, planned bar, actual bar
const chart = (idle, overdue, done, late, today, bar1, bar2) => ({
  "--tsg-not-started-fg-color": idle, "--tsg-overdue-fg-color": overdue, "--tsg-completed-fg-color": done,
  "--tsg-completed-late-fg-color": late, "--tsg-today-line-color": today, "--tsg-chart-bar-color-1": bar1, "--tsg-chart-bar-color-2": bar2,
});

export const THEMES = [
  { id: "gruvbox-dark", name: "Gruvbox dark", ...pal("dark",
    ["#1d2021", "#3c3836", "#504945", "#665c54", "#7c6f64", "#fbf1c7", "#ebdbb2", "#d5c4a1", "#928374", "#fabd2f", "#1d2021", "#83a598", "#282828", "#32302f", "#fb4934", "#3c1f1e", "#b8bb26", "rgba(0,0,0,.5)"],
    chart("#d5c4a1", "#ff6b5a", "#b8e04a", "#ffa040", "#ff5544", "#7fc4e8", "#b8e04a")) },
  { id: "gruvbox-light", name: "Gruvbox light", ...pal("light",
    ["#fbf1c7", "#ebdbb2", "#d5c4a1", "#bdae93", "#a89984", "#3c3836", "#3c3836", "#504945", "#7c6f64", "#9a5b00", "#fbf1c7", "#076678", "#f9f5d7", "#f2e5bc", "#9d0006", "#f4d6cf", "#79740e", "rgba(60,56,54,.25)"],
    chart("#665c54", "#cc241d", "#79740e", "#af3a03", "#cc241d", "#458588", "#79740e")) },
  { id: "nord", name: "Nord", ...pal("dark",
    ["#2e3440", "#3b4252", "#434c5e", "#4c566a", "#4c566a", "#eceff4", "#e5e9f0", "#d8dee9", "#7b88a1", "#88c0d0", "#2e3440", "#81a1c1", "#2e3440", "#3b4252", "#bf616a", "#3b2a30", "#a3be8c", "rgba(0,0,0,.45)"],
    chart("#d8dee9", "#bf616a", "#a3be8c", "#d08770", "#bf616a", "#81a1c1", "#a3be8c")) },
  { id: "dracula", name: "Dracula", ...pal("dark",
    ["#282a36", "#343746", "#44475a", "#565a75", "#565a75", "#f8f8f2", "#f8f8f2", "#d6d6e0", "#8b91b3", "#bd93f9", "#282a36", "#8be9fd", "#21222c", "#343746", "#ff5555", "#3d2a33", "#50fa7b", "rgba(0,0,0,.5)"],
    chart("#d6d6e0", "#ff5555", "#50fa7b", "#ffb86c", "#ff5555", "#8be9fd", "#50fa7b")) },
  { id: "solarized-dark", name: "Solarized dark", ...pal("dark",
    ["#002b36", "#073642", "#0b4552", "#2a5a66", "#2a5a66", "#eee8d5", "#eee8d5", "#93a1a1", "#657b83", "#b58900", "#002b36", "#268bd2", "#00212b", "#073642", "#dc322f", "#3a1f22", "#859900", "rgba(0,0,0,.5)"],
    chart("#93a1a1", "#dc322f", "#859900", "#cb4b16", "#dc322f", "#268bd2", "#859900")) },
  { id: "solarized-light", name: "Solarized light", ...pal("light",
    ["#fdf6e3", "#eee8d5", "#e4ddc4", "#c9c2aa", "#d3cbb0", "#073642", "#073642", "#586e75", "#839496", "#8a6700", "#fdf6e3", "#268bd2", "#fdf6e3", "#eee8d5", "#dc322f", "#f4dcd3", "#859900", "rgba(7,54,66,.2)"],
    chart("#657b83", "#dc322f", "#6c8200", "#cb4b16", "#dc322f", "#268bd2", "#6c8200")) },
  { id: "paper", name: "Paper (light, print-friendly)", ...pal("light",
    ["#ffffff", "#f1f3f5", "#e3e7eb", "#c3cad2", "#d5dae0", "#1b1f24", "#1b1f24", "#454d57", "#6b7580", "#0b61c4", "#ffffff", "#0b61c4", "#ffffff", "#ffffff", "#b3261e", "#fde8e6", "#0b6e4f", "rgba(20,30,40,.22)"],
    chart("#454d57", "#b3261e", "#0b6e4f", "#a85a00", "#b3261e", "#2f7ac0", "#1f8a5c")) },
  { id: "high-contrast", name: "High contrast", ...pal("dark",
    ["#000000", "#1a1a1a", "#333333", "#ffffff", "#8a8a8a", "#ffffff", "#ffffff", "#ffffff", "#c8c8c8", "#ffd400", "#000000", "#00e5ff", "#000000", "#000000", "#ff6b6b", "#2b0000", "#7dff7d", "rgba(0,0,0,.8)"],
    chart("#ffffff", "#ff6b6b", "#7dff7d", "#ffb347", "#ff3b3b", "#4dc3ff", "#7dff7d")) },
  // Follows whatever theme Obsidian is using. Only meaningful inside Obsidian, so the standalone app hides it.
  { id: "obsidian", name: "Match Obsidian", obsidianOnly: true, scheme: "dark", vars: {
    "--og-bg": "var(--background-primary)", "--og-surface": "var(--background-secondary)", "--og-surface-2": "var(--background-modifier-hover)",
    "--og-line": "var(--background-modifier-border)", "--og-line-2": "var(--background-modifier-border-hover)",
    "--og-fg": "var(--text-normal)", "--og-fg-2": "var(--text-normal)", "--og-fg-3": "var(--text-muted)", "--og-muted": "var(--text-faint)",
    "--og-accent": "var(--interactive-accent)", "--og-on-accent": "var(--text-on-accent)", "--og-focus": "var(--interactive-accent)",
    "--og-pop-bg": "var(--background-primary)", "--og-tip-bg": "var(--background-secondary)", "--og-error": "var(--text-error)",
    "--og-error-bg": "var(--background-secondary)", "--og-code": "var(--text-accent)", "--og-shadow": "rgba(0,0,0,.3)",
    "--tsg-not-started-fg-color": "var(--text-muted)", "--tsg-overdue-fg-color": "var(--color-red, #e5484d)",
    "--tsg-completed-fg-color": "var(--color-green, #3fb950)", "--tsg-completed-late-fg-color": "var(--color-orange, #f0883e)",
    "--tsg-today-line-color": "var(--color-red, #e5484d)", "--tsg-chart-bar-color-1": "var(--color-blue, #4c8dff)",
    "--tsg-chart-bar-color-2": "var(--color-green, #3fb950)",
  } },
];

export const DEFAULT_THEME = "gruvbox-dark";
export const getTheme = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const themeList = ({ obsidian = false } = {}) => THEMES.filter((t) => obsidian || !t.obsidianOnly);

// One stylesheet holding every theme.
export function themeCss() {
  const rules = THEMES.map((t) => {
    const body = Object.entries(t.vars).map(([k, v]) => `    ${k}: ${v};`).join("\n");
    return `  .epq-gantt-block[data-og-theme="${t.id}"],\n  .epq-overlay[data-og-theme="${t.id}"],\n  :root[data-og-theme="${t.id}"] {\n${body}\n  }`;
  }).join("\n\n");
  // Themes sit in a cascade layer between the built-in defaults and the user's CSS, so custom CSS always wins.
  return `@layer og-defaults, og-theme;\n@layer og-theme {\n${rules}\n}`;
}

// Whether the chart's colours should be tuned for a dark or a light background. Themes (and custom CSS) say so with
// --og-scheme; "Match Obsidian" asks Obsidian.
export function schemeOf(el, themeId) {
  if (themeId === "obsidian") return el?.ownerDocument?.body?.classList.contains("theme-light") ? "light" : "dark";
  let v = "";
  try { v = getComputedStyle(el).getPropertyValue("--og-scheme").trim(); } catch { /* not in a browser */ }
  return v === "light" ? "light" : v === "dark" ? "dark" : getTheme(themeId).scheme;
}

// A starting point for your own theme: every variable, with its current Gruvbox dark value.
export function customCssTemplate() {
  const t = getTheme(DEFAULT_THEME);
  const lines = Object.entries(t.vars).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  return `/* OpenGantt custom CSS.
   Change any variable below, delete the ones you don't want to touch, then upload this file (or paste it into the
   settings). Set --og-scheme to "light" for a light background: it tunes the automatic task-name colours.
   You can also style the chart directly, e.g.  .epq-gantt-block .epq-bar-plan { rx: 2px; }  */
.epq-gantt-block,
.epq-overlay,
:root {
${lines}
}
`;
}

// Puts the theme stylesheet and the user's CSS into <head> (created once, then updated in place).
export function installThemeStyles(doc, customCss = "") {
  const put = (id, text) => {
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement("style");
      el.id = id;
      doc.head.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  };
  put("og-themes", themeCss());
  put("og-custom-css", String(customCss ?? ""));
}
