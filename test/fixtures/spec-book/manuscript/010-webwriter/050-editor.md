---
id: editor
title: Editor
synopsis: ""
status: draft
role: body
---
Selecting a section opens its body in the editor. The header is edited from the outline, not from inside the body.

The editor shows Markdown source. The characters in the editor are the characters in the file. A subsection is a line that starts with `#`. A code snippet is a fenced block. A footnote is `[^1]` or an inline `^[…]`. Saving writes that buffer to the body and leaves every other byte of the body as the writer left it.

The marks stay visible. Highlighting shows a heading line as a heading and a fenced block as code, with the `#` and the backticks still on screen.

Find searches the open text. The find panel has a whole book checkbox beside match case, regexp, and by word. With that checked, Find Next and Find Previous continue through the other texts in tree order and open the text that holds the match. The trash is left out. The search wraps around the manuscript. Replace keeps working in the open text. A successful Find Next or Find Previous scrolls the preview to the match.
