---
id: preview
title: Preview
synopsis: ""
status: draft
role: body
---
The open section has a rendered preview beside the Markdown. It can be shown or hidden.

The preview is drawn from the editor buffer as the buffer changes, including text that has not been saved. It shows that section as export will show it. The title is a heading at the section's depth. Body headings are shifted by that same depth. A front-matter section shows its headings unnumbered. Code is highlighted. Footnotes are shown as notes, numbered in the order they appear in the section. Clicking a footnote marker scrolls the preview to that note, and the return mark on the note scrolls back to the marker. When the Markdown is displayed, the cursor moves to that same place. A picture path names a file in the book folder, and the preview shows that file. A broken fence or a footnote reference with no definition is visible in the preview.

The preview is a view of the buffer. Typing in the preview writes into that buffer at the caret and leaves every other byte as it was. Enter starts a new paragraph. Enter inside a code block starts a new line. Shift+Enter starts a new line. Clicking in the Markdown scrolls the preview to that place. A successful find scrolls the preview to the match.
