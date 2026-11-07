# Working on this book (for AI agents)

This folder is a book written with Webwriter. It is plain files: read and edit them directly. A
running Webwriter notices changes within about a second and never overwrites the writer's unsaved
typing; if both changed a text, it asks the writer which to keep.

## Layout

```
book.json            the title
manuscript/          the text: a tree of folders and Markdown files
  010-opening.md     a text
  020-part-one/      a folder, which holds pieces and has text of its own
    _index.md        the folder's header and text
    010-arrival.md
  trash/             deleted pieces, not part of the book
comments.json        review comments (missing when there are none)
tags.json            tag colors (optional)
images/              pictures and draw.io diagrams (*.drawio.svg)
```

The number prefix (`010-`, `020-`, steps of 10, at least three digits) sets the order among
siblings; the rest of the name is a slug of the title. To add a piece, write a new file with a free
prefix, such as `015-` between `010-` and `020-`. A piece is known by its `id`, never by its file
name: names change when pieces are moved.

## A piece

Every `.md` file starts with a header, then exactly one newline, then the body:

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

[^1]: It always is.
```

| Field | Values |
|---|---|
| `id` | Unique in the book, lowercase words joined by hyphens. Never change it. `trash` is taken. |
| `title`, `synopsis` | One line each. Plain when made only of letters, digits, spaces, and `. , ' _ -`; otherwise in double quotes, with `\"` and `\\` escaped. |
| `status` | `idea`, `draft`, `revise`, or `done`. |
| `role` | `body`, or `front` for front matter (unnumbered; everything inside a front folder is front too). |
| `unit` | `part` and `chapter` are numbered ("Part 1", "Chapter 3"); `part`, `chapter`, and `section` start a new page; `text` runs on. |

Keep the fields in this order. The body is Pandoc Markdown:

- Do not repeat the title in the body. A `#` heading in the body is a subsection under it.
- Footnotes: `[^label]`, defined in the same file; labels are local to the file.
- Pictures: `![Caption](images/photo.jpg){width=50%}`.
- Diagrams written as text: a `` ```mermaid `` fence holding [Mermaid](https://mermaid.js.org) syntax.
- Tags: `[needs source]{.tag}` or `[urgent]{.tag color=red}`.
- An index (a numbered list of the pieces after it) is an empty fence: `` ```index `` then `` ``` ``.
- A page break: `<div class="page-break"></div>` on a line of its own.

## book.json

```json
{
  "title" : "The Harbor",
  "version" : 1
}
```

## comments.json

```json
{
  "comments" : [
    {
      "author" : "Agent",
      "color" : "blue",
      "date" : "2026-11-07T09:30:00Z",
      "id" : "agent-0001",
      "length" : 0,
      "nodeID" : "arrival",
      "quote" : "The ferry was late.",
      "start" : 0,
      "text" : "Could this open on the town instead?"
    }
  ],
  "version" : 1
}
```

- `nodeID` is the `id` of the piece; `quote` is the exact text commented on, as written in the
  Markdown (same marks and line breaks), within one piece's body.
- `start` and `length` are UTF-16 offsets from the start of the body. You need not compute them:
  with `length` 0, Webwriter finds `quote` nearest to `start` and writes the real values back
  (until then, `webwriter check` warns that they do not cover the quote; that is expected).
- `id` is any unique string; never change or reuse one. `date` is UTC with whole seconds.
- `color` is optional: `yellow` (default), `green`, `blue`, `pink`, or `purple`. Anything else
  makes the file unreadable. Keep to these keys.
- There are no threads: to reply, add a comment on the same `quote` whose text starts `Re: `.
- Write the file with 2-space indentation, keys sorted, `" : "` between key and value, real
  non-ASCII characters, and a final newline. With no comments left, delete the file.

## tags.json

```json
{
  "tags" : {
    "needs source" : "orange"
  },
  "version" : 1
}
```

Names are lowercase. Colors: `yellow`, `orange`, `red`, `pink`, `purple`, `blue`, `teal`, `green`,
`gray`, or `#RRGGBB`. A tag without an entry gets a color from its name.

## Good manners

- Change only what you were asked to. Do not re-wrap paragraphs: comments find their text again
  by their `quote`, and rewritten lines lose them. When you reword commented words, update `quote`.
- Never put comments or markers into the Markdown files.
- Move pieces only when asked, by renaming with new prefixes; keep every `id`.
- Afterwards, check the book: `webwriter check .` (or `node <webwriter>/bin/webwriter.js check .`).
