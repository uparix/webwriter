---
id: markup-commands
title: Markup commands
synopsis: ""
status: draft
role: body
---
A command inserts the characters for one construct. The writer recalls the name. The command recalls the syntax. The command writes into the buffer at the cursor and does not rebuild the section. Existing text is left as it stands, including existing footnote numbers.

The menu and the command palette list these fifteen commands. The palette finds a command by its name, so "foot" reaches Footnote and "pic" reaches Picture.

| Command | What it inserts |
|---|---|
| Emphasis | `*…*` around the selection |
| Strong | `**…**` around the selection |
| Inline code | `` `…` `` around the selection |
| Link | `[selection](url)` |
| Picture | `![selection](images/file){width=100%}`, and moves that file into the book |
| Subsection | `# ` at the start of the current line |
| Lower subsection | `## ` at the start of the current line |
| Bullet list | `- ` at the start of the current line |
| Numbered list | `1. ` at the start of the current line |
| Quotation | `> ` at the start of the current line |
| Code block | A fenced block around the selection, with a blank line before and after |
| Footnote | `[^n]` at the cursor, and a matching definition at the end of the section |
| Align Left | `::: left` and `:::` around the paragraph, picture, or diagram at the cursor |
| Center | `::: center` and `:::` around the paragraph, picture, or diagram at the cursor |
| Align Right | `::: right` and `:::` around the paragraph, picture, or diagram at the cursor |

With a selection, Emphasis, Strong, and Inline code wrap it and leave the text selected inside the marks; Link wraps it and leaves the cursor after the closing mark. With nothing selected, they insert the marks and leave the cursor between them.

A second click takes off what the first put on. Emphasis, Strong, and Inline code take their marks off a selection that has them just outside it or as its own ends, and off an empty pair of marks at the cursor. Strong takes two stars off `***word***` and leaves emphasis; Emphasis on `**word**` adds a third star. Subsection, Lower subsection, Bullet list, Numbered list, and Quotation take their own mark off the current line. On a subsection of the other level, or a list item of the other kind, they change it to their own; a nested item keeps its indentation. Link, Picture, Code block, and Footnote insert again each time.

Code block takes its language tag from the most recent fenced block already in the book. The cursor is left inside the block. When the book has no fenced block yet, the tag is empty and the cursor is left on the tag so it can be filled in.

Footnote scans the open section for `[^n]` definitions and uses the next free number. The cursor is left after `[^n]: `, ready for the note. Definitions already in the file keep their numbers.

Picture opens a file chooser in the book folder. The chosen file is moved into `images/`. The path in the mark is relative to the book folder. The mark always ends with `{width=100%}`. A file already in `images/` stays where it is. A file whose name is already there is saved as `name-2`, `name-3`, and so on. With a selection, the selection is the caption and the cursor is left after the mark. With nothing selected, the cursor is left between the brackets.

Align Left, Center, and Align Right work the same way. Each wraps whole lines in a Pandoc fenced div, set off by a blank line before and after. With a selection, it wraps every line the selection touches. With nothing selected, it wraps the paragraph at the cursor, or the whole fenced block when the cursor is in one, so a Mermaid diagram is aligned as one piece. A selection that reaches into a fenced block takes in the whole block. On a blank line it inserts an empty div and leaves the cursor inside it. Otherwise the cursor is left after the closing `:::`. Inside a div already set to the command's side, the fence lines are taken away and what was inside stays; inside one set to another side, the opening line is changed to the new side. The innermost aligned div around the cursor is the one changed, or, with a selection, one whose content the selection covers. The preview, the printed book, and the web page align what is inside; code blocks stay set to the left. In Word, the paragraphs get the paragraph style Left Aligned, Centered, or Right Aligned, and a captioned picture inside becomes the picture and its caption as aligned paragraphs.

One reminder page lists these same fifteen commands and the characters each one inserts. The page and the menu match.

Any other Pandoc construct can still be typed by hand. The menu, the palette, and the reminder page cover this list only.
