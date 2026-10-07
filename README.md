# OpenGantt

> **Made with AI.** This project was built entirely with AI assistance. Every line of code, this README, and the design of the chart were produced in collaboration with a large language model. It is shared as-is for anyone who finds it useful.

Draws Gantt charts from a small, readable YAML block — planned bars, actual bars and live progress, on one
timeline. It runs as a single HTML file you can double-click, and as a plugin inside Obsidian. Both share
the same chart code, so the columns, tooltips, print and export behave identically.

The YAML is the whole document: searchable, diffable, and easy to keep in version control next to whatever
it describes.

## Built with ts-gantt

OpenGantt is built on top of [ts-gantt](https://github.com/yermolim/ts-gantt), a simple TypeScript library
for creating Gantt charts combined with a task grid. The library is MIT-licensed and provides the core
rendering engine: a two-part layout (task grid + timeline), tree-like expandable rows, planned/actual date
pairs, and four chart scales (day, week, month, year). OpenGantt takes that foundation and wraps it in a
YAML-driven editor, an Obsidian plugin, a standalone HTML file, and a print/export pipeline.

The chart's dark Gruvbox theme, the column system, the tooltip, and the print renderer are OpenGantt's own;
the underlying chart geometry, bar drawing, and scale switching come from ts-gantt. If you want to build
something similar, ts-gantt is the place to start.

## Quick start

Open `dist/Gantt.html` in any modern browser. No install, no network, no build step — it is one file.

- Type or paste YAML in the editor on the left. The chart on the right redraws as you type and keeps your
  scale, mode and collapsed rows. A YAML mistake shows a message instead of breaking anything.
- **Open…** reads a `.md` note, a `.yaml` chart, or any text file. You can also drop a file on the window.
- **Save** writes back into the file you opened, in the format it came from. **Save as…** picks a new name
  or type. **Copy as Obsidian block** puts the YAML on the clipboard wrapped in a ````gantt` fence,
  ready to paste into a note.
- Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves as, Ctrl/Cmd+O opens, Ctrl/Cmd+P prints.
- Your work is kept automatically in the browser and comes back when you reopen the file. Table layout and
  export options are remembered too.

To rebuild the standalone file after changing anything in `src/`:

```

npm run build:app

```

No dependencies are needed for that build.

## The chart

```gantt
rows:
  - label: Stage 1 - Complete Initial Ideas
    plan: [2026-09-07, 2026-09-12]
    fact: [2026-09-07, 2026-09-14]
    children:
      - label: Complete Initial/Title Section
        plan: [2026-09-07, 2026-09-10]
        fact: [2026-09-07, 2026-09-14]
```

Row keys: `label`, `plan`, `fact`, `children`, `notes`.

- `plan: [start, end]` draws the planned bar. A single date (`plan: [date]`) is a one-day milestone.
- `fact: [start, end]` draws the actual bar. A single date (`fact: [start]`) is an **open task**: it is drawn
as a translucent progress bar from that date to today, with the percentage of the plan elapsed written on it.
- `children` nest under their parent; click a parent's name (the ▾ / ▸ chevron) to collapse or expand it.

In Both mode the actual bar (transparent diagonal stripes) is laid over the planned bar, in the same row band.

Optional keys next to `rows:`

| Key ↕▾ | Values ↕▾ | Default ↕▾ |
|---|---|---|
| −`scale` | `day`, `week`, `month`, `year` | `day` |
| `mode` | `plan`, `actual`, `both` | `both` |
| `height` | pixels, 200 to 1600 | `520` |
| `padding` | empty days before the first and after the last task, 0 to 365 | `7` |
| `hatch` | `false` makes actual bars solid instead of transparent with diagonal stripes | `true` |
| `progress` | `false` shows open-ended actuals as striped actual bars instead of the progress bar | `true` |
| `collapsed` | `true` starts with every parent task collapsed (`startCollapsed` works too) | `false` |
| `columns` | which table columns to show, and in what order, e.g. `columns: [progress, planEnd, owner]` or `columns: none` (see **Table columns**) | your saved choice |
| `table` | `false` (or `hidden`) starts with the left-hand table hidden | your saved choice |
| `title` | heading for printouts and exports | the file's name |
⚙

`start`, `days`, `timezone`, `workdayStart`, `workdayEnd`, `today` and `events` are accepted but ignored.

Hover a bar to see the task name, planned and actual dates, durations, progress and any `notes`.

## Saving

Save writes back into the file the chart came from, keeping its format:

| You opened | Save writes |
|---|---|
| a `.md` note | the **whole note**, with only the `gantt` block's YAML replaced. Frontmatter, other headings, other code blocks, everything after the chart — all untouched. |
| a `.yaml` / `.yml` file | just the YAML. |
| a `.txt` or anything else | just the YAML, with the same extension. |

- In Chrome and Edge (any Chromium browser), **Open…** and **Save** use the real file pickers, so Ctrl+S
writes straight back to the file on disk — no download, no dialog after the first save. The file name in
the header shows what will be written, with a **•** while there are unsaved changes.
- In Firefox and Safari, which have no write access to files, **Save** downloads a file with the right name
and extension instead. Reopening that download and saving again gives you the next version.
- If a note holds several `gantt` blocks, the first one is loaded and only that one is rewritten; the others
are left alone.
- A note with no `gantt` block yet gets one added at the end, and the rest of the note is left untouched.
- Charts that came from YAML and are saved as a `.md` get wrapped in a `gantt` fence, so they render straight
away in Obsidian.
- The **Example** button drops any link to the file you had open, so saving the example can never overwrite
your own chart.

## Table columns

The table left of the timeline is yours to arrange.

- **Table** button: hide or show the whole table (more room for the timeline). Your columns are kept.
- **Columns** button: tick the columns you want, and reorder them with the arrows or by dragging the grip.
**Show all** and **Reset** are there too.
- **In the chart:** drag a column heading sideways to move it, or right-click a heading for *Hide*,
*Move left / right* and *Choose columns*. (On touch screens use the Columns panel; dragging headings is
for mouse and pen.)
- Name always stays first. Your choice is remembered and shared by all your charts, and open charts update
together.

Columns you can add, beyond the five shown by default:

| Column ↕▾ | Shows ↕▾ | `columns:` name ↕▾ |
|---|---|---|
| −Progress | % of the plan elapsed | `progress` |
| −Start planned / End planned | planned dates | `planStart` / `planEnd` |
| −Start actual / End actual | actual dates (`ongoing` while open) | `actualStart` / `actualEnd` |
| Planned days / Actual days | length in days, counting both end days | `planDays` / `actualDays` |
| Variance | days late (`+3 d`) or early (`−2 d`) against the planned end; for an unfinished task past its planned end, days overdue so far | `variance` |
| Status | Not started, In progress, Overdue, Completed, Completed late (coloured like the task name) | `status` |
| Notes | the task's `notes` | `notes` |
⚙

**Your own columns:** any extra key on a task becomes a column, with the key as its heading.

```
rows:
  - label: Write essay
    plan: [2026-12-01, 2027-01-10]
    owner: Sam
    priority: High
```

`owner` and `priority` now appear in the Columns panel (tagged YAML) and in the tooltip. Values can be text,
numbers, dates or a short list. Names are matched ignoring case and punctuation, so
`columns: [Start planned, owner]` works. A name no task has yet still creates an empty column, which is a
quick way to see the heading before you fill in values.

A chart that sets `columns:` or `table:` keeps exactly that layout; changes made in the toolbar apply to that
view only and are not saved.

## Print and export

- **Print** prints the *whole* chart, not just the visible part: the rows you have expanded, the columns you
have shown, at the current scale and mode, in light colours. A long timeline is fitted to the page width,
long charts continue on further pages with the heading repeated and no row cut in half, and every page is
numbered. In the print dialog choose *Save as PDF* to get a PDF.
- **Export** gives you a **PNG image**, an **SVG** (vector, editable) or a **CSV** table. Images show the
whole chart at the on-screen scale, so a wide chart makes a wide image. The CSV lists *every* task
(collapsed or not) with a Level column, plus the columns you have shown, as plain values (ISO dates,
numbers) ready for a spreadsheet.
- **Options** (in the Export panel, remembered): print page Landscape or Portrait, image colours Light or
Dark, include title, include legend.

## Obsidian plugin

OpenGantt is also an Obsidian plugin. The YAML lives in your note, so it is searchable, synced and versioned
with the rest of your vault.

You need Node.js LTS once, to bundle the plugin (no third-party chart library is used).

**Windows:** double-click `BUILD-AND-INSTALL.bat`, drag your vault folder onto the window, press Enter.

**Any system:**

```
npm install
npm run build -- "/path/to/your/vault"
```

Without the vault path, `npm run build` just produces `main.js`, `manifest.json` and `styles.css`. Copy those
three into `<vault>/.obsidian/plugins/gantt/` yourself.

Then in Obsidian: Settings > Community plugins > turn off Restricted mode > enable **OpenGantt**.

Put a `gantt` block in any note:

```
```gantt
rows:
  - label: Stage 1 - Complete Initial Ideas
    plan: [2026-09-07, 2026-09-12]
    fact: [2026-09-07, 2026-09-14]
```
```

- The YAML is visible while you edit the note and hidden in reading view, so there is no separate hide button.
- If another plugin already uses the `gantt` block name, use ````epq-gantt` instead.
- The toolbar has Day/Week/Month/Year, Plan/Actual/Both, Expand/Collapse all, Table and Columns, a Legend
toggle (remembered), Print, Export, Full screen and Reset.
- Full screen uses real browser fullscreen; press Esc or the button to leave. Where that is unavailable (e.g.
phones) it fills the Obsidian window instead. The chart redraws at the new size and keeps your scale and mode.
- The chart keeps its dark Gruvbox colours whatever your Obsidian theme is.
- Printing the note itself, or Obsidian's own **Export to PDF**, gets the complete light version of every
chart instead of a clipped dark box.

## How the chart is drawn

The whole chart is drawn by hand (table as HTML, timeline as SVG; print and export use a separate static SVG
renderer that shares the same date-to-pixel geometry). Planned bars, actual bars, progress bars and the today
line all use the same date-to-pixel function, so they always line up, and completed tasks are drawn exactly
like any other task (striped actual bar over the planned bar). The chart opens scrolled to today; scroll left
for the Progress / date columns.

## Files

| Path ↕▾ | What it is ↕▾ |
|---|---|
| −`app/` | the standalone app's shell (toolbar, editor, open/save) and a small shim for the browser |
| −`src/` | the chart itself: model, timeline, columns, chart, export |
| −`vendor/` | a copy of js-yaml, so the standalone file needs no network |
| −`dist/Gantt.html` | the built standalone app — the file you double-click |
| `build-app.mjs` | builds `dist/Gantt.html` from `app/` and `src/` |
| `esbuild.mjs` | builds the Obsidian plugin (`main.js`, `styles.css`) from `src/` |
| `test/` | Node tests for the model, timeline, columns and export |
⚙

## License

Released into the public domain under the [Unlicense](https://unlicense.org/).

The underlying [ts-gantt](https://github.com/yermolim/ts-gantt) library is MIT-licensed.

