"""Regenerates the README screenshots from the built standalone app.

    npm run build:app
    python3 scripts/screenshots.py

Needs Python with Playwright and Chromium (pip install playwright && playwright install chromium) and Pillow.
The date is frozen, so the pictures are the same every time.
"""
import pathlib, sys
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / "dist" / "Gantt.html").as_uri()
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

FROZEN = "2026-10-14T09:00:00Z"
FREEZE = """
(() => { const T = new Date('%s').getTime(); const R = Date;
  class D extends R { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }
  window.Date = D; })();
""" % FROZEN

DEMO = """title: Website relaunch
scale: day
weekends: true
padding: 2
columns: [owner, progress]
markers:
  - date: 2026-10-28
    label: Launch
rows:
  - label: Discovery
    plan: [2026-09-28, 2026-10-02]
    fact: [2026-09-28, 2026-10-02]
    owner: Ana
    tags: [research]
    children:
      - label: Interviews
        plan: [2026-09-28, 3d]
        fact: [2026-09-28, 2026-09-30]
        owner: Ana
        tags: [research, users]
      - label: Content audit
        plan: [2026-09-30, 3d]
        fact: [2026-09-30, 2026-10-02]
        owner: Mo
  - label: Design
    plan: [2026-10-05, 2026-10-14]
    fact: [2026-10-05, 2026-10-08], [2026-10-12, 2026-10-15]
    owner: Ben
    tags: [ui, review]
    notes: Paused for a week while the brand guidelines were revised.
    children:
      - label: Wireframes
        plan: [2026-10-05, 3d]
        fact: [2026-10-05, 2026-10-08]
        owner: Ben
        tags: [ui]
      - label: Visual design
        plan: [2026-10-08, 2026-10-14]
        fact: [2026-10-12, 2026-10-15]
        owner: Ben
        tags: [ui, brand]
  - label: Build
    plan: [2026-10-12, 2026-10-26]
    fact: [2026-10-13]
    owner: Cleo
    tags: [dev]
    children:
      - label: Frontend
        plan: [2026-10-12, 2026-10-21]
        fact: [2026-10-13]
        owner: Cleo
        tags: [dev, ui]
      - label: Backend
        plan: [2026-10-12, 2026-10-26]
        fact: [2026-10-12, 2026-10-14], [2026-10-19]
        owner: Dev
        tags: [dev]
        color: "#d3869b"
  - label: Launch
    plan: [2026-10-27, 2026-10-28]
    owner: Dev
    tags: [ops, urgent]
"""

def fresh(p, w=1800, h=1000):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.add_init_script(FREEZE)
    pg.goto(APP); pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(500)
    return b, pg

def load_demo(pg):
    pg.click("#tabYaml"); pg.fill(".epq-codearea", DEMO); pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('.epq-chart').scrollLeft = 0")

def theme(pg, name):
    pg.click(".epq-gantt-toolbar button:has-text('Theme')"); pg.wait_for_timeout(150)
    pg.click(f".epq-theme-item:has-text('{name}')"); pg.wait_for_timeout(250)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(100)

with sync_playwright() as p:
    # 1. The whole app: visual editor on the left, chart on the right.
    b, pg = fresh(p)
    load_demo(pg)
    pg.click("#tabVisual"); pg.wait_for_timeout(200)
    pg.click(".epq-vis-row:has-text('Design')"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "overview.png"))
    # 2. The visual editor, close up (task form open).
    pg.locator("#editorWrap").screenshot(path=str(OUT / "visual-editor.png"))
    # 3. The YAML editor with line numbers.
    pg.click("#tabYaml"); pg.wait_for_timeout(200)
    pg.evaluate("const t=document.querySelector('.epq-codearea'); t.scrollTop=0; t.focus(); const at=t.value.indexOf('- label: Design'); t.setSelectionRange(at,at); t.dispatchEvent(new Event('select'))")
    pg.wait_for_timeout(150)
    pg.locator("#editorWrap").screenshot(path=str(OUT / "yaml-editor.png"))
    # 4. A tag tooltip.
    pg.click("#tabVisual")
    box = pg.locator("#chart").bounding_box()
    bar = pg.locator(".epq-bar-plan").nth(4).bounding_box()   # Wireframes
    pg.mouse.move(bar["x"] + bar["width"] / 2, bar["y"] + bar["height"] / 2); pg.wait_for_timeout(350)
    pg.screenshot(path=str(OUT / "tooltip-tags.png"), clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": 620})
    pg.mouse.move(5, 5)
    # 5. Sorting: click a heading, the arrow and the order change; grip visible on hover.
    pg.click(".epq-hcol:has-text('Progress')"); pg.wait_for_timeout(250)
    h = pg.locator(".epq-hcol:has-text('Owner')").bounding_box()
    pg.mouse.move(h["x"] + h["width"] - 2, h["y"] + 20); pg.wait_for_timeout(200)
    pg.screenshot(path=str(OUT / "sort-resize.png"), clip={"x": box["x"], "y": box["y"] + 100, "width": 760, "height": 330})
    pg.click(".epq-hcol:has-text('Progress')"); pg.click(".epq-hcol:has-text('Progress')")
    # 6. Help dialog.
    pg.click(".epq-gantt-toolbar button:has-text('Help')"); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "help.png"))
    pg.keyboard.press("Escape")
    # 7. Themes: the chart in four of them, side by side.
    shots = []
    for name in ["Nord", "Dracula", "Solarized light", "Paper"]:
        theme(pg, name)
        f = OUT / f"_theme-{name.split()[0].lower()}.png"
        pg.locator("#chart").screenshot(path=str(f)); shots.append(f)
    theme(pg, "Gruvbox dark")
    # 8. Theme picker open
    pg.click(".epq-gantt-toolbar button:has-text('Theme')"); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "theme-picker.png"), clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": 520})
    b.close()

# montage of the four themes (2 x 2)
ims = [Image.open(f).convert("RGB") for f in shots]
w, h = 780, 470
tiles = [im.crop((0, 100, im.width, min(im.height, 100 + int(im.width * h / w)))).resize((w, h), Image.LANCZOS) for im in ims]
sheet = Image.new("RGB", (w * 2 + 12, h * 2 + 12), (24, 24, 24))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 2) * (w + 12), (i // 2) * (h + 12)))
sheet.save(OUT / "themes.png", optimize=True)
for f in shots: f.unlink()
print("wrote", sorted(x.name for x in OUT.glob("*.png")))
