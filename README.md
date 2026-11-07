# Webwriter

A writing application for one long book, in the browser. A book is a folder of plain files: a tree
of Markdown files and folders for the text, and small JSON files for the title, the comments, and the
tag colors. A Node.js server reads and writes the folder, and the page shows the outline, an editor,
and the rendered text.

## Running

Needs Node.js 22.15 or later.

```
npm install
npm start                      # reopens the last book
node bin/webwriter.js ~/my-book   # opens this book folder
```

The server listens on `127.0.0.1:4848` (or the next free port) and opens a window: an app-style
window in Chrome, Edge, Brave, or Chromium when one is installed (on Linux, when it is on the
`PATH`), otherwise the default browser. A
folder with no manuscript becomes an empty book. Closing the last window stops the server. When the
server is started again, windows still open from before reconnect on their own within a few seconds
and load the page again, and no new window is opened.

The example book, `examples/mybook`, shows what Webwriter can do: `node bin/webwriter.js
examples/mybook`. Other books made in `examples/`, such as with New Book, are left out of git.

**New Book…** (File menu, or the No Book Open screen) asks where the book goes and for its name,
makes a folder with that name holding `book.json` (the name is the title), `manuscript/`, the
trash, and `AGENTS.md`, and opens it. A folder that is already there is used only when it is empty.
`AGENTS.md` tells AI agents how the book's files work (pieces and their headers, `book.json`,
`comments.json`, `tags.json`), so an agent can edit the book from outside while Webwriter shows the
changes; the template is `src/server/new-book-agents.md`.

| Option | Meaning |
|---|---|
| `--port N` | Listen on port N, and stop if it is taken. `WEBWRITER_PORT` does the same. |
| `--no-open` | Do not open a window. |
| `--keep-running` | Keep running after the last window closes. |
| `--drawio-url URL` | The draw.io editor for diagrams (default: the copy in `vendor/drawio/`, else `https://embed.diagrams.net/`). |
| `-h`, `--help` | Show the options. |

`npm link` installs a `webwriter` command.

## Following changes on disk

The server watches the book folder. Changes that other programs, such as AI agents, editors, or
git, make to `manuscript/`, `book.json`, `comments.json`, `tags.json`, or `images/` reach the page
within about a second:

- the outline, title, header form, editor, and rendered views reload;
- comments are merged by id, and a comment written with only its `quote` is placed and written back
  (by an open window, so the next window to open does it when none is);
- tag colors and pictures, diagrams among them, are drawn again;
- unsaved typing is never overwritten. When the open text changed on disk too, a bar asks which
  version to keep, and nothing is written until the writer chooses;
- comments saved while another program writes `comments.json` are merged with its changes, not
  written over them;
- a `comments.json` or `tags.json` that cannot be read is never written over.

When the folder cannot be watched, such as after it was moved or when the system has no watches
left, a bar says so. Webwriter tries again every few seconds and, once it can, reads the book again
for the changes it missed.

## Tables

Pipe tables (`| a | b |`) can be edited in the Markdown editor:

| Key | In a table |
|---|---|
| Tab | Next cell, selecting its text; after the last cell, a new row. Lines the table up. |
| Shift+Tab | Previous cell. |
| Enter | Same column in the next row, adding one at the end. On an empty last row, leaves the table. |
| Shift+Enter | A new line, as usual. |

Markup → Table, the table button at the end of the markup bar, the command palette, and the
editor's right-click menu have Insert Table, Format Table, Insert Row Above/Below, Insert Column
Left/Right, Delete Row/Column, and the column alignments. Right-clicking a cell in the preview or a
reading view offers the row, column, and alignment commands for that cell. Only the table's own
lines change. Lining up a table changes the spaces in it, so comments inside it find their words
again, even when the quote's spacing changed. Table rows are monospaced in the editor so the
columns line up on screen.

## Tags

A tag is a colored label in the text, written as a Pandoc span with the class `tag`:

```markdown
This scene is [draft]{.tag} and needs a [fact check]{.tag color=red}.
```

The preview, the reading views, and the PDF draw each tag as a pill in its color. Word files shade
it in its color through a Pandoc filter (`src/server/tags.lua`). The exported Markdown keeps the span
as written, which Pandoc reads as plain text. In the editor, the tag's name is tinted in its color.

The book's tag colors are in `tags.json`, beside `book.json`:

```json
{
  "tags" : {
    "draft" : "green"
  },
  "version" : 1
}
```

Colors are `yellow`, `orange`, `red`, `pink`, `purple`, `blue`, `teal`, `green`, `gray`, or `#RRGGBB`.
Tag names match without regard to case. A tag's own `color=` wins over `tags.json`, and a tag that
has neither gets a color picked from its name. Markup → Tag… (⌥⌘T), the tag button in the markup
bar, and the palette insert a tag, with the book's tags to choose from. Markup → Tag Colors…, or
right-clicking a tag in the preview, changes colors. Changes to `tags.json` by other programs show
within about a second, and a `tags.json` that cannot be read is never written over.

## Diagrams

Diagrams are drawn in [draw.io](https://www.drawio.com) and kept as editable SVG files in `images/`
(`name.drawio.svg`): an SVG picture with the draw.io diagram stored inside it. The text refers to one
like any picture, `![The book folder](images/book-folder.drawio.svg){width=90%}`, so it shows in the
preview, the reading views, the PDF, and Word.

- **Insert Diagram** (Markup menu, markup bar, palette) asks for a name and opens draw.io over the
  window. The first save writes `images/<name>.drawio.svg` and puts the picture at the cursor.
- **Edit Diagram…**, from right-clicking a diagram in the preview or a reading view, or from
  right-clicking its picture mark in the editor, or double-clicking it, opens it in draw.io. Saving
  writes the same file, and the views draw it again.
- A diagram changed by another program, such as draw.io desktop or its VS Code extension, is drawn
  again within about a second.

The editor is draw.io itself, in its embed mode. draw.io's web app (a pinned release of
`jgraph/drawio`, checked against its published SHA-256) is kept in the repository in
`vendor/drawio/`, so nothing needs downloading, and Webwriter serves it at `/drawio/`. Diagrams are
then edited from Webwriter's own address, so no browser setting or ad blocker treats draw.io as a
third party, and it works without the internet. `npm run fetch-drawio` downloads it again if it is
missing. Without it, Webwriter falls back to draw.io's site, `https://embed.diagrams.net/`;
`--drawio-url` (or `WEBWRITER_DRAWIO_URL`) names another copy.

When a diagram is saved, Webwriter keeps draw.io's SVG in its light colors (draw.io writes colors for
both light and dark mode, and a browser in dark mode would draw it dark on the white page) and drops
draw.io's "Text is not SVG" note, which only Word would show.

### Mermaid diagrams

A diagram can also be written as text, in [Mermaid](https://mermaid.js.org) syntax, in a `mermaid`
code fence:

````markdown
```mermaid
flowchart LR
  Idea --> Draft --> Revision --> Book
```
````

The preview, the reading views, and the PDF draw it where it stands; a fence Mermaid cannot read
shows its text with Mermaid's message. A diagram is as wide as Mermaid draws it, up to the text
width; `` ```mermaid {width=50%} `` sets its width as for a picture, which other Markdown programs
ignore. **Insert Mermaid Diagram** (Markup menu, palette) puts a fence
around the selection, or a small flowchart to start from. The exported Markdown keeps the fence as
written, which other Markdown programs such as GitHub draw too. Pandoc cannot draw Mermaid, so for
the Word exports the page draws each diagram as a picture and sends it along; a diagram that cannot
be drawn stays code, with a warning. Mermaid comes with `npm install` and is served from Webwriter's
own address, so it works without the internet.

## Index

An index is a text that lists every piece after it in the book, numbered by its place in the
outline and indented by depth:

```
1  Getting Started
    1.1  Find and Replace
        1.1.1  The Editor
            1.1.1.1  The Outline
    ...
2  Finishing
```

**New Index** (File menu, the ＋ button, or right-clicking the book row in the outline) asks for a
title, Index unless changed, and adds the index first in the book, so it lists everything. Drag it
anywhere: it lists the pieces after it. In a folder, those are its later siblings, then whatever
follows the folder. The trash is left out.

The index is an ordinary text whose body holds an `index` code fence, which may have text around it:

````markdown
Everything after this page, numbered.

```index
```
````

The list is made from the outline each time the book is shown or exported, so renaming, moving, or
adding pieces never leaves it stale. In the preview and the reading views a click on an entry opens
that piece. The exported Markdown, the PDF, and Word write the list out as numbered lines. Other
Markdown programs show the fence as an empty code block. The example book's Contents page is an
index.

## Word export

Both Word exports run [Pandoc](https://pandoc.org) on the server, which must be installed (for
example `brew install pandoc`):

- **Export Word…** (File menu) writes the whole manuscript, as Export Manuscript makes it, into one
  `.docx`, saved where you choose under the timestamped export name.
- **Export Chapters to Word…** writes one `.docx` for each front-matter piece and each chapter into a
  folder.

Pictures, diagrams (Mermaid diagrams as pictures), and tags (shaded in their colors) come along. A
Pandoc filter (`src/server/breaks.lua`) turns the export's page breaks into Word page breaks, and its part and
chapter numbers ("Part 1", "Chapter 3") into centered, bold paragraphs, which Word would otherwise
drop.

## Checking a book

Agents and scripts that edit `book.json`, `comments.json`, or `tags.json` can check their work with the code the
app uses. It prints errors and warnings and exits with 1 when there are errors.

```
node bin/webwriter.js check /path/to/book
```

## Working in a browser

Webwriter runs in a web page, which settles a few things:

- **Menus** are a menu bar inside the page. Browsers keep ⌘N and ⇧⌘N for themselves, so New Text is
  also ⌥⌘N and New Folder ⌥⇧⌘N. On Windows and Linux, ⌘ is Ctrl, with two changes: Tag is
  Ctrl+Alt+Shift+T, as many Linux desktops open a terminal on Ctrl+Alt+T, and Add Comment (⌃⌘M) is
  Ctrl+Alt+M.
- **Open, save, and folder panels** browse the server's folders, since the page cannot see the disk.
  The Picture command moves a file from there into `images/`, or takes an upload from the browser's
  computer.
- **Export PDF** opens a print view of the manuscript on Letter pages with page numbers; choose
  "Save as PDF" in the print dialog. The suggested file name is the timestamped export name.
- **Export Word** and **Export Chapters to Word** run Pandoc on the server (see
  [Word export](#word-export)).
- **Preferences** (last book, recent books, review author, comment color) are kept in
  `~/.config/webwriter/preferences.json` (`WEBWRITER_PREFS` overrides the path).

## Layout

| Path | What it is |
|---|---|
| `bin/webwriter.js` | The command: starts the server and opens a window, or runs `check`. |
| `src/server/` | The book folder on disk: headers, loading and saving, moves, `book.json`, comments, pictures, Pandoc and its filters, watching, preferences, `check`, the `AGENTS.md` template for new books, and the HTTP API. |
| `shared/` | Code the server and the page share: the tree, moves, export, fences, the index, comments (format, anchors, merging), tags, draw.io and Mermaid diagrams, the markup commands and find, and table editing. |
| `public/` | The page. `js/model.js` is the open book, `js/render.js` renders Markdown with body offsets, `js/rendered.js` makes the preview and reading view typeable, `js/editor.js` is the CodeMirror editor. |
| `test/` | Tests, including the export tests against the fixture books in `test/fixtures/`. |
| `examples/mybook/` | The example book. |
| `vendor/drawio/` | draw.io's web app, served at `/drawio/`. |
| `scripts/` | `fetch-drawio.mjs` downloads draw.io into `vendor/drawio/`; `make-sample-diagram.mjs` writes the example book's sample diagram. |

## Tests

```
npm test
```

The export tests in `test/core.test.js` load the two fixture books in `test/fixtures/` and require
the export to match `*.expected.md` and `*.expected.txt` byte for byte. GitHub Actions runs the tests
on every push, on Linux and macOS with Node.js 22 and 24, with Pandoc installed for the Word export
tests (`.github/workflows/test.yml`). Without Pandoc, those tests are skipped.

## License

Webwriter is licensed under either of

- the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)), or
- the MIT License ([LICENSE-MIT](LICENSE-MIT)),

at your option. draw.io in `vendor/drawio/` keeps its own license (Apache 2.0).
