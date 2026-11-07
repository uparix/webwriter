// The book as one web page, for GitHub Pages or GitLab Pages: the manuscript laid out as the PDF lays
// it out, by the same renderer, with notes at the end of each group. The folder it is written to gets
// index.html, app.css, the pictures the book shows, and Mermaid when it has diagrams, which the
// reader's browser draws.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './browser-paths.js';
import * as fsu from './fsutil.js';
import { loadBook } from './bookstore.js';
import { noteGroups } from '../../shared/export.js';
import { TAGS_FILE, decodeTags } from '../../shared/tags.js';

export const USAGE = `usage: webwriter build <book folder> <output folder>

Writes the book as one web page, index.html, into the output folder, with the stylesheet, the
pictures, and Mermaid for the diagrams. Files already in the folder are kept, and replaced when the
page needs one with the same name. Upload the folder to GitHub Pages or GitLab Pages, or open
index.html in a browser.`;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STYLESHEET = path.join(appRoot, 'public', 'app.css');
const MERMAID = path.join(appRoot, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The app's renderer draws pictures from the server's /book-file/ address. */
const PICTURE_SOURCE = /src="\/book-file\/([^"?]*)(?:\?[^"]*)?"/g;

/**
 * Writes the site and gives { file, warnings, pictures }, the pictures copied by book-relative path.
 * Throws when the book cannot be read or the folder cannot be written.
 */
export async function buildSite(root, out) {
  if (path.resolve(root) === path.resolve(out)) throw new Error('The output folder must not be the book folder.');
  // The renderer imports /shared/ paths, which resolve only once browser-paths.js has run.
  const { renderPlain, setTagDefinitions, setMermaidFence } = await import('../../public/js/render.js');
  const book = loadBook(root);
  const warnings = [...book.warnings];
  const tagsText = fsu.tryReadText(path.join(root, TAGS_FILE));
  setTagDefinitions(tagsText == null ? {} : decodeTags(tagsText));
  setMermaidFence((source, place, codeHTML, lineAttr) => `<div class="mermaid-diagram"${lineAttr}><pre class="mermaid">${esc(source)}</pre></div>`);
  const exported = noteGroups(book.nodes);
  warnings.push(...exported.warnings);
  let body = exported.groups.map((markdown, index) => `<div class="note-group">${renderPlain(markdown, `g${index}`)}</div>`).join('\n');
  // A break at the very beginning is dropped, as in the PDF.
  body = body.replace(/^(<div class="note-group">)<div class="page-break-mark"[^>]*>[^<]*<\/div>/, '$1');
  // The app follows a note's link with a script. Here the links go to the note and back.
  body = body
    .replace(/href="#" data-note="([^"]*)"/g, 'href="#note:$1" data-note="$1"')
    .replace(/href="#" class="backref" data-ref="([^"]*)"/g, 'href="#ref:$1" class="backref" data-ref="$1"');

  fs.mkdirSync(out, { recursive: true });
  const pictures = [];
  const seen = new Set();
  body = body.replace(PICTURE_SOURCE, (match, encoded) => {
    const relative = encoded.split('/').map(decodeURIComponent).join('/');
    if (!seen.has(relative)) {
      seen.add(relative);
      const source = path.join(root, relative);
      if (fsu.exists(source) && !fsu.isInside(fsu.canonical(root), fsu.canonical(source))) {
        // A symbolic link out of the book would publish whatever it points to.
        warnings.push(`The picture ${relative} leads outside the book folder and is left out.`);
      } else if (fsu.exists(source)) {
        fs.mkdirSync(path.dirname(path.join(out, relative)), { recursive: true });
        fs.copyFileSync(source, path.join(out, relative));
        pictures.push(relative);
      } else {
        warnings.push(`The picture ${relative} is not in the book folder.`);
      }
    }
    return `src="${encoded}"`;
  });
  const diagrams = body.includes('<pre class="mermaid">');
  if (diagrams) {
    if (!fsu.exists(MERMAID)) throw new Error('Mermaid is missing. Run npm install in the Webwriter folder.');
    fs.copyFileSync(MERMAID, path.join(out, 'mermaid.min.js'));
  }
  fs.copyFileSync(STYLESHEET, path.join(out, 'app.css'));
  const file = path.join(out, 'index.html');
  fs.writeFileSync(file, page(book.title, body, diagrams));
  return { file, warnings, pictures };
}

function page(title, body, diagrams) {
  // The same Mermaid settings as the app, so the diagrams look as they do there.
  const mermaid = diagrams ? `
<script src="mermaid.min.js"></script>
<script>
  mermaid.initialize({
    startOnLoad: true, theme: 'default', securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false },
    gantt: { useWidth: 620 },
  });
</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="app.css">
<style>
  /* The app's paper, scrolling as a page. Page breaks are space between pieces, and pages when printed. */
  html, body { height: auto; overflow: visible; background: var(--paper); }
  .paper { padding: 48px 40px 96px; font-size: 17px; }
  .paper .page-break-mark { visibility: hidden; height: 0; margin: 3em 0; }
  .paper pre.mermaid { margin: 0; font: 13px/1.45 var(--mono); white-space: pre-wrap; text-align: left; }
  @media (max-width: 600px) {
    .paper { padding: 24px 16px 64px; font-size: 16px; }
  }
  @media print {
    .paper { max-width: none; padding: 0; font-size: 11pt; }
    .paper .page-break-mark { break-before: page; margin: 0; }
  }
</style>
</head>
<body>
<article class="paper">
${body}
</article>${mermaid}
</body>
</html>
`;
}
