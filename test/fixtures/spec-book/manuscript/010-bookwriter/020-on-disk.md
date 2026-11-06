---
id: on-disk
title: On disk
synopsis: ""
status: draft
role: body
---
The book is a folder of Pandoc Markdown files. The folder is the only stored form of the book. There is no database and no separate binder file.

```text
my-book/
  book.yaml
  images/
    bridge.jpg
  manuscript/
    010-front-matter/
      _index.md
      010-preface.md
    020-naming/
      _index.md
      010-the-rule/
        _index.md
        010-inward.md
        020-boundaries.md
```

`book.yaml` holds facts about the whole book. Today that is the title.

```yaml
title: The Book Title
```

Under `manuscript/`:

- A directory is a group.
- `_index.md` inside a directory is that group's own document. Every group has one. The body may be empty.
- Any other `.md` file is a section.
- `_index.md` is reserved. A section cannot use that name.

Order among siblings is a numeric prefix: `010`, `020`, `030`, step 10, at least three digits. The slug after the prefix is a readable name taken from the title when the node is created. Changing the title does not rename the file. Reordering rewrites the prefixes of the siblings in that directory and leaves every other directory alone. The `id` does not change.

The slug is lowercase words separated by hyphens, with punctuation removed. The `id` is that same slug. If the id is already used in the book, the application appends `-2`, `-3`, and so on.

If a directory would need a prefix past `990`, the prefixes in that directory gain another digit (`0100`, `0200`, …).

Files are UTF-8 with LF line endings.

Pictures live in `images/`, beside `manuscript/`. A picture path in a text is relative to the book folder. `images/bridge.jpg` is that file.
