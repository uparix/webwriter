// An index piece: a text whose body holds an `index` code fence. The fence stands for a numbered
// list of every piece that follows the index in the book (1, 1.1, 1.1.1, …), made when the book is
// shown or exported, so it never goes stale. Shared by the server (export) and the browser.
import { fenceMark, fenceCloses } from './fences.js';
import { find, manuscript } from './tree.js';

export const INDEX_INFO = 'index';
export const INDEX_BODY = '```index\n```\n';

const isIndexFence = (mark) => mark.info.trim() === INDEX_INFO;

export function hasIndex(body) {
  return body.split('\n').some((line) => {
    const mark = fenceMark(line);
    return mark != null && isIndexFence(mark);
  });
}

/**
 * The pieces after `id` in tree order, numbered as a tree of their own: the index's later siblings,
 * then the later siblings of each folder above it. [{ id, number, title, depth }].
 */
export function indexEntries(roots, id) {
  const top = manuscript(roots);
  const found = find(top, id);
  if (!found) return [];
  const chain = [...found.ancestors, found.node];
  const following = [];
  for (let depth = chain.length - 1; depth >= 0; depth -= 1) {
    const siblings = depth === 0 ? top : chain[depth - 1].children;
    following.push(...siblings.slice(siblings.indexOf(chain[depth]) + 1));
  }
  const entries = [];
  const visit = (nodes, prefix, depth) => nodes.forEach((node, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    entries.push({ id: node.header.id, number, title: node.header.title || 'Untitled', depth });
    visit(node.children, number, depth + 1);
  });
  visit(following, '', 0);
  return entries;
}

const escapeMarkdown = (text) => text.replace(/[\\`*_[\]<>#|~^$]/g, '\\$&');

/** The entries as one Pandoc paragraph, a line each, indented by depth with no-break spaces. */
export function indexMarkdown(entries) {
  return entries
    .map((e) => `${' '.repeat(4 * e.depth)}${e.number}  ${escapeMarkdown(e.title)}`)
    .join('\\\n');
}

/** The body with each `index` fence replaced by `markdown`. Other fences are copied through. */
export function expandIndex(body, markdown) {
  const out = [];
  let open = null;
  let replacing = false;
  for (const line of body.split('\n')) {
    const mark = fenceMark(line);
    if (open) {
      if (mark && fenceCloses(open, mark)) {
        open = null;
        if (replacing) {
          replacing = false;
          continue;
        }
      }
      if (!replacing) out.push(line);
      continue;
    }
    if (mark) {
      open = { char: mark.char, length: mark.length };
      replacing = isIndexFence(mark);
      if (replacing) {
        out.push(markdown);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

/** A copy of the tree with every index fence written out, for export. */
export function withIndexes(roots) {
  const copy = (nodes) => nodes.map((node) => ({
    ...node,
    body: hasIndex(node.body) ? expandIndex(node.body, indexMarkdown(indexEntries(roots, node.header.id))) : node.body,
    children: copy(node.children),
  }));
  return copy(roots);
}
