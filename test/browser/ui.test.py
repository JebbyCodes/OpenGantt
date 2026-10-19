"""Browser tests for the interface: resizing, sorting, the visual editor, undo, themes, dialogs and the Obsidian edit
dialog. They drive the built standalone app in headless Chromium.

    npm run build:app
    python3 test/browser/ui.test.py          (or: npm run test:browser)

Needs Python with Playwright and Chromium:  pip install playwright && playwright install chromium
"""
import pathlib, re, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = (ROOT / "dist" / "Gantt.html").as_uri()
passed = 0

def check(cond, what):
    global passed
    if not cond:
        print(f"FAIL: {what}"); sys.exit(1)
    passed += 1

DEMO = """title: Demo
scale: week
weekends: true
rows:
  - label: Design
    plan: [2026-09-07, 2026-09-18]
    fact: [2026-09-07, 2026-09-20]
    tags: [ui, review]
    children:
      - label: Wireframes
        plan: [2026-09-07, 5d]
        fact: [2026-09-07, 2026-09-11]
        tags: [ui]
      - label: Visual design
        plan: [2026-09-14, 5d]
        fact: [2026-09-14, 2026-09-20]
        tags: [ui, brand]
  - label: Build
    plan: [2026-09-21, 4w]
    fact: [2026-09-21]
    tags: [dev]
    notes: Backend and frontend
  - label: Launch
    plan: [2026-10-26, 2026-10-30]
    tags: [ops, urgent]
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1500, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" and "changed since" not in m.text else None)
    pg.goto(APP); pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(500)

    # ---- page identity
    check(pg.title() == "OpenGantt", "tab title is OpenGantt")
    check(re.fullmatch(r"v\d+\.\d+\.\d+", pg.inner_text("#version")), "the version is shown")
    pkg_version = re.search(r'"version":\s*"([^"]+)"', (ROOT / "package.json").read_text())[1]
    check(pg.inner_text("#version") == f"v{pkg_version}", "the page version comes from package.json")
    check(pg.locator('link[rel="icon"]').count() >= 1 and pg.locator("img.brand").count() == 1, "favicon and brand icon present")

    names = lambda: pg.eval_on_selector_all(".epq-nname", "e=>e.map(x=>x.textContent)")
    pg.click("#tabYaml"); pg.fill(".epq-codearea", DEMO); pg.wait_for_timeout(500)
    check(names() == ["Design", "Wireframes", "Visual design", "Build", "Launch"], "demo chart renders")

    # ---- line numbers
    yaml_text = pg.input_value(".epq-codearea")
    check(pg.eval_on_selector_all(".epq-gutter div", "e=>e.length") == yaml_text.count("\n") + 1, "one line number per line")
    pg.fill(".epq-codearea", "rows:\n  - label: A\n   bad: [unclosed\n"); pg.wait_for_timeout(500)
    check(pg.eval_on_selector_all(".epq-gutter .is-error", "e=>e.map(x=>x.textContent)") == ["3"], "the YAML error line is marked")
    pg.fill(".epq-codearea", DEMO); pg.wait_for_timeout(500)

    # ---- resizable columns, auto fit, persistence
    pg.evaluate("document.querySelector('.epq-chart').scrollLeft=0")
    name_w = lambda: round(pg.eval_on_selector(".epq-nh", "e=>e.getBoundingClientRect().width"))
    auto = name_w()
    g = pg.locator(".epq-nh .epq-resize").bounding_box()
    pg.mouse.move(g["x"] + 3, g["y"] + 20); pg.mouse.down(); pg.mouse.move(g["x"] + 93, g["y"] + 20, steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    check(name_w() == auto + 90, "dragging the grip resizes the name column")
    check(pg.evaluate("JSON.parse(localStorage.getItem('gantt-app:state')).widths.name") == auto + 90, "the width is remembered")
    pg.locator(".epq-nh .epq-resize").dblclick(); pg.wait_for_timeout(250)
    check(name_w() == auto, "double-clicking the grip fits the text again")
    pg.locator(".epq-nh .epq-resize").click(); pg.wait_for_timeout(150)
    check(pg.evaluate("JSON.parse(localStorage.getItem('gantt-app:state')).widths") == {}, "a plain click on the grip changes nothing")
    c0 = pg.locator(".epq-hcol").first; w0 = round(c0.bounding_box()["width"])
    gb = pg.locator(".epq-hcol .epq-resize").first.bounding_box()
    pg.mouse.move(gb["x"] + 3, gb["y"] + 10); pg.mouse.down(); pg.mouse.move(gb["x"] + 73, gb["y"] + 10, steps=5); pg.mouse.up(); pg.wait_for_timeout(200)
    check(round(pg.locator(".epq-hcol").first.bounding_box()["width"]) == w0 + 70, "a table column can be resized")
    pg.reload(); pg.wait_for_timeout(500); pg.evaluate("document.querySelector('.epq-chart').scrollLeft=0")
    check(round(pg.locator(".epq-hcol").first.bounding_box()["width"]) == w0 + 70, "the column width survives a reload")
    pg.click(".epq-gantt-toolbar button:has-text('Columns')"); pg.click(".epq-gantt-popover button:has-text('Fit widths')"); pg.keyboard.press("Escape")

    # ---- sorting
    check(names()[0] == "Design", "starts in YAML order")
    pg.locator(".epq-nh").click(); pg.wait_for_timeout(150)
    check(names() == ["Build", "Design", "Visual design", "Wireframes", "Launch"], "click heading: name ascending, children stay under parents")
    check("\u25B2" in pg.inner_text(".epq-nh"), "an arrow shows the sort direction")
    pg.locator(".epq-nh").click(); pg.wait_for_timeout(150)
    check(names()[0] == "Launch", "click again: descending")
    pg.locator(".epq-nh").click(); pg.wait_for_timeout(150)
    check(names()[0] == "Design", "click a third time: back to the original order")
    pg.click(".epq-gantt-toolbar button:has-text('Sort')"); pg.select_option(".epq-gantt-popover select", "progress"); pg.wait_for_timeout(150)
    check(names()[-1] == "Launch", "rows with nothing in the column go last")
    pg.click(".epq-gantt-popover .epq-seg button:has-text('Descending')"); pg.wait_for_timeout(150)
    check(names()[-1] == "Launch", "blanks stay last in descending order too")
    pg.keyboard.press("Escape"); pg.click(".epq-gantt-toolbar button:has-text('Reset')"); pg.wait_for_timeout(200)

    # ---- tags: filter, labels on bars, tooltip
    check(pg.eval_on_selector_all(".epq-tag-text", "e=>e.length") >= 4, "tag labels are drawn beside the bars")
    pg.select_option(".epq-gantt-filter select", "brand"); pg.wait_for_timeout(150)
    check(names() == ["Design", "Visual design"], "the tag filter keeps matching tasks and their parents")
    pg.select_option(".epq-gantt-filter select", ""); pg.fill(".epq-gantt-filter input", "back"); pg.wait_for_timeout(150)
    check(names() == ["Build"], "the text filter searches notes")
    pg.fill(".epq-gantt-filter input", ""); pg.wait_for_timeout(100)
    bar = pg.locator(".epq-bar-plan").nth(2).bounding_box()
    pg.mouse.move(bar["x"] + bar["width"] / 2, bar["y"] + 6); pg.wait_for_timeout(300)
    check(pg.eval_on_selector_all(".epq-gantt-tip-tag", "e=>e.map(x=>x.textContent)") == ["ui", "brand"], "the tooltip lists the tags")
    check(pg.locator(".epq-gantt-tip-tag svg").count() == 2, "each tag has the tag icon")
    pg.mouse.move(5, 5)

    # ---- visual editor round trip and undo
    pg.click("#tabVisual")
    pg.click(".epq-vis-row:has-text('Launch')"); pg.fill(".epq-vis-name-input", "Go live"); pg.wait_for_timeout(100)
    pg.fill(".epq-vis-taginput", "release"); pg.press(".epq-vis-taginput", "Enter"); pg.wait_for_timeout(100)
    pg.click("button:has-text('+ Add planned range')"); pg.wait_for_timeout(100)
    pg.click("#tabYaml"); pg.wait_for_timeout(200)
    text = pg.input_value(".epq-codearea")
    check("label: Go live" in text and "tags: [ops, urgent, release]" in text, "visual edits are written to the YAML")
    check(text.count("plan:") >= 4, "a planned range was added")
    check("Go live" in names(), "the chart follows the visual editor")
    check(not pg.is_disabled("#undo"), "undo is available after editing")
    pg.click("#undo"); pg.wait_for_timeout(200)
    check("plan: [2026-10-26, 2026-10-30], [" not in pg.input_value(".epq-codearea") and "release" in pg.input_value(".epq-codearea"), "undo reverts the last structural step only")
    for _ in range(4):
        if not pg.is_disabled("#undo"): pg.click("#undo"); pg.wait_for_timeout(100)
    check("Launch" in names(), "undo can go all the way back")
    check(not pg.is_disabled("#redo"), "redo is available")

    # ---- double-click a task: opens it in the visual editor
    pg.click("#tabYaml"); pg.dblclick(".epq-nname:has-text('Build')"); pg.wait_for_timeout(250)
    check(pg.inner_text(".epq-vis-row.is-sel .epq-vis-rowname") == "Build", "double-click selects the task in the visual editor")

    # ---- themes and custom CSS
    pg.click(".epq-gantt-toolbar button:has-text('Theme')"); pg.click(".epq-theme-item:has-text('Nord')"); pg.wait_for_timeout(200)
    check(pg.get_attribute("html", "data-og-theme") == "nord", "the page follows the theme")
    check(pg.evaluate("getComputedStyle(document.querySelector('.epq-gantt-block')).getPropertyValue('--og-bg').trim()") == "#2e3440", "the chart follows the theme")
    pg.click(".epq-theme-item:has-text('Gruvbox light')"); pg.wait_for_timeout(250)
    light = pg.eval_on_selector_all(".epq-nname", "e=>e.map(x=>x.style.color)")
    lightness = [int(re.search(r"rgb\((\d+), (\d+), (\d+)", c).group(2)) for c in light]
    check(all(v < 160 for v in lightness), "name colours stay dark enough on a light theme")
    pg.fill(".epq-css-area", ".epq-gantt-block{--og-accent:#ff00ff}"); pg.wait_for_timeout(500)
    check(pg.evaluate("getComputedStyle(document.querySelector('.epq-gantt-block')).getPropertyValue('--og-accent').trim()") == "#ff00ff", "custom CSS overrides the theme")
    pg.click(".epq-gantt-popover button:has-text('Clear')"); pg.click(".epq-theme-item:has-text('Gruvbox dark')"); pg.keyboard.press("Escape")
    colors = pg.eval_on_selector_all(".epq-nname", "e=>e.map(x=>x.style.color)")
    pg.click(".epq-nh")  # sorting must not change anyone's colour
    check(sorted(colors) == sorted(pg.eval_on_selector_all(".epq-nname", "e=>e.map(x=>x.style.color)")), "each task keeps its colour when sorted")
    pg.click(".epq-nh"); pg.click(".epq-nh")

    # ---- help, about, credits
    pg.click(".epq-gantt-toolbar button:has-text('Help')"); pg.wait_for_timeout(200)
    check(pg.eval_on_selector_all(".epq-dialog-tab", "e=>e.map(x=>x.textContent)") == ["Help", "About", "Credits"], "help has three tabs")
    pg.click(".epq-dialog-tab:has-text('About')")
    check(f"Version {pkg_version}" in pg.inner_text(".epq-dialog-body"), "About shows the version")
    pg.click(".epq-dialog-tab:has-text('Credits')")
    check("js-yaml" in pg.inner_text(".epq-dialog-body"), "Credits lists js-yaml")
    pg.keyboard.press("Escape")
    check(pg.locator(".epq-dialog").count() == 0, "Esc closes the dialog")

    # ---- resizable split pane
    sp = pg.locator("#split").bounding_box(); w0 = pg.eval_on_selector("#editorWrap", "e=>e.getBoundingClientRect().width")
    pg.mouse.move(sp["x"] + 3, sp["y"] + 200); pg.mouse.down(); pg.mouse.move(sp["x"] + 133, sp["y"] + 200, steps=5); pg.mouse.up(); pg.wait_for_timeout(200)
    check(round(pg.eval_on_selector("#editorWrap", "e=>e.getBoundingClientRect().width") - w0) == 130, "the editor / chart divider can be dragged")

    check(errors == [], f"no console errors ({errors[:2]})")

    # ---- the Obsidian-style edit dialog and writing back into a note (fake vault)
    html = (ROOT / "dist" / "Gantt.html").read_text(encoding="utf8")
    harness = r'''
import Plugin from "gantt-main";
const plugin = new Plugin(); await plugin.onload(); window.plugin = plugin;
window.note = "# Title\n\n```gantt\nrows:\n  - label: A\n    plan: [2026-09-01, 2026-09-05]\n```\n\nAfter text\n";
window.__app.vault.getAbstractFileByPath = (p) => ({ path: p });
window.__app.vault.process = async (f, fn) => { window.note = fn(window.note); };
const src = "rows:\n  - label: A\n    plan: [2026-09-01, 2026-09-05]";
plugin.processors.gantt(src, document.getElementById("chart").appendChild(document.createElement("div")), {
  sourcePath: "n.md", getSectionInfo: () => ({ lineStart: 2, lineEnd: 6 }), addChild(c) { c.load(); window.block = c; } });
window.ready = true;
'''
    (pathlib.Path("/tmp") / "og-obsidian-harness.html").write_text(html.replace('import "gantt-shell";', harness), encoding="utf8")
    pg2 = b.new_page(viewport={"width": 1300, "height": 800})
    pg2.goto("file:///tmp/og-obsidian-harness.html"); pg2.wait_for_function("window.ready===true"); pg2.wait_for_timeout(300)
    pg2.click(".epq-gantt-toolbar button:has-text('Edit')"); pg2.wait_for_timeout(200)
    check(pg2.inner_text(".epq-dialog-title") == "Edit chart", "Edit opens the dialog in Obsidian")
    pg2.click(".epq-dialog-tab:has-text('YAML')")
    pg2.fill(".epq-codearea", "rows:\n  - label: A\n    plan: [2026-09-01, 2026-09-05]\n  - label: Second\n    tags: [x]\n")
    pg2.click(".epq-dialog-foot button:has-text('Save to note')"); pg2.wait_for_timeout(300)
    note = pg2.evaluate("window.note")
    check("label: Second" in note and note.startswith("# Title\n\n```gantt\n") and note.endswith("```\n\nAfter text\n"), "Save writes only the block, the rest of the note is untouched")
    pg2.evaluate("window.note = window.note.replace('label: A', 'label: A-edited-elsewhere')")
    pg2.click(".epq-gantt-toolbar button:has-text('Edit')"); pg2.wait_for_timeout(200)
    pg2.click(".epq-dialog-tab:has-text('YAML')"); pg2.fill(".epq-codearea", "rows:\n  - label: Z\n")
    pg2.click(".epq-dialog-foot button:has-text('Save to note')"); pg2.wait_for_timeout(300)
    note = pg2.evaluate("window.note")
    check("A-edited-elsewhere" in note and "label: Z" not in note, "a stale note is refused, not overwritten")
    check(pg2.locator(".epq-dialog").count() == 1, "the dialog stays open after a refused save")
    b.close()

print(f"browser tests passed ({passed} checks)")
