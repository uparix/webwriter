---
id: code
title: Code
synopsis: Fenced blocks in three languages.
status: draft
role: body
unit: text
---
Code blocks are fenced, with a language tag. The **Code block** command takes its tag from the most recent block in the book, so this piece ends with Swift and the next block you insert will be Swift too.

```python
def word_count(body: str) -> int:
    # Words are runs of characters between whitespace.
    return len(body.split())
```

```bash
pandoc manuscript.md -o book.pdf  # run from the book folder
```

```swift
let prefixes = Naming.assignPrefixes(3) // ["010", "020", "030"]
```
