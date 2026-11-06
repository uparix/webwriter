// The book's tree of nodes, as plain objects:
// { kind: 'group' | 'section', header, body, prefix, slug, dir, entryName, children }.

export const TRASH_ID = 'trash';
export const STATUSES = ['idea', 'draft', 'revise', 'done'];
export const ROLES = ['front', 'body'];
export const UNITS = ['part', 'chapter', 'section', 'text'];

export const isTrash = (node) => node.header.id === TRASH_ID;
export const isGroup = (node) => node.kind === 'group';

/** The unit a node opens as. A missing unit keeps an old `break` flag. */
export function effectiveUnit(node) {
  const { unit, pageBreak } = node.header;
  if (unit) return unit;
  if (pageBreak === false) return 'text';
  if (pageBreak === true) return 'section';
  return node.kind === 'group' ? 'section' : 'text';
}

/** A part, a chapter, and a section start a new page. Text does not. */
export const startsNewPage = (node) => effectiveUnit(node) !== 'text';
export const isChapter = (node) => effectiveUnit(node) === 'chapter';

export function countWords(body) {
  return body.split(/\s+/).filter(Boolean).length;
}

export function wordCount(node, bodyOf = (n) => n.body) {
  return countWords(bodyOf(node)) + node.children.reduce((sum, child) => sum + wordCount(child, bodyOf), 0);
}

export function walk(nodes, visit, ancestors = []) {
  for (const node of nodes) {
    visit(node, ancestors);
    walk(node.children, visit, [...ancestors, node]);
  }
}

export function find(nodes, id) {
  let found = null;
  walk(nodes, (node, ancestors) => {
    if (!found && node.header.id === id) found = { node, ancestors };
  });
  return found;
}

export function ids(nodes) {
  const set = new Set();
  walk(nodes, (node) => set.add(node.header.id));
  return set;
}

/** A node is front matter when its own role is front or any group above it is. */
export function isFront(node, ancestors) {
  return node.header.role === 'front' || ancestors.some((a) => a.header.role === 'front');
}

/** "Part N" or "Chapter N". The number is derived and never stored. */
export function divisionLabel(division) {
  return `${division.kind === 'part' ? 'Part' : 'Chapter'} ${division.number}`;
}

/** Part numbers and chapter numbers, each in tree order. Front matter and the trash take none. */
export function divisions(roots) {
  const found = {};
  let part = 0;
  let chapter = 0;
  const visit = (nodes, ancestors) => {
    for (const node of nodes) {
      if (isTrash(node)) continue;
      const front = isFront(node, ancestors);
      const unit = effectiveUnit(node);
      if (unit === 'part' && !front) found[node.header.id] = { kind: 'part', number: ++part };
      else if (unit === 'chapter' && !front) found[node.header.id] = { kind: 'chapter', number: ++chapter };
      visit(node.children, [...ancestors, node]);
    }
  };
  visit(roots, []);
  return found;
}

export function clampHeadingLevel(level) {
  if (level > 6) return { level: 6, clamped: true };
  if (level < 1) return { level: 1, clamped: true };
  return { level, clamped: false };
}

/** Every root except the trash. */
export const manuscript = (nodes) => nodes.filter((n) => !isTrash(n));

/** Manuscript nodes in tree order, the trash left out. */
export function manuscriptInOrder(nodes) {
  const out = [];
  walk(manuscript(nodes), (node) => out.push(node));
  return out;
}
