---
id: tags
title: Tags
synopsis: Colored labels in the text.
status: draft
role: body
unit: text
---
A tag marks a stretch of the book for later: [draft]{.tag}, [fact check]{.tag}, or [rewrite]{.tag}. It is written as a Pandoc span with the class `tag`, such as `[draft]{.tag}`, and drawn as a colored label.

The colors live in `tags.json`, beside `book.json`, so a tag looks the same everywhere in the book. A tag can also bring its own color, like [urgent]{.tag color=red}, and a tag that has neither, like [idea]{.tag}, gets a color picked from its name.

Tags show in the preview, the reading view, the PDF, and the Word files. **Markup → Tag** adds one, and **Markup → Tag Colors** changes their colors.
