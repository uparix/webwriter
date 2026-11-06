---
id: the-book
title: The book
synopsis: ""
status: draft
role: body
---
There are two kinds of node.

- A **group** holds other nodes, and it may hold prose of its own.
- A **section** is a leaf. It holds prose.

A short book can be a flat list of sections. A long book can nest as deep as it needs.

A **unit** says how that node opens in the manuscript. The choice is the same for a group and for a section file.

- A **part** is numbered. The manuscript writes `Part N`, centered and bold, and then the title.
- A **chapter** is numbered. The manuscript writes `Chapter N`, centered and bold, and then the title.
- A **section** is not numbered. The manuscript writes the title and no line above it. This unit is not the leaf node of the same name.
- **Text** is not numbered. It stays on the current page.

A part, a chapter, and a section start on a new page. The node that opens the manuscript is the first page, so that break is not written in front of it.

Parts and chapters are numbered separately, in tree order, through the whole manuscript. A chapter inside a part takes the next chapter number. The numbers are computed, never stored. Front matter and the trash take no number.

A new group starts as a section. A new section file starts as text.

A **subsection** is not a node. It is a Markdown heading inside a section file.

**Front matter** (copyright, dedication, preface) is ordinary nodes with role `front`. The tree controls where they sit. The role keeps export from numbering them.

Each node has:

| Field | Meaning |
|---|---|
| `id` | Stable identity. Assigned when the node is created. Never changed by a rename or a reorder. Unique within the book. |
| `title` | The heading export will emit for this node. |
| `synopsis` | Short summary shown under the title in the outline. May be empty. |
| `status` | One of `idea`, `draft`, `revise`, `done`. A new node starts as `idea`. |
| `role` | One of `front` or `body`. A new node starts as `body`. |
| `unit` | One of `part`, `chapter`, `section`, `text`. A part, a chapter, and a section start on a new page. Text does not. A new group starts as `section`. A new section file starts as `text`. A file that omits `unit` and says `break: false` is text. A file that omits `unit` and says `break: true` is a section. A file that omits both is a section when it is a group and text when it is a section file. Saving the form writes `unit` and leaves `break` out. |

A node is front matter when its own role is `front`, or when any group above it is `front`. Set the role on the front-matter group and the children follow.

Word count is computed, never stored. A section's count is the number of whitespace-separated words in its body. A group's count is the words in its own body plus the counts of its children.
