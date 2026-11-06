// Reads and writes a book folder. The folder is the only stored form of the book.
import path from 'node:path';
import * as fsu from './fsutil.js';
import { parseSection, serializeSection, makeHeader, sameHeader } from './header.js';
import { BOOK_FILE, LEGACY_FILE, parseBookFile, parseLegacyTitle, serializeBookFile } from './bookfile.js';
import { TRASH_ID, find, ids, isTrash, walk, manuscript } from '../../shared/tree.js';
import { slugify, uniqueID, nextPrefix, assignPrefixes } from './naming.js';
import { planMove } from '../../shared/moves.js';

const TEMP_PREFIX = '__bw_tmp_';

export const nodeFilePath = (node) => {
  const entry = path.join(node.dir, node.entryName);
  return node.kind === 'group' ? path.join(entry, '_index.md') : entry;
};

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

// MARK: Loading

export function loadBook(root) {
  if (!fsu.isDirectory(root)) throw new Error(`${root} is not a directory.`);
  const warnings = [];
  let title = '';
  const titleFile = path.join(root, BOOK_FILE);
  const legacyFile = path.join(root, LEGACY_FILE);
  const titleText = fsu.tryReadText(titleFile);
  const legacyText = titleText == null ? fsu.tryReadText(legacyFile) : null;
  if (titleText != null) {
    try {
      title = parseBookFile(titleText);
    } catch (error) {
      warnings.push(`${BOOK_FILE} cannot be read, so the title was taken from the folder name. ${error.message}`);
    }
    if (fsu.exists(legacyFile)) {
      warnings.push(`${LEGACY_FILE} is no longer used, because ${BOOK_FILE} holds the title. It can be deleted.`);
    }
  } else if (legacyText != null) {
    // An older book keeps its title in book.yaml. It moves to book.json, and book.yaml goes
    // only once book.json is written.
    title = parseLegacyTitle(legacyText);
    try {
      fsu.writeText(titleFile, serializeBookFile(title));
      fsu.remove(legacyFile);
    } catch {
      // book.yaml stays.
    }
  } else {
    warnings.push(`This folder has no ${BOOK_FILE}. A title was taken from the folder name.`);
  }
  if (title === '') title = path.basename(root);
  const manuscriptDir = path.join(root, 'manuscript');
  let entries;
  try {
    entries = fsu.readDir(manuscriptDir);
  } catch {
    fsu.makeDirectory(manuscriptDir);
    // An existing book.json is left as it is, even one that cannot be read.
    if (!fsu.exists(titleFile)) fsu.writeText(titleFile, serializeBookFile(title));
    entries = [];
    warnings.push('Created an empty manuscript.');
  }
  const nodes = loadChildren(manuscriptDir, entries, warnings);
  nodes.push(loadTrash(manuscriptDir, warnings));
  const seen = new Set();
  walk(nodes, (node) => {
    if (seen.has(node.header.id)) warnings.push(`Duplicate id "${node.header.id}".`);
    seen.add(node.header.id);
  });
  return { root, title, nodes, warnings };
}

function loadTrash(manuscriptDir, warnings) {
  const dir = path.join(manuscriptDir, TRASH_ID);
  fsu.makeDirectory(dir);
  const index = path.join(dir, '_index.md');
  if (!fsu.exists(index)) fsu.writeText(index, serializeSection(makeHeader({ id: TRASH_ID, title: 'Trash' }), ''));
  const trash = loadGroup(manuscriptDir, TRASH_ID, '', TRASH_ID, warnings);
  trash.header.id = TRASH_ID;
  trash.header.title = 'Trash';
  return trash;
}

/** `NNN-slug` directories and `NNN-slug.md` files, in prefix order. */
function ordered(entries) {
  return entries.map((entry) => {
    let name = entry.name;
    if (!entry.isDirectory) {
      if (!name.endsWith('.md')) return null;
      name = name.slice(0, -3);
    }
    const match = /^(\d+)-(.+)$/s.exec(name);
    if (!match) return null;
    return { entry, prefix: match[1], slug: match[2] };
  }).filter(Boolean).sort((a, b) => {
    const an = Number.parseInt(a.prefix, 10);
    const bn = Number.parseInt(b.prefix, 10);
    if (an !== bn) return an - bn;
    return naturalCompare(a.entry.name, b.entry.name);
  });
}

function loadChildren(dir, entries, warnings) {
  const nodes = [];
  const prefixes = new Set();
  for (const entry of entries) {
    if (entry.name.startsWith(TEMP_PREFIX)) {
      warnings.push(`${entry.name} in ${path.basename(dir)} is left from an interrupted move and is not shown. Give it a number prefix such as 990- to bring it back.`);
    }
  }
  for (const item of ordered(entries)) {
    if (prefixes.has(item.prefix)) warnings.push(`Duplicate prefix ${item.prefix} in ${dir}.`);
    prefixes.add(item.prefix);
    if (item.entry.isDirectory) nodes.push(loadGroup(dir, item.entry.name, item.prefix, item.slug, warnings));
    else nodes.push(loadSection(dir, item.entry.name, item.prefix, item.slug, warnings));
  }
  return nodes;
}

function loadSection(dir, entryName, prefix, slug, warnings) {
  const parsed = parseSection(fsu.readText(path.join(dir, entryName)));
  warnings.push(...parsed.warnings.map((w) => `${entryName}: ${w}`));
  return { kind: 'section', header: parsed.header, body: parsed.body, prefix, slug, dir, entryName, children: [] };
}

function loadGroup(dir, entryName, prefix, slug, warnings) {
  const groupDir = path.join(dir, entryName);
  let header = makeHeader({ id: slug, title: slug.replaceAll('-', ' ') });
  let body = '';
  const text = fsu.tryReadText(path.join(groupDir, '_index.md'));
  if (text != null) {
    const parsed = parseSection(text);
    header = parsed.header;
    body = parsed.body;
    warnings.push(...parsed.warnings.map((w) => `${entryName}/_index.md: ${w}`));
  } else {
    warnings.push(`${entryName} has no _index.md.`);
  }
  const children = loadChildren(groupDir, fsu.readDir(groupDir), warnings);
  return { kind: 'group', header, body, prefix, slug, dir, entryName, children };
}

// MARK: Saving

/** Write the node's header and body. The id is never changed by a save. */
export function saveNode(node, header, body) {
  const kept = { ...header, id: node.header.id };
  const text = serializeSection(kept, body);
  node.header = kept;
  node.body = body;
  const file = nodeFilePath(node);
  if (fsu.tryReadText(file) === text) return 'same';
  fsu.writeText(file, text);
  return 'saved';
}

export function saveTitle(book, title) {
  const text = serializeBookFile(title);
  book.title = title;
  const file = path.join(book.root, BOOK_FILE);
  if (fsu.tryReadText(file) === text) return 'same';
  fsu.writeText(file, text);
  return 'saved';
}

/** Whether a file still holds the header and body it was last read or written with. */
export function fileMatches(file, header, body) {
  const text = fsu.tryReadText(file);
  if (text == null) return false;
  const parsed = parseSection(text);
  return parsed.body === body && sameHeader(parsed.header, header);
}

// MARK: Creating

/** Create a node at the end of `parentID` (or of the manuscript) and return its id. */
export function createNode(book, parentID, kind, title) {
  const parent = parentID ? find(book.nodes, parentID) : null;
  const dir = parent ? path.join(parent.node.dir, parent.node.entryName) : path.join(book.root, 'manuscript');
  const prefixes = fsu.readDir(dir).map((e) => /^(\d+)-/.exec(e.name)).filter(Boolean).map((m) => m[1]);
  const id = uniqueID(title, ids(book.nodes));
  const prefix = nextPrefix(prefixes);
  const header = makeHeader({ id, title, unit: kind === 'group' ? 'section' : 'text' });
  const text = serializeSection(header, '');
  if (kind === 'group') {
    const groupDir = path.join(dir, `${prefix}-${id}`);
    fsu.makeDirectory(groupDir);
    fsu.writeText(path.join(groupDir, '_index.md'), text);
  } else {
    fsu.writeText(path.join(dir, `${prefix}-${id}.md`), text);
  }
  // Past 990 the new prefix has another digit. The whole directory takes the wider prefixes.
  if (prefixes.some((p) => p.length < prefix.length)) renumber(book.root, parent ? parentID : null);
  return id;
}

/** Rewrite every prefix in one directory, keeping the order. */
function renumber(root, parentID) {
  const fresh = loadBook(root);
  const parent = parentID ? find(fresh.nodes, parentID)?.node : null;
  if (parent) rewriteDirectory(path.join(parent.dir, parent.entryName), parent.children);
  else rewriteDirectory(path.join(fresh.root, 'manuscript'), manuscript(fresh.nodes));
}

// MARK: Moving

/** Rewrite prefixes after a drag. Does nothing when the drop is not allowed. */
export function moveNode(book, movingID, targetID, zone) {
  const plans = planMove(book.nodes, movingID, targetID, zone);
  const moving = find(book.nodes, movingID)?.node;
  if (plans.length === 0 || !moving) return false;
  // Every order is resolved before anything moves, while each piece is still where it was.
  const orders = plans.map((plan) => ({
    parent: plan.parentID != null ? find(book.nodes, plan.parentID)?.node ?? null : null,
    nodes: plan.order.map((id) => {
      const found = find(book.nodes, id);
      if (!found) throw new Error(`Missing node ${id}.`);
      return found.node;
    }),
  }));
  const manuscriptDir = path.join(book.root, 'manuscript');
  if (plans.length === 2) {
    const sourceDir = moving.dir;
    rewriteDirectory(sourceDir, orders[0].nodes);
    const destDir = orders[1].parent ? path.join(orders[1].parent.dir, orders[1].parent.entryName) : manuscriptDir;
    const tempName = `${TEMP_PREFIX}${moving.header.id}`;
    fsu.move(path.join(sourceDir, moving.entryName), path.join(destDir, tempName));
    // The piece no longer belongs to its old folder. Left there, renumbering a folder above
    // it would point the piece back at its old directory.
    detach(book, moving);
    moving.dir = destDir;
    moving.entryName = tempName;
    placeDirectories(moving.children, path.join(destDir, tempName));
    rewriteDirectory(destDir, orders[1].nodes);
  } else {
    rewriteDirectory(moving.dir, orders[0].nodes);
  }
  for (const order of orders) {
    if (order.parent) order.parent.children = order.nodes;
    else book.nodes = [...order.nodes, ...book.nodes.filter(isTrash)];
  }
  return true;
}

/** Move a node into the trash. */
export function trashNode(book, id) {
  const target = find(book.nodes, id);
  if (!target || isTrash(target.node) || target.ancestors.some(isTrash)) return false;
  return moveNode(book, id, TRASH_ID, 'inside');
}

/** Remove everything in the trash and keep the trash folder. Returns the ids that were deleted. */
export function emptyTrash(book) {
  const dir = path.join(book.root, 'manuscript', TRASH_ID);
  const trash = book.nodes.find(isTrash);
  const deleted = [];
  if (trash) walk(trash.children, (node) => deleted.push(node.header.id));
  for (const entry of fsu.readDir(dir)) {
    if (entry.name !== '_index.md') fsu.remove(path.join(dir, entry.name));
  }
  if (trash) trash.children = [];
  return deleted;
}

function detach(book, node) {
  const found = find(book.nodes, node.header.id);
  const parent = found?.ancestors[found.ancestors.length - 1];
  if (parent) parent.children = parent.children.filter((n) => n !== node);
  else book.nodes = book.nodes.filter((n) => n !== node);
}

function rewriteDirectory(dir, orderedNodes) {
  const prefixes = assignPrefixes(orderedNodes.length);
  const renames = [];
  orderedNodes.forEach((node, index) => {
    const prefix = prefixes[index];
    const name = node.kind === 'section' ? `${prefix}-${node.slug}.md` : `${prefix}-${node.slug}`;
    const from = path.join(node.dir, node.entryName);
    const to = path.join(dir, name);
    if (from !== to) renames.push({ from, to });
    node.prefix = prefix;
    node.entryName = name;
    node.dir = dir;
    placeDirectories(node.children, to);
  });
  twoPhaseRename(renames);
}

function placeDirectories(nodes, dir) {
  for (const node of nodes) {
    node.dir = dir;
    placeDirectories(node.children, path.join(dir, node.entryName));
  }
}

/** Rename through temporary names so two siblings can swap prefixes. */
function twoPhaseRename(renames) {
  const temps = renames.map((rename, index) => {
    const temp = path.join(path.dirname(rename.from), `${TEMP_PREFIX}${index}_${path.basename(rename.to)}`);
    fsu.move(rename.from, temp);
    return { temp, to: rename.to };
  });
  for (const { temp, to } of temps) fsu.move(temp, to);
}

export { slugify };
