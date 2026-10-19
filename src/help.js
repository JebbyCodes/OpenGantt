// The Help, About and Credits text, shown in a dialog from both the Obsidian block and the standalone app.
import { h } from "./dom.js";

export const REPO_URL = "https://github.com/JebbyCodes/OpenGantt";

const code = (text) => h("pre", { class: "epq-help-code" }, h("code", { text }));
const sec = (title, ...kids) => h("section", { class: "epq-help-sec" }, h("h3", { text: title }), ...kids);
const p = (...kids) => h("p", {}, ...kids);
const k = (text) => h("kbd", { text });

export function renderHelp(el, { standalone = false } = {}) {
  el.append(
    sec("Quick start",
      p("A chart is a short YAML description. Put it in a ", h("code", { text: "gantt" }), " code block in an Obsidian note, or edit it here. Use the ", h("b", { text: "Visual" }), " tab to edit with forms and the ", h("b", { text: "YAML" }), " tab to type it. Both change the same chart."),
      code(`title: Website relaunch
scale: week
rows:
  - label: Design
    plan: [2026-09-07, 2026-09-18]
    fact: [2026-09-07, 2026-09-20]
    tags: [ui, review]
  - label: Build
    plan: [2026-09-21, 4w]
    fact: [2026-09-21]            # started, not finished`)),
    sec("Task keys",
      h("ul", {},
        h("li", {}, h("code", { text: "label" }), " the task name."),
        h("li", {}, h("code", { text: "plan" }), " / ", h("code", { text: "fact" }), " planned and actual dates: ", h("code", { text: "[start, end]" }), ", ", h("code", { text: "[start, 5d]" }), " (a length: d, w), or ", h("code", { text: "[start]" }), ". A one-date ", h("code", { text: "fact" }), " is a task still in progress."),
        h("li", {}, "Several ranges: ", h("code", { text: "plan: [2026-09-07, 2026-09-10], [2026-09-21, 2026-09-25]" }), "."),
        h("li", {}, h("code", { text: "progress" }), " set progress by hand (", h("code", { text: "60%" }), "); ", h("code", { text: "color" }), " the bar colour; ", h("code", { text: "tags" }), " labels; ", h("code", { text: "notes" }), " shown on hover."),
        h("li", {}, h("code", { text: "children" }), " nested tasks. A parent with no dates of its own spans its children."),
        h("li", {}, "Any other key (", h("code", { text: "owner: Sam" }), ") becomes its own table column."))),
    sec("Chart options",
      h("ul", {},
        h("li", {}, h("code", { text: "scale" }), " day, week, month, year; ", h("code", { text: "mode" }), " planned, actual, both."),
        h("li", {}, h("code", { text: "markers" }), " dated lines for deadlines and holidays; ", h("code", { text: "weekends: true" }), " shades weekends."),
        h("li", {}, h("code", { text: "sort: -progress" }), " sort rows (a leading ", h("code", { text: "-" }), " is descending); ", h("code", { text: "nameColors" }), " tree, status or none; ", h("code", { text: "tagLabels: false" }), " hides tags on the bars."),
        h("li", {}, h("code", { text: "columns" }), ", ", h("code", { text: "table" }), ", ", h("code", { text: "collapsed" }), ", ", h("code", { text: "height" }), ", ", h("code", { text: "padding" }), ", ", h("code", { text: "hatch" }), ", ", h("code", { text: "progress" }), " (see the README for all of them)."))),
    sec("Using the chart",
      h("ul", {},
        h("li", {}, h("b", { text: "Resize a column" }), ": drag the right edge of its heading. Double-click the edge to fit the text again. Columns grow to fit their text by default."),
        h("li", {}, h("b", { text: "Sort" }), ": click a column heading (click again to reverse, once more to clear), or use the Sort button."),
        h("li", {}, h("b", { text: "Reorder columns" }), ": drag a heading sideways, or use Columns. Right-click a heading for more."),
        h("li", {}, h("b", { text: "Filter" }), ": type in the filter box or choose a tag. Matching tasks keep their parents."),
        h("li", {}, h("b", { text: "Collapse" }), ": click a parent task. Hover any bar or row for details, including tags."),
        h("li", {}, h("b", { text: "Edit a task" }), ": double-click its name."),
        h("li", {}, h("b", { text: "Resize the chart" }), ": drag the bar at the bottom edge" + (standalone ? ", or the divider between editor and chart." : ".")))),
    sec("Name colours",
      p("Each top-level task gets its own colour and its subtasks drift gradually away from it, so a branch reads as one family. The colour is generated from the chart, so it is the same every time, and chosen to stay readable on the current theme. A small dot shows status (not started, in progress, overdue, completed). Set ", h("code", { text: "nameColors: status" }), " to colour the text by status instead, or ", h("code", { text: "none" }), ".")),
    sec("Keyboard",
      h("table", { class: "epq-help-keys" },
        ...(standalone ? [
          ["Ctrl S", "Save"], ["Ctrl Shift S", "Save as\u2026"], ["Ctrl O", "Open\u2026"], ["Ctrl P", "Print the chart"],
          ["Ctrl Z / Ctrl Shift Z", "Undo / redo, also for Visual edits"],
        ] : []).concat([
          ["Tab / Shift Tab", "Indent / outdent lines in the YAML editor"], ["Ctrl /", "Comment or uncomment lines"], ["Esc", "Close a dialog or leave full screen"],
        ]).map(([a, b]) => h("tr", {}, h("td", {}, ...a.split(" / ").flatMap((x, i) => (i ? [" / ", k(x)] : [k(x)]))), h("td", { text: b })))),
    ),
    sec("Themes",
      p("Open ", h("b", { text: "Theme" }), " to pick a built-in theme, or upload your own CSS. Download the template there to see every variable you can change. Custom CSS is saved " + (standalone ? "in this browser." : "with the plugin's data.") + " It can restyle anything in the chart, not just colours.")),
    sec("YAML tips",
      h("ul", {},
        h("li", {}, "Indent with spaces, never tabs. Quote text that contains a colon or starts with ", h("code", { text: "#" }), ", like ", h("code", { text: 'color: "#d3869b"' }), "."),
        h("li", {}, "Use the line numbers: the editor marks the line YAML complains about."),
        h("li", {}, "Edits made in the Visual tab rewrite the YAML in a tidy standard layout, and comments are not kept. Edits in the YAML tab never lose anything."))),
  );
}

export function renderAbout(el, { version = "", standalone = false } = {}) {
  el.append(
    h("div", { class: "epq-about" },
      h("div", { class: "epq-about-name", text: "OpenGantt" }),
      h("div", { class: "epq-about-ver", text: version ? `Version ${version}` : "" }),
      p("Gantt charts from plain YAML: planned and actual work, live progress, nested tasks, tags and printing. Runs inside Obsidian, as a single offline HTML file, or as a desktop app."),
      h("table", { class: "epq-about-table" },
        h("tr", {}, h("td", { text: "Author" }), h("td", { text: "JebbyCodes" })),
        h("tr", {}, h("td", { text: "Licence" }), h("td", { text: "Public domain (Unlicense)" })),
        h("tr", {}, h("td", { text: "Source" }), h("td", {}, h("a", { href: REPO_URL, target: "_blank", rel: "noopener noreferrer", text: REPO_URL.replace("https://", "") }))),
        h("tr", {}, h("td", { text: "Running as" }), h("td", { text: standalone ? "Standalone app" : "Obsidian plugin" }))),
      h("p", { class: "epq-dim" }, "Most of the code was written with AI assistance.")));
}

export const CREDITS = [
  { name: "js-yaml", by: "Vitaly Puzrin and contributors", license: "MIT", url: "https://github.com/nodeca/js-yaml", use: "Reads the YAML in the standalone app (Obsidian supplies its own parser)." },
  { name: "Tauri", by: "The Tauri Contributors", license: "Apache-2.0 or MIT", url: "https://tauri.app", use: "The desktop app shell." },
  { name: "esbuild", by: "Evan Wallace", license: "MIT", url: "https://esbuild.github.io", use: "Builds the Obsidian plugin (development only)." },
  { name: "Obsidian", by: "Obsidian (Dynalist Inc.)", license: "Plugin API", url: "https://obsidian.md", use: "The note-taking app OpenGantt runs inside." },
  { name: "Gruvbox", by: "Pavel Pertsev", license: "MIT", url: "https://github.com/morhetz/gruvbox", use: "Default colour palette (dark and light)." },
  { name: "Nord", by: "Arctic Ice Studio / Sven Greb", license: "MIT", url: "https://www.nordtheme.com", use: "The Nord theme colours." },
  { name: "Dracula", by: "Zeno Rocha and contributors", license: "MIT", url: "https://draculatheme.com", use: "The Dracula theme colours." },
  { name: "Solarized", by: "Ethan Schoonover", license: "MIT", url: "https://ethanschoonover.com/solarized", use: "The Solarized themes' colours." },
];

export function renderCredits(el) {
  el.append(
    p("OpenGantt stands on other people's work. Thank you to:"),
    h("div", { class: "epq-credits" }, ...CREDITS.map((c) => h("div", { class: "epq-credit" },
      h("div", {}, h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", text: c.name }), h("span", { class: "epq-credit-lic", text: c.license })),
      h("div", { class: "epq-credit-by", text: c.by }),
      h("div", { class: "epq-credit-use", text: c.use })))),
    p("The colour themes only borrow each palette's colours; none of their code is included. Full licence texts for bundled software are in THIRD-PARTY-NOTICES.md."));
}
