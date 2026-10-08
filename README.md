# OpenGantt

[![Website](https://img.shields.io/badge/Website-OpenGantt-458588?logo=googlechrome\&logoColor=white)](https://jebbycodes.github.io/OpenGantt/)
[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian\&logoColor=white)](https://community.obsidian.md/plugins/gantt)
[![GitHub Release](https://img.shields.io/github/v/release/JebbyCodes/OpenGantt?label=release)](https://github.com/JebbyCodes/OpenGantt/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/JebbyCodes/OpenGantt/release.yml?label=build)](https://github.com/JebbyCodes/OpenGantt/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/JebbyCodes/OpenGantt)](https://github.com/JebbyCodes/OpenGantt/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/JebbyCodes/OpenGantt)](https://github.com/JebbyCodes/OpenGantt/stargazers)

> A lightweight, YAML-driven Gantt chart for the browser, Obsidian, and desktop.

**[🌐 OpenGantt Website](https://jebbycodes.github.io/OpenGantt/)** · **[📝 Obsidian Plugin](https://community.obsidian.md/plugins/gantt)** · **[📦 GitHub Releases](https://github.com/JebbyCodes/OpenGantt/releases)**

OpenGantt turns a small YAML definition into an interactive Gantt chart with **planned work, actual work, live progress, hierarchical tasks, custom columns, printing, and export**.

It can be used in three ways:

* 🌐 **Standalone web app** — use OpenGantt directly in your browser or as a self-contained HTML application.
* 📝 **Obsidian plugin** — embed Gantt charts directly inside Markdown notes.
* 🖥️ **Desktop application** — package the same frontend as a native Tauri application.

The chart data remains plain YAML, making it easy to read, edit, search, diff, back up, and keep alongside the project it describes.

---

## ✨ Features

### 📅 Gantt charts

* Planned and actual task bars
* Live progress for open tasks
* Day, week, month, and year scales
* Today indicator
* Task hierarchy with expandable/collapsible rows
* Milestones
* Planned vs. actual comparison
* Actual bars with optional diagonal hatching
* Automatic progress calculation
* Task status and schedule variance

### 📊 Customisable task table

The table alongside the timeline can display:

* Task name
* Progress
* Planned start/end dates
* Actual start/end dates
* Planned duration
* Actual duration
* Schedule variance
* Status
* Notes
* Custom YAML fields

Columns can be reordered, hidden, or added from the chart interface.

Any additional property placed on a task automatically becomes available as a custom column.

### 📝 YAML-driven

Charts are defined using simple YAML:

```yaml
scale: week
mode: both
title: Example project

rows:
  - label: Stage 1 - Planning
    plan: [2026-09-07, 2026-09-12]
    fact: [2026-09-07, 2026-09-14]

    children:
      - label: Collect requirements
        plan: [2026-09-07, 2026-09-09]
        fact: [2026-09-07, 2026-09-10]

      - label: Write specification
        plan: [2026-09-10, 2026-09-12]
        fact: [2026-09-11, 2026-09-14]

  - label: Stage 2 - Development
    plan: [2026-09-15, 2026-10-10]
    fact: [2026-09-15]
```

Because the chart is represented as text, it works particularly well with Git, Markdown, Obsidian, and other text-based workflows.

---

## 🚀 Quick start

### 🌐 Web version

**[Open OpenGantt in your browser →](https://jebbycodes.github.io/OpenGantt/)**

The web version runs directly in your browser with no installation required.

It provides:

* YAML editing
* Open
* Save
* Save As
* Obsidian block copying
* Example chart
* Printing
* PNG export
* SVG export
* CSV export
* Timeline scaling
* Plan / Actual / Both modes
* Table and column controls

The repository also contains a self-contained standalone application:

```text
dist/Gantt.html
```

Simply open it in a modern browser.

No server is required and the standalone build does not need an internet connection.

### 📝 Obsidian

OpenGantt is available through the **[Obsidian Community Plugins](https://community.obsidian.md/plugins/gantt)**.

Install it from:

**Settings → Community plugins → Browse → OpenGantt**

Alternatively, you can build and install the plugin manually using the development instructions below.

### 🖥️ Desktop

OpenGantt can also be packaged as a native desktop application using **[Tauri 2](https://tauri.app/)**.

See [Building the desktop application](#building-the-desktop-application) for instructions.

### Keyboard shortcuts

| Shortcut                       | Action  |
| ------------------------------ | ------- |
| `Ctrl` / `Cmd` + `O`           | Open    |
| `Ctrl` / `Cmd` + `S`           | Save    |
| `Ctrl` / `Cmd` + `Shift` + `S` | Save As |
| `Ctrl` / `Cmd` + `P`           | Print   |

---

# 📦 Installation

## Requirements

### For using the web application

No installation is required.

Open:

**https://jebbycodes.github.io/OpenGantt/**

in a modern browser.

Alternatively, download or clone the repository and open:

```text
dist/Gantt.html
```

### For using the Obsidian plugin

Install OpenGantt from the **[Obsidian Community Plugins](https://community.obsidian.md/plugins/gantt)**.

No additional dependencies are required for normal plugin use.

### For development

The JavaScript build system requires:

* [Node.js](https://nodejs.org/) LTS
* npm

The Obsidian plugin build uses `esbuild`.

### For building the desktop application

The desktop version uses:

* Node.js
* npm
* Rust
* Cargo
* Tauri 2

The Rust project specifies a minimum Rust version of **1.77.2**.

---

# 🛠️ Development setup

Clone the repository:

```bash
git clone https://github.com/JebbyCodes/OpenGantt.git
cd OpenGantt
```

Install the JavaScript dependencies:

```bash
npm install
```

The dependencies and available npm scripts are defined in `package.json`.

---

# 🧱 Building

OpenGantt has separate build processes for the standalone application and the Obsidian plugin.

## Standalone application

Build the browser version with:

```bash
npm run build:app
```

This runs `build-app.mjs`.

The build produces:

```text
dist/
├── Gantt.html
└── index.html
```

`Gantt.html` is the standalone application intended to be opened directly.

`index.html` contains the same generated application and serves as the frontend entry point used by Tauri.

### Offline operation

The standalone application bundles its required JavaScript, CSS, and `js-yaml` dependency into the generated HTML.

Nothing needs to be downloaded when the generated file is opened.

---

## Obsidian plugin

Build the Obsidian plugin with:

```bash
npm run build
```

The build produces:

```text
main.js
styles.css
```

`manifest.json` is already present in the repository and is copied alongside those files when the optional vault path is supplied.

The build script bundles the plugin while leaving Obsidian, Electron, CodeMirror, and Lezer packages external because they are provided by the Obsidian host application.

### Automatically install into an Obsidian vault

Pass the path to your Obsidian vault:

```bash
npm run build -- "/path/to/your/vault"
```

For example, on Windows:

```powershell
npm run build -- "C:\Users\YourName\Documents\Obsidian Vaults\My Vault"
```

The build script installs the plugin into:

```text
<vault>/.obsidian/plugins/gantt/
```

The resulting directory contains:

```text
<vault>/.obsidian/plugins/gantt/
├── main.js
├── manifest.json
└── styles.css
```

The repository also contains a Windows helper:

```text
BUILD-AND-INSTALL.bat
```

which can be used to automate the installation process where available.

### Manual installation

If you build without specifying a vault:

```bash
npm run build
```

copy:

```text
main.js
manifest.json
styles.css
```

to:

```text
<vault>/.obsidian/plugins/gantt/
```

Then open Obsidian and go to:

**Settings → Community plugins → enable OpenGantt**

---

# 🖥️ Building the desktop application

OpenGantt uses **[Tauri 2](https://tauri.app/)** for its desktop shell.

The Tauri configuration specifies:

* Application name: `OpenGantt`
* Version: `1.2.0`
* Frontend directory: `dist/`
* Frontend build command: `npm run build:app`

After installing the required Rust/Tauri tooling, build the desktop application with:

```bash
npx tauri build
```

Tauri will first run:

```bash
npm run build:app
```

and then package the generated `dist/` frontend into the native application.

For development with the Tauri shell:

```bash
npx tauri dev
```

The exact native output location depends on the platform and Tauri's build configuration.

---

# 🧪 Testing

Run the project's test suite with:

```bash
npm test
```

The test command currently runs tests covering:

* Model behaviour
* Timeline calculations
* Table columns
* Export functionality

The individual test files are:

```text
test/model.test.mjs
test/timeline.test.mjs
test/columns.test.mjs
test/export.test.mjs
```

The available test command is defined directly in `package.json`.

---

# 📐 YAML reference

## Top-level options

The following options can be placed alongside `rows`:

| Option      | Values                         |      Default | Description                      |
| ----------- | ------------------------------ | -----------: | -------------------------------- |
| `scale`     | `day`, `week`, `month`, `year` |        `day` | Timeline scale                   |
| `mode`      | `plan`, `actual`, `both`       |       `both` | Which bars to display            |
| `height`    | `200`–`1600`                   |        `520` | Chart height in pixels           |
| `padding`   | `0`–`365`                      |          `7` | Empty days around the chart      |
| `hatch`     | `true`, `false`                |       `true` | Diagonal hatching on actual bars |
| `progress`  | `true`, `false`                |       `true` | Show progress for open actuals   |
| `collapsed` | `true`, `false`                |      `false` | Start with parent rows collapsed |
| `columns`   | Column names                   | Saved layout | Select and order table columns   |
| `table`     | `true`, `false`, `hidden`      | Saved layout | Show or hide the task table      |
| `title`     | Text                           |    File name | Title used for print/export      |

### Example

```yaml
scale: month
mode: both
height: 700
padding: 14
hatch: true
progress: true
collapsed: false
title: EPQ Project

rows:
  - label: Research
    plan: [2026-09-07, 2026-10-10]
    fact: [2026-09-07]
```

---

## Task properties

Each task can contain:

| Property   | Description             |
| ---------- | ----------------------- |
| `label`    | Task name               |
| `plan`     | Planned start/end dates |
| `fact`     | Actual start/end dates  |
| `children` | Nested tasks            |
| `notes`    | Additional information  |

Additional properties become custom table columns.

For example:

```yaml
rows:
  - label: Write literature review
    plan: [2026-10-01, 2026-10-14]
    fact: [2026-10-02, 2026-10-17]
    owner: Alex
    priority: High
```

This automatically makes `owner` and `priority` available as table columns.

---

## Planned dates

A normal planned task uses two dates:

```yaml
plan: [2026-10-01, 2026-10-14]
```

A single planned date creates a milestone:

```yaml
plan: [2026-10-14]
```

---

## Actual dates

A completed or ongoing task can have an actual start and end:

```yaml
fact: [2026-10-02, 2026-10-17]
```

An open task can contain only its actual start:

```yaml
fact: [2026-10-02]
```

Open actual tasks extend to the current date and can display their calculated progress.

---

## Hierarchical tasks

Use `children` to create nested tasks:

```yaml
rows:
  - label: Stage 1 - Research
    plan: [2026-09-07, 2026-10-01]

    children:
      - label: Find sources
        plan: [2026-09-07, 2026-09-14]

      - label: Evaluate sources
        plan: [2026-09-15, 2026-09-21]

      - label: Write notes
        plan: [2026-09-22, 2026-10-01]
```

Parent rows can be expanded or collapsed using the chart controls.

---

# 📊 Table columns

The chart includes several built-in columns.

| Column        | YAML name     | Description                        |
| ------------- | ------------- | ---------------------------------- |
| Progress      | `progress`    | Percentage of planned time elapsed |
| Start planned | `planStart`   | Planned start date                 |
| End planned   | `planEnd`     | Planned end date                   |
| Start actual  | `actualStart` | Actual start date                  |
| End actual    | `actualEnd`   | Actual end date                    |
| Planned days  | `planDays`    | Planned duration                   |
| Actual days   | `actualDays`  | Actual duration                    |
| Variance      | `variance`    | Difference from planned completion |
| Status        | `status`      | Current task status                |
| Notes         | `notes`       | Task notes                         |

For example:

```yaml
columns:
  - progress
  - planEnd
  - actualEnd
  - variance
  - status
```

You can also use:

```yaml
columns: none
```

to hide the table columns.

---

# 💾 Saving and file formats

OpenGantt can work with several file types.

| Input            | Save behaviour                          |
| ---------------- | --------------------------------------- |
| `.md`            | Replaces only the selected Gantt block  |
| `.yaml` / `.yml` | Saves YAML                              |
| `.txt`           | Saves YAML using the same extension     |
| Other text files | Saves YAML using the original extension |

When editing a Markdown note containing a Gantt block, OpenGantt preserves the rest of the note.

This includes:

* Frontmatter
* Headings
* Other Markdown content
* Other code blocks
* Content after the Gantt chart

If a Markdown note does not contain a Gantt block, OpenGantt can add one without replacing the rest of the document.

---

# 🖨️ Print and export

OpenGantt supports printing and several export formats.

### Print

The print renderer:

* Prints the complete chart rather than only the visible portion
* Includes expanded rows
* Includes the selected columns
* Supports the current chart scale and mode
* Uses a light print-friendly colour scheme
* Splits long charts across pages
* Repeats the heading on subsequent pages
* Avoids cutting rows between pages
* Numbers pages

You can use your browser's **Save as PDF** option to create a PDF.

### Export formats

The export panel supports:

* **PNG** — raster image
* **SVG** — editable vector image
* **CSV** — spreadsheet-compatible task data

CSV exports include every task, including tasks hidden by collapsed parent rows.

---

# 📝 Obsidian usage

OpenGantt can render charts directly inside Obsidian Markdown notes.

Install OpenGantt from the **[Obsidian Community Plugins](https://community.obsidian.md/plugins/gantt)**, then add a `gantt` code block:

````markdown
```gantt
scale: week
mode: both

rows:
  - label: Stage 1 - Planning
    plan: [2026-09-07, 2026-09-12]
    fact: [2026-09-07, 2026-09-14]

    children:
      - label: Research
        plan: [2026-09-07, 2026-09-09]

      - label: Planning
        plan: [2026-09-10, 2026-09-12]
```
````

The YAML is visible while editing the Markdown source and is rendered as a chart in Reading View.

### Alternative code-block name

If another Obsidian plugin already uses the `gantt` code-block name, OpenGantt can use:

````markdown
```epq-gantt
rows:
  - label: Example
    plan: [2026-09-07, 2026-09-12]
```
````

---

# 🎛️ Obsidian controls

The Obsidian chart toolbar provides:

* Day / Week / Month / Year
* Plan / Actual / Both
* Expand all
* Collapse all
* Table
* Columns
* Legend
* Print
* Export
* Full screen
* Reset

The chart uses its own dark Gruvbox-inspired colours regardless of the active Obsidian theme.

Full-screen mode uses browser fullscreen where supported. On environments where browser fullscreen is unavailable, OpenGantt expands within the available Obsidian window.

---

# 🏗️ Project structure

```text
OpenGantt/
│
├── app/
│   ├── app.css
│   ├── shell.js
│   └── shim.js
│
├── dist/
│   ├── Gantt.html
│   └── index.html
│
├── src/
│   ├── model.js
│   ├── timeline.js
│   ├── columns.js
│   ├── chart.js
│   ├── export.js
│   ├── main.js
│   └── styles.css
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── ...
│
├── test/
│   ├── model.test.mjs
│   ├── timeline.test.mjs
│   ├── columns.test.mjs
│   └── export.test.mjs
│
├── vendor/
│   └── js-yaml.min.js
│
├── build-app.mjs
├── esbuild.mjs
├── package.json
├── package-lock.json
├── manifest.json
├── main.js
├── styles.css
├── LICENSE
└── README.md
```

### Important directories

| Path         | Purpose                                           |
| ------------ | ------------------------------------------------- |
| `app/`       | Standalone application's editor and browser shell |
| `src/`       | Core Gantt chart implementation                   |
| `src-tauri/` | Tauri desktop application                         |
| `test/`      | Automated tests                                   |
| `vendor/`    | Local third-party browser dependencies            |
| `dist/`      | Generated standalone/Tauri frontend               |

### Important build files

| File                        | Purpose                                |
| --------------------------- | -------------------------------------- |
| `build-app.mjs`             | Builds the standalone HTML application |
| `esbuild.mjs`               | Builds the Obsidian plugin             |
| `package.json`              | Defines dependencies and npm scripts   |
| `src-tauri/tauri.conf.json` | Configures the Tauri application       |
| `src-tauri/Cargo.toml`      | Defines the Rust/Tauri package         |

---

# 🔧 Available npm commands

| Command             | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm install`       | Install development dependencies      |
| `npm run build`     | Build the Obsidian plugin             |
| `npm run build:app` | Build the standalone HTML application |
| `npm test`          | Run the automated tests               |

---

# 🧩 Architecture

OpenGantt uses a shared chart implementation across its different interfaces.

```text
                    ┌─────────────────────┐
                    │      YAML data      │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   OpenGantt model   │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
                 ▼             ▼             ▼
             Browser        Obsidian       Tauri
             frontend        plugin        desktop
                 │             │             │
                 └─────────────┼─────────────┘
                               ▼
                     ┌──────────────────┐
                     │ Gantt renderer   │
                     │ Timeline + table │
                     └──────────────────┘
```

The standalone builder embeds the application's JavaScript, CSS, and YAML parser into a single HTML file. The Tauri configuration then uses the generated `dist/` directory as its frontend.

---

# 🔗 ts-gantt

OpenGantt is based on the **[`ts-gantt`](https://github.com/yermolim/ts-gantt)** project.

`ts-gantt` provides the underlying Gantt-chart concepts and rendering foundation, while OpenGantt adds its own:

* YAML-driven format
* Planned/actual/progress workflow
* Gruvbox-inspired interface
* Custom table columns
* Tooltip system
* Print renderer
* Export system
* Standalone application
* Obsidian integration

The underlying `ts-gantt` project is MIT licensed. OpenGantt itself is released under the Unlicense.

---

# 🤝 Contributing

Contributions, bug reports, improvements, and feature ideas are welcome.

Before submitting a change:

1. Fork the repository.

2. Create a branch for your change.

3. Install dependencies with `npm install`.

4. Make your changes.

5. Run the test suite:

   ```bash
   npm test
   ```

6. Test the relevant build:

   ```bash
   npm run build
   ```

   or:

   ```bash
   npm run build:app
   ```

7. Open a pull request with a clear description of the change.

For UI changes, include screenshots where useful.

---

# 🐛 Reporting bugs

When reporting a problem, include as much of the following as possible:

* Operating system
* Browser or Obsidian version
* OpenGantt version/commit
* Whether you are using the web app, Obsidian plugin, or desktop application
* The YAML that reproduces the issue
* Console/build errors
* Screenshots or recordings when appropriate

A minimal reproducible example makes debugging considerably easier.

---

# 📄 License

OpenGantt is released into the public domain under the **Unlicense**.

See [`LICENSE`](LICENSE) for the full license text.

OpenGantt incorporates the MIT-licensed [`ts-gantt`](https://github.com/yermolim/ts-gantt) project.

---

# 🙏 Acknowledgements

* **[`ts-gantt`](https://github.com/yermolim/ts-gantt)** — underlying Gantt chart foundation
* **[`js-yaml`](https://github.com/nodeca/js-yaml)** — YAML parsing
* **[Obsidian](https://obsidian.md/)** — Markdown knowledge-management platform supported by the plugin
* **[Tauri](https://tauri.app/)** — desktop application framework

---

# ⚠️ Project status

OpenGantt is an actively developed open-source project.

The repository currently contains a standalone browser application, an Obsidian plugin, and a Tauri desktop shell. Features and interfaces may change between versions.

The latest web version is available at:

**[🌐 https://jebbycodes.github.io/OpenGantt/](https://jebbycodes.github.io/OpenGantt/)**

If you are using OpenGantt for important project planning, keep your YAML/Markdown source files under version control or maintain regular backups.
