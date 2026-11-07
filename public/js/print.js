// The PDF export: the manuscript Markdown that Export Manuscript writes, laid out by the
// renderer on Letter pages. Notes are printed at the end of the group they belong to.
import { api } from './api.js';
import { renderPlain, setTagDefinitions } from './render.js';
import { mermaidSettled } from './mermaid.js';
import { noteGroups, exportChapter } from '/shared/export.js';

const params = new URLSearchParams(location.search);
const book = await api.get('/api/book');
// Tags print in their colors from tags.json.
setTagDefinitions((await api.get('/api/tags')).tags || {});
let groups;
if (params.get('chapter')) {
  const chapter = exportChapter(book.nodes, params.get('chapter'));
  groups = chapter ? [chapter.markdown] : [];
} else {
  groups = noteGroups(book.nodes).groups;
}
const printed = document.getElementById('printed');
printed.innerHTML = groups.map((markdown, index) => `<div class="note-group">${renderPlain(markdown, `g${index}`)}</div>`).join('');
// A break at the very beginning is dropped.
const first = printed.querySelector('.note-group > :first-child');
if (first?.classList.contains('page-break-mark')) first.remove();
// The save dialog suggests the window title as the file name.
document.title = (params.get('name') || book.title).replace(/\.pdf$/, '');
await mermaidSettled();
await Promise.all([...printed.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
for (const img of printed.querySelectorAll('img.picture')) {
  if (!img.naturalWidth) {
    const warning = document.createElement('span');
    warning.className = 'warning';
    warning.textContent = `[picture: ${img.dataset.path}]`;
    img.replaceWith(warning);
  }
}
window.addEventListener('afterprint', () => window.close());
setTimeout(() => window.print(), 150);
