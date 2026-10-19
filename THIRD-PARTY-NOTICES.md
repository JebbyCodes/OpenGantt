# Third-party notices

OpenGantt itself is released into the public domain (see `LICENSE`). It includes or builds on the software below.

## Bundled in the standalone app

### js-yaml 4.1.1 (`vendor/js-yaml.min.js`)

<https://github.com/nodeca/js-yaml> - MIT License

```
(The MIT License)

Copyright (C) 2011-2015 by Vitaly Puzrin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Desktop app and build tools

* **Tauri** - <https://tauri.app> - Apache-2.0 or MIT. Used for the desktop shell (compiled into the `.exe`, not part of the web files).
* **esbuild** - <https://esbuild.github.io> - MIT. Used only to build the Obsidian plugin.

## Hosts

* **Obsidian** - <https://obsidian.md>. OpenGantt is a plugin for it and uses its public plugin API.

## Colour palettes

The built-in themes re-create the colours of these palettes. No code from them is included.

| Theme | Palette | Author | Licence |
| --- | --- | --- | --- |
| Gruvbox dark / light | Gruvbox | Pavel Pertsev | MIT |
| Nord | Nord | Arctic Ice Studio / Sven Greb | MIT |
| Dracula | Dracula | Zeno Rocha and contributors | MIT |
| Solarized dark / light | Solarized | Ethan Schoonover | MIT |

## Fonts and icons

No font files or icon sets are bundled. Text uses the system or Obsidian interface font. The tag icon and the logo are part of OpenGantt.
