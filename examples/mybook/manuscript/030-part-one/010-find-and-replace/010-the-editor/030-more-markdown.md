---
id: more-markdown
title: More Markdown
synopsis: Markdown that has no command, but that the views and the exports understand.
status: draft
role: body
unit: text
---
Some Markdown has no command in the **Markup** menu, but the preview, the reading views, and the exports all understand it. Type it as it is written here.

~~Struck-out words~~ sit between two pairs of tildes. A web address in angle brackets, <https://pandoc.org>, is a link by itself. A backslash keeps a character from being markup: \*not emphasis\*.

# A heading without a number {-}

`{-}` after a heading tells Pandoc not to number it, as front matter does. The braces never show.

An underlined heading
---------------------

A line of `=` or `-` under a line of text makes it a heading, like `#` and `##`.

- A list nests when an item is indented
  - by two spaces
    - or more,
- and comes back out again.

A line indented by four spaces is code, without a fence:

    npm test

Three asterisks on a line of their own draw a rule:

***

A page break is a line of HTML. The preview marks it, and the PDF and Word start a new page there:

<div class="page-break"></div>

This sentence starts the next page.
