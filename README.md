# Webwriter

A writing application for one long book, in the browser. It is a Node.js port of
[Bookwriter](../bookwriter), the native macOS app, and reads and writes the same book folders byte
for byte, so both can work on the same book. `../bookwriter/specs/ARCHITECTURE.md` describes every
feature, and `../bookwriter/specs/FILE-FORMATS.md` the `book.json` and `comments.json` files.

## Running

Needs Node.js 20 or later.

```
npm install
npm start                      # reopens the last book
node bin/webwriter.js ~/my-book   # opens this book folder
```

The server listens on `127.0.0.1:4848` (or the next free port) and opens a window: an app-style
window in Chrome, Edge, Brave, or Chromium when one is installed, otherwise the default browser. A
folder with no manuscript becomes an empty book. Closing the last window stops the server.

| Option | Meaning |
|---|---|
| `--port N` | Listen on port N. |
| `--no-open` | Do not open a window. |
| `--keep-running` | Keep running after the last window closes. |

`npm link` installs a `webwriter` command.

## Following changes on disk

The server watches the book folder. Changes that other programs, such as AI agents, editors, or
git, make to `manuscript/`, `book.json`, or `comments.json` reach the page within about a second:

- the outline, title, header form, editor, and rendered views reload;
- comments are merged by id, and a comment written with only its `quote` is placed and written back;
- unsaved typing is never overwritten. When the open text changed on disk too, a bar asks which
  version to keep, and nothing is written until the writer chooses;
- a `comments.json` that cannot be read is never written over.

## Checking a book

Agents and scripts that edit `book.json` or `comments.json` can check their work with the code the
app uses. It prints errors and warnings and exits with 1 when there are errors.

```
node bin/webwriter.js check /path/to/book
```

## Differences from the macOS app

Where the native app uses a macOS convention, Webwriter uses the closest one a web page has:

- **Menus** are a menu bar inside the page. Browsers keep ⌘N and ⇧⌘N for themselves, so New Text is
  also ⌥⌘N and New Folder ⌥⇧⌘N. On Windows and Linux, ⌘ is Ctrl.
- **Open, save, and folder panels** browse the server's folders, since the page cannot see the disk.
  The Picture command moves a file from there into `images/`, or takes an upload from the browser's
  computer.
- **Export PDF** opens a print view of the manuscript on Letter pages with page numbers; choose
  "Save as PDF" in the print dialog. The suggested file name is the timestamped export name.
- **Export Chapters to Word** runs Pandoc on the server, as the native app does.
- **Preferences** (last book, recent books, review author, comment color) are kept in
  `~/.config/webwriter/preferences.json` (`WEBWRITER_PREFS` overrides the path).

## Layout

| Path | What it is |
|---|---|
| `bin/webwriter.js` | The command: starts the server and opens a window, or runs `check`. |
| `src/server/` | The book folder on disk: headers, loading and saving, moves, `book.json`, comments, pictures, Pandoc, watching, and the HTTP API. |
| `shared/` | Code the server and the page share: the tree, export, fences, comments (format, anchors, merging), and the markup commands and find. |
| `public/` | The page. `js/model.js` is the open book (the port of `BookModel`), `js/render.js` renders Markdown with body offsets, `js/rendered.js` makes the preview and reading view typeable, `js/editor.js` is the CodeMirror editor. |
| `test/` | Tests, including the export parity tests against Bookwriter's fixtures. |

## Tests

```
npm test
```

The parity tests in `test/core.test.js` load the two fixture books copied from Bookwriter and
require the export to match `*.expected.md` and `*.expected.txt` byte for byte.
