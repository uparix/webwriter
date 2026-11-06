---
id: a-note-on-pandoc
title: A Note on Pandoc
synopsis: ""
status: done
role: body
unit: text
---
Bookwriter stops at the manuscript. Run Pandoc from the book folder so picture paths resolve:

```bash
cd "A Field Guide to Bookwriter"
pandoc manuscript.md -o book.epub
```
