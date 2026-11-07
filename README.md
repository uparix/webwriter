# Webwriter

A writing application for one long book, such as a novel, a manual, or a thesis, that runs in the
browser. The book is not a single document but a folder of plain files: each chapter, section, or
scene is a Markdown file, and folders group them into parts and chapters. Webwriter shows that
folder as an outline, an editor, and the rendered book, and exports it to PDF, Word, Markdown, and a
web page.

![Webwriter with the example book open: the outline on the left, the Markdown editor and the
rendered text in the middle, and review comments on the right](docs/webwriter.png)

Because the book is plain files:

- it can be kept in git, and every change shows up in a diff;
- AI agents, scripts, and other editors can work on it while Webwriter is open, and Webwriter shows
  their changes within about a second, without overwriting unsaved typing;
- nothing is locked in: the text is Markdown that Pandoc and other programs read.

Webwriter is a small Node.js server, which reads and writes the book folder, and a page in the
browser, which is the app. There is no build step, and the only dependencies are CodeMirror and
Mermaid.

## Trying it

Needs Node.js 22.15 or later.

```
git clone https://github.com/uparix/webwriter.git
cd webwriter
npm install
node bin/webwriter.js examples/mybook
```

The example book, `examples/mybook`, is a short book about Webwriter, written with Webwriter: each
chapter shows a feature and uses it. Reading it is the quickest way to see what Webwriter does.

In the window:

- **Select a text** in the outline to write it: the Markdown editor, and beside it the rendered
  preview, which can be typed in too. The **Markup** button (⇧⌘M) shows or hides that second pane.
  The form under the outline edits the text's title, synopsis, and how it is laid out (see
  [The book on disk](#the-book-on-disk)).
- **Select a folder, or the book row** at the top, to read it straight through, as it will print.
- **Comments**, at the top right, shows the review comments. Select words and choose Review → Add
  Comment to make one.
- **Help → Markup Reminder** lists the Markdown that Webwriter understands.

## Running

```
npm start                         # reopens the last book, or shows No Book Open
node bin/webwriter.js ~/my-book   # opens this book folder
```

The server listens on `127.0.0.1:4848` (or the next free port) and opens a window: an app-style
window in Chrome, Edge, Brave, or Chromium when one is installed (on Linux, when it is on the
`PATH`), otherwise the default browser. A
folder with no manuscript becomes an empty book. Closing the last window stops the server. When the
server is started again, windows still open from before reconnect on their own within a few seconds
and load the page again, and no new window is opened.

A window signs in when it opens. Webwriter starts it at an address with a key,
`http://127.0.0.1:4848/?key=…`, which it swaps for a cookie, so other programs and other users on the
same computer cannot use the book through it. The address is printed when Webwriter starts. The cookie
holds a secret kept in `~/.config/webwriter/session-key`, readable only by you, so windows stay signed
in when Webwriter starts again. A page opened at the bare address asks you to use the printed one.

Other books made in `examples/`, such as with New Book, are left out of git.

**New Book…** (File menu, or the No Book Open screen) asks where the book goes and for its name,
makes a folder with that name holding `book.json` (the name is the title), `manuscript/`, the
trash, and `AGENTS.md`, and opens it. A folder that is already there is used only when it is empty.
`AGENTS.md` tells AI agents how the book's files work (pieces and their headers, `book.json`,
`comments.json`, `tags.json`), so an agent can edit the book from outside while Webwriter shows the
changes; the template is `src/server/new-book-agents.md`.

| Option | Meaning |
|---|---|
| `--port N` | Listen on port N, and stop if it is taken. `WEBWRITER_PORT` does the same. |
| `--no-open` | Do not open a window. Open the printed address, with its key, instead. |
| `--keep-running` | Keep running after the last window closes. |
| `--drawio-url URL` | The draw.io editor for diagrams (default: the copy in `vendor/drawio/`, else `https://embed.diagrams.net/`). |
| `-h`, `--help` | Show the options. |

`npm link` installs a `webwriter` command. [Pandoc](https://pandoc.org) is needed only for the Word
exports.

## Words used here

| Word | Meaning |
|---|---|
| **Book** | A folder holding `book.json` and `manuscript/`. Webwriter has one book open at a time. |
| **Outline** | The tree on the left. Each row is a file or folder in `manuscript/`, in book order. |
| **Piece** | Any row of the outline: a text or a folder. |
| **Text** | A piece that is one Markdown file, such as `020-arrival.md`. New Text makes one. |
| **Folder** | A piece that holds other pieces. It has text of its own, in its `_index.md`. New Folder makes one. |
| **Header** | The lines between `---` at the top of a piece's file: its id, title, synopsis, status, role, and unit. |
| **Body** | A piece's text after its header. |
| **Unit** | How a piece is laid out: `part`, `chapter`, `section`, or `text`. See [How the book is laid out](#how-the-book-is-laid-out). |
| **Role** | `body`, or `front` for front matter, which is never numbered. |
| **Status** | Where a piece stands: `idea`, `draft`, `revise`, or `done`. Shown in the outline. |
| **Synopsis** | One line about a piece, shown under its title in the outline and never printed. |
| **Trash** | `manuscript/trash/`. Deleted pieces go there and are left out of the book until the trash is emptied. |
| **Preview** | The rendered text of the selected text, beside the editor. |
| **Reading view** | The rendered text of a folder or the whole book, straight through. |
| **Manuscript** | The book as it is exported: every piece in order, with its title as a heading, the trash left out. |

"Section" and "text" each have two meanings, which are easy to mix up. As a **unit**, `section`
starts a new page and `text` runs on. As a **piece**, a text is a single file. In the code, a text
is a node of kind `section` and a folder a node of kind `group`.

## The book on disk

```
my-book/
  book.json            the title
  manuscript/          the text: a tree of folders and Markdown files
    010-opening.md     a text
    020-part-one/      a folder, which holds pieces and has text of its own
      _index.md        the folder's header and text
      010-arrival.md
      020-the-ferry.md
    trash/             deleted pieces, not part of the book
  comments.json        review comments (missing when there are none)
  tags.json            tag colors (optional)
  images/              pictures and draw.io diagrams
  AGENTS.md            how these files work, for AI agents
```

The number prefix (`010-`, `020-`, in steps of 10, at least three digits) sets the order among
siblings; the rest of the name is a slug of the title. Webwriter renames files and folders when
pieces are moved, so a piece is known by its `id`, never by its file name.

A text, or a folder's `_index.md`, starts with a header, then the body:

```markdown
---
id: arrival
title: "Arrival: the first night"
synopsis: Mara reaches the harbor town.
status: draft
role: body
unit: chapter
---
The ferry was late.[^1]

# The harbor

[^1]: It always is.
```

| Field | Values |
|---|---|
| `id` | Unique in the book, lowercase words joined by hyphens. It never changes; comments point at it. |
| `title`, `synopsis` | One line each. Quoted when they hold characters other than letters, digits, spaces, and `. , ' _ -`. |
| `status` | `idea`, `draft`, `revise`, or `done`. |
| `role` | `body`, or `front` for front matter. |
| `unit` | `part`, `chapter`, `section`, or `text`. |

The body is Pandoc Markdown. The title is not repeated in it: Webwriter prints the title as the
piece's heading, and a `#` heading in the body is a subsection under it. Footnote labels belong to
their file, so two texts can each have a `[^1]`. `AGENTS.md` in each new book has the full rules for
programs that write these files, `comments.json` and `tags.json` included.

### How the book is laid out

The manuscript is every piece in outline order, each one's title as a heading and then its body.
The header decides the rest:

```
manuscript/
  010-front-matter/     role: front     no numbers, for it or anything inside it
  020-contents.md       unit: section   starts a page
  030-part-one/         unit: part      "Part 1", starts a page
    010-arrival.md      unit: chapter   "Chapter 1", starts a page
    020-the-ferry.md    unit: text      runs on after Chapter 1
  040-part-two/         unit: part      "Part 2"
    010-the-town.md     unit: chapter   "Chapter 2": chapters count through the whole book
```

- **Numbers.** Parts and chapters are numbered in book order, each with its own count, and
  chapters do not start again at 1 in a new part. The numbers are worked out each time and never
  stored, so moving a chapter renumbers the book.
- **Front matter.** A piece with role `front`, or anything inside a folder with role `front`, takes
  no number, whatever its unit.
- **Pages.** A part, a chapter, or a section starts a new page in the PDF and Word; a text runs on
  after the piece before it. A piece with no unit is a section when it is a folder and a text when
  it is a file. `<div class="page-break"></div>` on a line of its own breaks the page anywhere.
- **Headings.** A piece's title is a heading one level deeper than its folder's: a top-level piece is
  `#`, a piece inside one folder `##`, and so on. Headings in the body move down by the same amount,
  up to `######`.
- **Notes.** Footnotes print at the end of the front matter, at the end of each chapter, or after a
  piece that is in neither.

## Writing

The body of a piece is Markdown, with Pandoc's footnotes and attributes. Help → Markup Reminder
lists it; the Markup menu, the markup bar, and the command palette (⌘K) insert it. Most commands
switch on and off: a second click on Bold, Italic, Inline code, a subsection, a list, a quotation, or
an alignment takes off what the first put on, and a list or subsection of the other kind is changed
instead. Link, Picture, Code block, and Footnote insert again each time. Beyond plain
Markdown, Webwriter has tables that can be edited cell by cell, alignment, tags, diagrams, and an
index.

### Tables

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

### Alignment

**Align Left**, **Center**, and **Align Right** (Markup menu, markup bar, palette) set text,
pictures, and diagrams to one side. Each wraps lines in a Pandoc fenced div:

```markdown
::: center
![The book folder](images/book-folder.drawio.svg){width=60%}

*The book folder*
:::
```

With nothing selected, a command wraps the paragraph at the cursor, or the whole fenced block when
the cursor is in one, so a Mermaid diagram moves as one piece. With a selection, it wraps every line
the selection touches. On a blank line it inserts an empty block with the cursor inside. Inside a
block already set to that side, the command takes the block away again; inside one set to another
side, it changes the side. `::: left`,
`::: center`, and `::: right` can also be typed by hand, and nested: a `::: left` inside a centered
block sets a note under a centered picture back to the left.

A picture moves only when it is narrower than the text, so change the Picture command's
`{width=100%}` to a smaller width. Code blocks stay set to the left. The preview, the reading views,
the PDF, the web page, and Word all align the block; text does not flow around a picture.

### Tags

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

### Diagrams

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

#### Mermaid diagrams

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

### Index

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

## Exporting and publishing

The File menu exports the manuscript, as laid out in [How the book is laid out](#how-the-book-is-laid-out):

- **Export Manuscript…** (⇧⌘E) writes it as one Pandoc Markdown file.
- **Export PDF…** opens a print view on Letter pages with page numbers; choose "Save as PDF" in the
  print dialog. The suggested file name is the timestamped export name.
- **Export Word…** and **Export Chapters to Word…** run Pandoc (see [Word export](#word-export)).
- `webwriter build` writes it as a web page (see [Publishing the book as a web page](#publishing-the-book-as-a-web-page)).

### Word export

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

Aligned blocks keep their side: `src/server/align.lua` gives their paragraphs the paragraph styles
Left Aligned, Centered, or Right Aligned, and `src/server/align-styles.lua` sets each style's
alignment in the written file, so the side can be changed for the whole book in Word. A captioned
picture in an aligned block becomes the picture and its caption, in italics, as aligned paragraphs.

### Publishing the book as a web page

`build` writes the book as one web page into a folder, for GitHub Pages, GitLab Pages, or any web
server:

```
node bin/webwriter.js build /path/to/book /path/to/site
```

The page is the manuscript as the PDF has it, drawn by the same renderer as the preview: the trash
is left out, notes are at the end of their front matter or chapter, and the parts and chapters are
numbered. The folder gets:

| File | What it is |
|---|---|
| `index.html` | The whole book. |
| `app.css` | Webwriter's stylesheet. |
| `images/…` | The pictures the book shows, at their paths in the book folder. |
| `mermaid.min.js` | Mermaid, only when the book has Mermaid diagrams. The reader's browser draws them. |

Files already in the folder are kept, so a picture taken out of the book stays there until the
folder is emptied. Warnings, such as a picture that is not in the book folder, are printed, and the
page is written anyway. The output folder must not be the book folder. `index.html` also opens
straight from the disk, without a web server.

#### On GitHub Pages

Keep the book folder in its own repository. In that repository's settings, under **Pages**, set
**Source** to **GitHub Actions**, and add `.github/workflows/pages.yml`:

```yaml
name: Publish the book
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          path: book
      - uses: actions/checkout@v4
        with:
          repository: uparix/webwriter
          path: webwriter
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: webwriter
      - run: node webwriter/bin/webwriter.js build book site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

Each push to `main` publishes the book at `https://<user>.github.io/<repository>/`.

#### On GitLab Pages

GitLab publishes what a job named `pages` leaves in `public/`. Add `.gitlab-ci.yml` to the book's
repository:

```yaml
pages:
  image: node:22
  script:
    - git clone --depth 1 https://github.com/uparix/webwriter.git /tmp/webwriter
    - npm ci --prefix /tmp/webwriter
    - node /tmp/webwriter/bin/webwriter.js build . public
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Each push to the default branch publishes the book at the address under **Deploy › Pages**.

## Working alongside agents and other programs

Any program can change the book's files while Webwriter is open: an AI agent, a text editor, git,
or a script. Each new book has an `AGENTS.md` that explains the files to agents.

### Following changes on disk

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

### Checking a book

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
- **Export PDF** prints from the browser, so the PDF is saved where the browser runs. **Export
  Word** runs Pandoc on the server.
- **Preferences** (last book, recent books, review author, comment color) are kept in
  `~/.config/webwriter/preferences.json` (`WEBWRITER_PREFS` overrides the path).

## On a machine with no screen, or over SSH

Webwriter can run on another machine, such as a Linux server, and be used from the browser on your
own computer. It only accepts connections from the machine it runs on, so the browser reaches it
through an SSH tunnel.

1. On the other machine, start it without a window, on a fixed port:

   ```
   node bin/webwriter.js ~/my-book --no-open --port 4848
   ```

   Without a window to close, it keeps running until Ctrl+C. To keep it running after you log out,
   start it inside `tmux` or `screen`.

2. On your computer, open the tunnel, and leave it open while you write:

   ```
   ssh -L 4848:127.0.0.1:4848 user@other-machine
   ```

   When Webwriter also runs on your computer, port 4848 is taken there. Pick another port on your
   side, such as `ssh -L 4850:127.0.0.1:4848 user@other-machine`, and open that port in step 3.

3. Open the address Webwriter printed in step 1, `http://127.0.0.1:4848/?key=…`, in your browser.
   With another port on your side, change the port in it. The key signs the browser in, and it stays
   signed in when Webwriter is started again.

What happens where:

- The book, the folder panels (Open, New Book, Picture, the exports), and Export Word and Export
  Chapters to Word are on the other machine. Pandoc must be installed there.
- Export PDF prints from your browser, so the PDF is saved on your computer.
- A picture can come from either side: one already on the other machine is chosen in its folder
  panel, and one on your computer is uploaded from the browser.
- draw.io and Mermaid are served by Webwriter itself, so the other machine needs no internet for them.

## Security

Webwriter can read and write the files of the user who runs it, so it guards who reaches it and what
a book can do, since a book may come from someone else:

- **Only this computer, only signed-in windows.** The server listens on `127.0.0.1` alone, refuses
  requests whose host is not local, takes changes only with Webwriter's own header, and answers only
  windows signed in with the key (see [Running](#running)).
- **Links.** Only `http`, `https`, `mailto`, and `#` links are followed, in the app, the PDF, and the
  web page. Any other link, such as `javascript:`, shows its text and goes nowhere.
- **Raw HTML** in a book is shown as text, never run, and Mermaid draws in its strict mode.
- **Pictures stay in the book.** A picture that a symbolic link leads out of the book folder is not
  shown, not published by `build`, and not put into a Word file. The Word export also leaves out
  pictures given by a path outside the book or by an address on the web, with a warning, since Pandoc
  would otherwise read them. Pictures are sent with headers that stop an SVG from running as a page,
  and the PDF page runs only Webwriter's own scripts.

## Development

### Layout

| Path | What it is |
|---|---|
| `bin/webwriter.js` | The command: starts the server and opens a window, or runs `check` or `build`. |
| `src/server/` | The book folder on disk: headers, loading and saving, moves, `book.json`, comments, pictures, Pandoc and its filters, watching, preferences, `check`, the web page `build` writes, the `AGENTS.md` template for new books, and the HTTP API. |
| `shared/` | Code the server and the page share: the tree, moves, export, fences, the index, comments (format, anchors, merging), tags, draw.io and Mermaid diagrams, the markup commands and find, and table editing. |
| `public/` | The page. `js/model.js` is the open book, `js/render.js` renders Markdown with body offsets, `js/rendered.js` makes the preview and reading view typeable, `js/editor.js` is the CodeMirror editor. |
| `test/` | Tests, including the export tests against the fixture books in `test/fixtures/`. |
| `examples/mybook/` | The example book. |
| `docs/` | The screenshot at the top of this README. |
| `vendor/drawio/` | draw.io's web app, served at `/drawio/`. |
| `scripts/` | `fetch-drawio.mjs` downloads draw.io into `vendor/drawio/`; `make-sample-diagram.mjs` writes the example book's sample diagram. |

### Tests

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
