---
id: a-note-on-pandoc
title: A Note on Pandoc
synopsis: ""
status: done
role: body
unit: text
---
Webwriter makes PDF and Word files itself. For other formats, such as EPUB, export the manuscript and run Pandoc from the book folder, so picture paths resolve:

```bash
cd mybook
pandoc manuscript.md -o book.epub
```
