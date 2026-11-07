---
id: mermaid-diagrams
title: Mermaid Diagrams
synopsis: A flowchart, a sequence, states, a small database, and a schedule, all written as text.
status: draft
role: body
unit: text
---
A Mermaid diagram is plain text in a `mermaid` code fence. Change the text and the drawing follows. Each kind of diagram starts with its own keyword.

A flowchart, with a loop back for another pass:

```mermaid
flowchart LR
  Idea --> Draft --> Revision --> Book
  Revision -- another pass --> Draft
```

A sequence diagram shows who says what, in order:

```mermaid
sequenceDiagram
  participant W as Writer
  participant E as Editor
  participant P as Publisher
  W->>E: Sends the draft
  E-->>W: Returns comments
  W->>E: Sends the revision
  E->>P: Recommends the book
  P-->>W: Offers a contract
```

A state diagram follows a text from first draft to print:

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Review
  Review --> Draft: changes asked
  Review --> Final
  Final --> [*]
```

An entity-relationship diagram describes a small database. Here a book has many chapters, and each chapter has many comments:

```mermaid
erDiagram
  direction LR
  BOOK ||--o{ CHAPTER : contains
  CHAPTER ||--o{ COMMENT : has
  BOOK {
    int id PK
    string title
  }
  CHAPTER {
    int id PK
    int book_id FK
    string title
  }
  COMMENT {
    int id PK
    int chapter_id FK
    string text
  }
```

A Gantt chart plans the writing:

```mermaid
gantt
  title Writing plan
  dateFormat YYYY-MM-DD
  axisFormat %b %d
  tickInterval 2week
  section Draft
    Part one     :a1, 2026-01-05, 30d
    Part two     :a2, after a1, 30d
  section Revision
    Read through :b1, after a2, 14d
    Final pass   :b2, after b1, 10d
```

A pie chart shows where the words went. The `{width=50%}` after `mermaid` sets its width on the page, as for a picture:

```mermaid {width=50%}
pie title Words by part
  "Front matter" : 800
  "Part one" : 14000
  "Part two" : 11000
  "Afterword" : 1200
```

The [Mermaid documentation](https://mermaid.js.org) lists every kind of diagram and its syntax.
