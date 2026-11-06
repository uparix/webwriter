---
id: export
title: Export
synopsis: ""
status: draft
role: body
---
Export walks the tree in order and writes one Pandoc Markdown file. That file is the manuscript. It is written outside `manuscript/`. The writer chooses the destination when exporting.

For each node, export emits the title as a heading, then the body.

The heading level is the node's depth. Depth is the number of groups under `manuscript/` that contain the node, counting the node's own group when the node is a group's `_index.md`.

| Node | Depth | Exported heading |
|---|---|---|
| `manuscript/020-naming/_index.md`, unit `chapter` | 1 | `Chapter 1`, then `# Naming` |
| `manuscript/020-naming/010-the-rule/_index.md`, unit `section` | 2 | `## The Rule` |
| `manuscript/020-naming/010-the-rule/010-inward.md`, unit `text` | 3 | `### Inward` |

A part or a chapter is any body node whose unit says so, at any depth. Export writes `Part N` or `Chapter N` on a centered bold line, then the node's title as the heading beneath it. Parts and chapters are numbered separately, in tree order. A section writes the title only. Text writes the title only and stays on the current page. A front-matter node and the trash are not numbered. The number is not stored in the file.

A part, a chapter, and a section begin on a new page. Text does not. The node that opens the manuscript is the first page, so the break is not written in front of it.

In the example below, Preface is front matter, Naming is a chapter, The Rule is a section, and Inward is text.

A body heading is shifted by that same depth. A `#` inside `010-inward.md` is exported as `####`, one level below the section's own heading. Markdown has six heading levels. A heading that would land past level 6 is exported at level 6, and the export warns.

A front-matter heading is emitted with Pandoc's unnumbered marker: `# Preface {-}`. Body headings inside front matter get the same marker.

Footnote labels are prefixed with the section id during export, on both the reference and the definition. `[^1]` in the section whose id is `inward` is written as `[^inward-1]`. Inline notes have no label and need no prefix. Pandoc numbers the notes in the finished book. The labels in the source are not the numbers a reader sees.

Bookwriter's PDF prints the front matter's notes at the end of the front matter, and each chapter's notes at the end of that chapter, including the notes from the sections inside it. A part's own notes, and the notes of a section that is not inside a chapter, are printed at the end of that part or section. Each of those groups is numbered from 1 in the order the notes appear.

Export of the example above:

````markdown
# Preface {-}

The preface body.

<div class="page-break"></div>

<p class="chapter-number">Chapter 1</p>

# Naming

The chapter opener.

<div class="page-break"></div>

## The Rule

Inside the chapter.

### Inward

A dependency points inward.[^inward-1]

#### Where the rule stops

```java
class Foo {
    void bar() {}
}
```

[^inward-1]: Toward higher-level policy.
````

The application stops at that Markdown file. PDF, EPUB, and Word are Pandoc's job, run on the exported file. Picture paths are left as written, relative to the book folder. Run Pandoc from the book folder so a picture path resolves. Bookwriter does not grow a compile engine of its own.

Export Chapters to Word writes each front-matter piece and each chapter as its own Word file in a directory the writer chooses. A front-matter file is named `FM-title.docx` and holds that piece together with the sections inside it. A chapter file is named `cc-title.docx`, where `cc` is the chapter number written in at least two digits and `title` is that chapter's title, and it holds the sections inside the chapter. A part is not its own file. Pandoc does the conversion, run from the book folder so a picture path resolves.

Right-clicking a chapter and choosing Export to PDF writes a PDF of that chapter and the sections inside it. A nested chapter is its own chapter and is left out. The chapter keeps the number it has in the book. The suggested file name is `cc-title.pdf`.
