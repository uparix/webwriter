---
id: a-section-file
title: A section file
synopsis: ""
status: draft
role: body
---
The application owns the header. The writer owns the body. The header is rewritten in a fixed field order on every save. The body is written back as the editor holds it. The application does not parse the body and serialize it again, and it does not reflow it.

````markdown
---
id: inward
title: Inward
synopsis: Source dependencies point inward, toward policy.
status: draft
role: body
unit: text
---
A dependency points inward.[^1]

# Where the rule stops

```java
class Foo {
    void bar() {}
}
```

[^1]: Toward higher-level policy.
````

The header is the first thing in the file. One newline separates the closing `---` from the body. An empty body ends the file after that newline.

The body is Pandoc Markdown.

- The title lives in the header. The body does not repeat it.
- A heading in the body is a subsection or deeper. Write `#` for a subsection. Write `##` for the level under that. Export shifts these headings by the node's depth.
- A code snippet is a fenced block with a language tag, with a blank line before and after the fence.
- A footnote is Pandoc syntax. `[^1]` refers to a definition `[^1]: …` in the same file. An inline note `^[Toward higher-level policy.]` is also allowed. Labels in the file are local to that file. Two sections may both use `[^1]`.

A group's `_index.md` uses the same header and the same body rules.
