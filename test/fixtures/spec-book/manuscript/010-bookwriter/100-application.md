---
id: application
title: Application
synopsis: ""
status: draft
role: body
---
The program is written in TypeScript.

The window is a Tauri window: a dock icon, a menu bar, and direct access to the book folder.

The body editor is CodeMirror. It edits the Markdown body, and the buffer is the file. The section preview is drawn from that buffer and writes back into it. The rendered chapter view is the reading view of a group, and it writes back into the section under the caret.

The local program does these things with the folder:

- list a directory
- read a file
- write a file
- rename siblings when the order changes
- move a picture into `images/`
- concatenate the tree for export
