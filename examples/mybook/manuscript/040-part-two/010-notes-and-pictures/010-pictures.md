---
id: pictures
title: Pictures
synopsis: A picture at 40 percent width.
status: draft
role: body
unit: text
---
Pictures live in `images/`, beside `manuscript/`. The **Picture** command moves the chosen file there.

![An open book](images/open-book.jpg){width=40%}

The `{width=40%}` after the picture sets its width on the page.

A diagram drawn in draw.io is a picture too. Saved as an editable SVG, it shows in the text and the exports like any other picture, and draw.io still opens it to make changes. **Insert Diagram** draws a new one, and right-clicking a diagram edits it.

![The book folder](images/book-folder.drawio.svg){width=90%}

A Mermaid diagram is written as text, in a `mermaid` code fence, and drawn where it stands. **Insert Mermaid Diagram** starts one; the next page shows a few.
