# Gantt for Obsidian

Draws Gantt charts from `gantt` code blocks, using the same Gantt Tracker-style YAML as the standalone app.
The YAML lives in your note, so it is searchable, synced and versioned with the rest of your vault.

## Install

You need Node.js LTS once, to bundle the plugin (no third-party chart library is used).

**Windows:** double-click `BUILD-AND-INSTALL.bat`, drag your vault folder onto the window, press Enter.

**Any system:**
```
npm install
npm run build -- "/path/to/your/vault"
```

Without the vault path, `npm run build` just produces `main.js`, `manifest.json` and `styles.css`.
Copy those three into `<vault>/.obsidian/plugins/gantt/` yourself.

Then in Obsidian: Settings > Community plugins > turn off Restricted mode > enable **Gantt**.

## Use

Put this in any note (see `Example Gantt.md`):

````
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
````

Row keys: `label`, `plan`, `fact`, `children`, `notes`.
`fact: [date]` with one date (no end) is drawn as a translucent **progress** bar from that date to today.

In Both mode the actual bar (transparent diagonal stripes) is laid over the planned bar, in the same row band.

Optional keys next to `rows:`

| Key | Values | Default |
| --- | --- | --- |
| `scale` | `day`, `week`, `month`, `year` | `day` |
| `mode` | `plan`, `actual`, `both` | `both` |
| `height` | pixels, 200 to 1600 | `520` |
| `padding` | empty days before the first and after the last task, 0 to 365 | `7` |
| `hatch` | `false` makes actual bars solid instead of transparent with diagonal stripes | `true` |
| `progress` | `false` shows open-ended actuals as striped actual bars instead of the progress bar | `true` |
| `collapsed` | `true` starts with every parent task collapsed (`startCollapsed` works too) | `false` |
| `columns` | which table columns to show, and in what order, e.g. `columns: [progress, planEnd, owner]` or `columns: none` (see **Table columns**) | your saved choice |
| `table` | `false` (or `hidden`) starts with the left-hand table hidden | your saved choice |
| `title` | heading for printouts and exports | the note's name |

`start`, `days`, `timezone`, `workdayStart`, `workdayEnd`, `today` and `events` are accepted but ignored, exactly as in the standalone app.

## Notes

- **Expand / collapse:** click a parent task's name (the ▾ / ▸ chevron) to hide or show its children, or use the **Expand all / Collapse all** toolbar buttons.
- **Progress:** a task with `fact: [start]` (no end) gets a solid green bar from the start date to today, with the % of the plan elapsed written on it.

- Hover a bar to see the task name, planned and actual dates, durations, progress and any `notes`.
- The YAML is visible while you edit the note and hidden in reading view, so there is no separate hide button.
- If another plugin already uses the `gantt` block name, use ```` ```epq-gantt ```` instead.
- The toolbar has Day/Week/Month/Year, Plan/Actual/Both, Expand/Collapse all, Table and Columns (see below), a Legend toggle (remembered), Print, Export, Full screen and Reset.
- Full screen uses real browser fullscreen; press Esc or the button to leave. Where that is unavailable (e.g. phones) it fills the Obsidian window instead. The chart redraws at the new size and keeps your scale and mode.
- The chart keeps its dark Gruvbox colours whatever your Obsidian theme is.

## Standalone app (no Obsidian needed)

`dist/Gantt.html` is the whole thing in one file. Double-click it to run in any modern browser, offline, with nothing to install. It uses the plugin's own chart code, so the columns, print, export, tooltips and full screen behave identically.

- **Editor + live chart:** type or paste the same YAML you'd put in a `gantt` block. The chart updates as you type and keeps your scale, mode and collapsed rows. A YAML mistake shows a message instead of breaking anything.
- **Open…** reads a `.yaml` file, or an Obsidian `.md` note (the first `gantt` block is used). You can also drop a file on the window.
- **Save YAML** downloads your chart. **Copy as Obsidian block** puts it on the clipboard wrapped in the `gantt` fence, ready to paste into a note. Ctrl/Cmd+S saves and Ctrl/Cmd+P prints.
- Your work is kept automatically in the browser and comes back when you reopen the file. Table layout and export options are remembered too.
- Exports are normal downloads (the browser decides where they go). "Save into the vault" simply downloads as well.

To rebuild it after changing anything in `src/`: `npm run build:app` (no dependencies needed). To build the Obsidian plugin instead, use `npm run build` as before.

## Table columns

The table left of the timeline is yours to arrange.

- **Table** button: hide or show the whole table (more room for the timeline). Your columns are kept.
- **Columns** button: tick the columns you want, and reorder them with the arrows or by dragging the grip. **Show all** and **Reset** are there too.
- **In the chart:** drag a column heading sideways to move it, or right-click a heading for *Hide*, *Move left / right* and *Choose columns*. (On touch screens use the Columns panel; dragging headings is for mouse and pen.)
- Name always stays first. Your choice is remembered and shared by all your charts, and open charts update together.

Columns you can add, beyond the five shown by default:

| Column | Shows | `columns:` name |
| --- | --- | --- |
| Progress | % of the plan elapsed | `progress` |
| Start planned / End planned | planned dates | `planStart` / `planEnd` |
| Start actual / End actual | actual dates (`ongoing` while open) | `actualStart` / `actualEnd` |
| Planned days / Actual days | length in days, counting both end days | `planDays` / `actualDays` |
| Variance | days late (`+3 d`) or early (`−2 d`) against the planned end; for an unfinished task past its planned end, days overdue so far | `variance` |
| Status | Not started, In progress, Overdue, Completed, Completed late (coloured like the task name) | `status` |
| Notes | the task's `notes` | `notes` |

**Your own columns:** any extra key on a task becomes a column, with the key as its heading.

```gantt
rows:
  - label: Write essay
    plan: [2026-12-01, 2027-01-10]
    owner: Sam
    priority: High
```

`owner` and `priority` now appear in the Columns panel (tagged YAML) and in the tooltip. Values can be text, numbers, dates or a short list. Names are matched ignoring case and punctuation, so `columns: [Start planned, owner]` works. A name no task has yet still creates an empty column, which is a quick way to see the heading before you fill in values.

A chart that sets `columns:` or `table:` keeps exactly that layout; changes made in the toolbar apply to that view only and are not saved.

## Print and export

- **Print** prints the *whole* chart, not just the visible part: the rows you have expanded, the columns you have shown, at the current scale and mode, in light colours. A long timeline is fitted to the page width, long charts continue on further pages with the heading repeated and no row cut in half, and every page is numbered. In the print dialog choose *Save as PDF* to get a PDF.
- **Export** gives you a **PNG image**, an **SVG** (vector, editable) or a **CSV** table. Images show the whole chart at the on-screen scale, so a wide chart makes a wide image. The CSV lists *every* task (collapsed or not) with a Level column, plus the columns you have shown, as plain values (ISO dates, numbers) ready for a spreadsheet.
- **Options** (in the Export panel, remembered): print page Landscape or Portrait, image colours Light or Dark, include title, include legend, and *Save into the vault* (puts the file next to the note, handy for `![[...]]`). On mobile exports always go into the vault.
- Printing the note itself, or Obsidian's own **Export to PDF**, also gets the complete light version of every chart instead of a clipped dark box. Set the print page orientation above to match the page you choose there.
- If printing is not available (some mobile apps), the chart is exported as a PNG instead.

## How the chart is drawn

The plugin draws the whole chart itself (table as HTML, timeline as SVG; print and export use a separate static SVG renderer that shares the same date-to-pixel geometry). Planned bars, actual bars, progress bars and the today line all use the same date-to-pixel function, so they always line up, and completed tasks are drawn exactly like any other task (striped actual bar over the planned bar). The chart opens scrolled to today; scroll left for the Progress / date columns.
