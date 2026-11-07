import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadBook, saveNode, createNode, moveNode, trashNode, emptyTrash, saveTitle,
} from '../src/server/bookstore.js';
import { parseSection, serializeSection, quoteScalar, makeHeader } from '../src/server/header.js';
import { slugify, uniqueID, assignPrefixes, nextPrefix } from '../src/server/naming.js';
import { loadComments, saveComments } from '../src/server/commentfile.js';
import { placePicture } from '../src/server/pictures.js';
import { check } from '../src/server/check.js';
import { exportBook, exportChapter, wordFiles, fileTitle, timestamped, transformBody } from '../shared/export.js';
import { divisions, divisionLabel, effectiveUnit, find, isTrash } from '../shared/tree.js';
import {
  shiftRange, trimRange, reanchor, mergeComments, encodeComments, decodeComments, repaired,
} from '../shared/comments.js';
import { applyMarkup, latestLanguage, matchingCommands, changedSpan, Finder } from '../shared/markup.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function copy(name) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-fixture-'));
  fs.cpSync(path.join(fixtures, name), target, { recursive: true });
  return target;
}

function report(book) {
  const exported = exportBook(book.nodes);
  const words = wordFiles(book.nodes).files.map((f) => f.name);
  return `${exported.markdown}\n----WARN\n${exported.warnings.join('\n')}\n----DOCX\n${words.join('\n')}`;
}

function tree(root) {
  const out = [];
  const walkDir = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      out.push(path.join(rel, name));
      if (fs.statSync(full).isDirectory()) walkDir(full, path.join(rel, name));
    }
  };
  walkDir(path.join(root, 'manuscript'), '');
  return out;
}

test('the spec book exports the expected Markdown', () => {
  const book = loadBook(copy('spec-book'));
  assert.deepEqual(book.warnings, []);
  assert.equal(exportBook(book.nodes).markdown, fs.readFileSync(path.join(fixtures, 'spec-book.expected.md'), 'utf8'));
});

test('the rich book exports the expected report', () => {
  const book = loadBook(copy('rich-book'));
  assert.equal(report(book), fs.readFileSync(path.join(fixtures, 'rich-book.expected.txt'), 'utf8'));
});

test('parts and chapters are numbered across the tree', () => {
  const book = loadBook(copy('rich-book'));
  const d = divisions(book.nodes);
  assert.equal(divisionLabel(d['part-one']), 'Part 1');
  assert.equal(divisionLabel(d.naming), 'Chapter 1');
  assert.equal(divisionLabel(d.nested), 'Chapter 2');
  assert.equal(divisionLabel(d.second), 'Chapter 3');
  assert.equal(d.front, undefined);
  assert.equal(effectiveUnit(find(book.nodes, 'legacy').node), 'text');
  assert.equal(effectiveUnit(find(book.nodes, 'old-group').node), 'section');
  assert.deepEqual(book.nodes.find(isTrash).children.map((n) => n.header.id), ['gone']);
});

test('saving without changes keeps every byte', () => {
  const root = copy('rich-book');
  const book = loadBook(root);
  const file = 'manuscript/020-part-one/010-naming/010-rule.md';
  const node = find(book.nodes, 'rule').node;
  assert.equal(saveNode(node, node.header, node.body), 'same');
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), fs.readFileSync(path.join(fixtures, 'rich-book', file), 'utf8'));
});

test('headers are written in the fixed order with scalar quoting', () => {
  const header = makeHeader({ id: 'x', title: 'Lighthouse: A Novel', synopsis: '', status: 'draft', role: 'front', unit: 'chapter' });
  assert.equal(serializeSection(header, 'Body'), '---\nid: x\ntitle: "Lighthouse: A Novel"\nsynopsis: ""\nstatus: draft\nrole: front\nunit: chapter\n---\nBody');
  assert.equal(quoteScalar('yes'), '"yes"');
  assert.equal(quoteScalar("Don't panic, 2"), "Don't panic, 2");
  assert.equal(quoteScalar('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
  const parsed = parseSection('---\r\nid: "q\\"x"\r\ntitle: \'It\'\'s\'\r\nbreak: true\r\nnonsense\r\n---\r\nBody\r\n');
  assert.equal(parsed.header.id, 'q"x');
  assert.equal(parsed.header.title, "It's");
  assert.equal(parsed.header.pageBreak, true);
  assert.equal(parsed.body, 'Body\n');
  assert.ok(parsed.warnings.includes('Ignored header line "nonsense".'));
  assert.equal(parseSection('No header').header.title, 'Untitled');
});

test('slugs, ids, and prefixes', () => {
  assert.equal(slugify("Don't Panic: Part 2!"), 'dont-panic-part-2');
  assert.equal(slugify('!!!'), 'section');
  assert.equal(uniqueID('Intro', new Set(['intro', 'intro-2'])), 'intro-3');
  assert.deepEqual(assignPrefixes(3), ['010', '020', '030']);
  assert.equal(assignPrefixes(100)[0], '0010');
  assert.equal(nextPrefix(['010', '990']), '1000');
});

test('opening an empty folder creates the manuscript, book.json, and the trash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-empty-'));
  const book = loadBook(root);
  assert.equal(book.title, path.basename(root));
  assert.ok(fs.existsSync(path.join(root, 'manuscript', 'trash', '_index.md')));
  assert.equal(fs.readFileSync(path.join(root, 'book.json'), 'utf8'), `{\n  "title" : ${JSON.stringify(path.basename(root))},\n  "version" : 1\n}\n`);
});

test('book.yaml is converted to book.json; an unreadable book.json is left alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-yaml-'));
  fs.writeFileSync(path.join(root, 'book.yaml'), 'title: "Lighthouse: A Novel"\n');
  assert.equal(loadBook(root).title, 'Lighthouse: A Novel');
  assert.ok(!fs.existsSync(path.join(root, 'book.yaml')));
  assert.equal(fs.readFileSync(path.join(root, 'book.json'), 'utf8'), '{\n  "title" : "Lighthouse: A Novel",\n  "version" : 1\n}\n');
  fs.writeFileSync(path.join(root, 'book.json'), '{ broken');
  const book = loadBook(root);
  assert.equal(book.title, path.basename(root));
  assert.equal(fs.readFileSync(path.join(root, 'book.json'), 'utf8'), '{ broken');
  saveTitle(book, 'New');
  assert.equal(loadBook(root).title, 'New');
});

test('creating, moving, swapping, trashing, and emptying the trash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-tree-'));
  let book = loadBook(root);
  const a = createNode(book, null, 'section', 'Alpha');
  book = loadBook(root);
  const g = createNode(book, null, 'group', 'Group');
  book = loadBook(root);
  const b = createNode(book, g, 'section', 'Beta');
  assert.deepEqual(tree(root), ['010-alpha.md', '020-group', '020-group/010-beta.md', '020-group/_index.md', 'trash', 'trash/_index.md']);
  book = loadBook(root);
  moveNode(book, a, b, 'before');
  assert.deepEqual(tree(root), ['010-group', '010-group/010-alpha.md', '010-group/020-beta.md', '010-group/_index.md', 'trash', 'trash/_index.md']);
  book = loadBook(root);
  moveNode(book, b, a, 'before');
  assert.deepEqual(tree(root).slice(0, 3), ['010-group', '010-group/010-beta.md', '010-group/020-alpha.md']);
  book = loadBook(root);
  assert.equal(moveNode(book, g, b, 'inside'), false);
  trashNode(book, a);
  assert.ok(tree(root).includes('trash/010-alpha.md'));
  book = loadBook(root);
  assert.deepEqual(emptyTrash(book), ['alpha']);
  assert.deepEqual(tree(root).filter((p) => p.startsWith('trash')), ['trash', 'trash/_index.md']);
});

test('a 100th sibling widens every prefix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-wide-'));
  for (let i = 0; i < 100; i += 1) createNode(loadBook(root), null, 'section', `S${i}`);
  const names = tree(root).filter((n) => n.endsWith('.md') && !n.startsWith('trash'));
  assert.equal(names[0], '0010-s0.md');
  assert.equal(names[99], '1000-s99.md');
});

test('comments.json reads and writes in its stable layout', () => {
  const root = copy('spec-book');
  const comments = [{
    id: 'a', nodeID: 'the-book', start: 0, length: 3, quote: 'Boo', author: 'Lena', date: '2026-10-20T08:20:00.5+02:00', text: 'x / "y"',
  }];
  fs.writeFileSync(path.join(root, 'comments.json'), JSON.stringify({ version: 1, comments }));
  const loaded = loadComments(root);
  assert.equal(loaded[0].date, '2026-10-20T06:20:00Z');
  saveComments(root, loaded);
  assert.equal(fs.readFileSync(path.join(root, 'comments.json'), 'utf8'), `{
  "comments" : [
    {
      "author" : "Lena",
      "date" : "2026-10-20T06:20:00Z",
      "id" : "a",
      "length" : 3,
      "nodeID" : "the-book",
      "quote" : "Boo",
      "start" : 0,
      "text" : "x / \\"y\\""
    }
  ],
  "version" : 1
}
`);
  assert.throws(() => decodeComments('{"version":1,"comments":[{"color":"red"}]}'));
  assert.throws(() => saveComments(root, [{ ...loaded[0], id: '' }]));
  saveComments(root, []);
  assert.ok(!fs.existsSync(path.join(root, 'comments.json')));
  assert.equal(encodeComments([{ ...loaded[0], color: 'pink' }]).includes('"color" : "pink"'), true);
  assert.deepEqual(repaired([{ ...loaded[0], start: -2 }, { ...loaded[0] }]).length, 1);
});

test('comments shift, trim, re-anchor, and merge', () => {
  const c = { start: 10, length: 5 };
  assert.deepEqual(shiftRange(c, 0, 0, 3), { start: 13, length: 5 });
  assert.deepEqual(shiftRange(c, 10, 0, 2), { start: 12, length: 5 });
  assert.deepEqual(shiftRange(c, 15, 0, 2), { start: 10, length: 5 });
  assert.deepEqual(shiftRange(c, 12, 0, 2), { start: 10, length: 7 });
  assert.deepEqual(shiftRange(c, 8, 10, 0), { start: 8, length: 0 });
  assert.deepEqual(trimRange({ start: 0, length: 12 }, '**Front M** x'), { start: 2, length: 7 });
  assert.deepEqual(reanchor({ start: 20, length: 0, quote: 'ab' }, 'ab ab ab ab ab ab ab ab'), { start: 21, length: 2 });
  assert.deepEqual(reanchor({ start: 5, length: 2, quote: 'zz' }, 'abc'), { start: 3, length: 0 });
  const base = [{ id: '1', text: 'a', author: 'x', date: 'd', nodeID: 'n', start: 0, length: 1, quote: 'q' }];
  const mine = [{ ...base[0], text: 'mine' }, { ...base[0], id: '2' }];
  const theirs = [{ ...base[0], author: 'them' }, { ...base[0], id: '3' }];
  const merged = mergeComments(base, mine, theirs);
  assert.deepEqual(merged.map((m) => [m.id, m.text, m.author]), [['1', 'mine', 'them'], ['2', 'a', 'x'], ['3', 'a', 'x']]);
});

test('markup commands produce exactly the specified text and cursor', () => {
  assert.deepEqual(applyMarkup('strong', 'a word', 2, 6), { text: 'a **word**', anchor: 10, head: 10 });
  assert.deepEqual(applyMarkup('emphasis', 'ab', 1, 1), { text: 'a**b', anchor: 2, head: 2 });
  assert.deepEqual(applyMarkup('subsection', 'one\ntwo', 5, 5), { text: 'one\n# two', anchor: 7, head: 7 });
  assert.deepEqual(applyMarkup('footnote', 'Text.', 5, 5), { text: 'Text.[^1]\n\n[^1]: ', anchor: 17, head: 17 });
  assert.deepEqual(applyMarkup('footnote', 'A[^1]\n\n[^1]: x\n', 1, 1).text, 'A[^2][^1]\n\n[^1]: x\n\n[^2]: ');
  assert.deepEqual(applyMarkup('codeBlock', 'abc', 3, 3, { language: 'swift' }), { text: 'abc\n\n```swift\n\n```\n\n', anchor: 14, head: 14 });
  assert.deepEqual(applyMarkup('codeBlock', '', 0, 0), { text: '\n```\n\n```\n\n', anchor: 4, head: 4 });
  assert.deepEqual(applyMarkup('center', 'One.\n\nTwo\nlines.\n\nThree.', 7, 7), { text: 'One.\n\n::: center\nTwo\nlines.\n:::\n\nThree.', anchor: 31, head: 31 });
  assert.deepEqual(applyMarkup('center', 'A\n\n```mermaid\ngraph\n```\nB', 16, 16).text, 'A\n\n::: center\n```mermaid\ngraph\n```\n:::\n\nB');
  assert.deepEqual(applyMarkup('center', 'x\nTitle\ny', 2, 8).text, 'x\n\n::: center\nTitle\n:::\n\ny');
  assert.deepEqual(applyMarkup('center', 'A\n\n\nB', 2, 2), { text: 'A\n\n::: center\n\n:::\n\nB', anchor: 14, head: 14 });
  assert.deepEqual(applyMarkup('center', '', 0, 0), { text: '::: center\n\n:::\n', anchor: 11, head: 11 });
  assert.deepEqual(applyMarkup('left', 'One.\n\nTwo.', 7, 7), { text: 'One.\n\n::: left\nTwo.\n:::\n', anchor: 23, head: 23 });
  assert.deepEqual(applyMarkup('right', '', 0, 0), { text: '::: right\n\n:::\n', anchor: 10, head: 10 });
  assert.deepEqual(applyMarkup('right', 'x\n\n```mermaid\ngraph\n```', 0, 12).text, '::: right\nx\n\n```mermaid\ngraph\n```\n:::\n');
  assert.deepEqual(applyMarkup('picture', 'An x', 0, 4, { picturePath: 'images/my pic.jpg' }).text, '![An x](<images/my pic.jpg>){width=100%}');
  assert.equal(latestLanguage(['```js\nx\n```', '~~~\n```py\n~~~\n']), '');
  assert.equal(latestLanguage(['```js\nx\n```', 'no code']), 'js');
  assert.deepEqual(matchingCommands('foot').map((c) => c.name), ['Footnote']);
  assert.deepEqual(matchingCommands('pic').map((c) => c.name), ['Picture']);
  assert.deepEqual(changedSpan('hello world', 'hello brave world'), { start: 6, length: 0, insert: 'brave ' });
});

test('whole-book find wraps through the manuscript', () => {
  const finder = Finder.make('cat', { matchCase: false, regex: false, wholeWord: true });
  const parts = [{ id: 'a', text: 'Cat one' }, { id: 'b', text: 'no' }, { id: 'c', text: 'a cat' }];
  assert.deepEqual(finder.next(parts, 'a', 3), { id: 'c', start: 2, length: 3 });
  assert.deepEqual(finder.next(parts, 'c', 5), { id: 'a', start: 0, length: 3 });
  assert.deepEqual(finder.previous(parts, 'a', 0), { id: 'c', start: 2, length: 3 });
  const regex = Finder.make('(c)at', { regex: true });
  assert.equal(regex.replaceAll('cat Cat', '$1ow', true).text, 'cow Cow');
  assert.equal(Finder.make('[', { regex: true }), null);
});

test('pictures move into images/ under a free name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-pic-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-src-'));
  fs.mkdirSync(path.join(root, 'images'));
  fs.writeFileSync(path.join(root, 'images', 'a.png'), 'x');
  fs.writeFileSync(path.join(outside, 'a.png'), 'y');
  assert.equal(placePicture(path.join(outside, 'a.png'), root), 'images/a-2.png');
  assert.ok(!fs.existsSync(path.join(outside, 'a.png')));
  assert.equal(placePicture(path.join(root, 'images', 'a.png'), root), 'images/a.png');
});

test('chapter export and file names', () => {
  const book = loadBook(copy('rich-book'));
  const chapter = exportChapter(book.nodes, 'naming');
  assert.equal(chapter.filename.startsWith('01-'), true);
  assert.ok(!chapter.markdown.includes('Chapter 2'));
  assert.equal(fileTitle('A: b?. '), 'A b');
  assert.equal(timestamped('x.pdf', new Date(2026, 9, 19, 17, 45)), 'x 2026-10-19 17-45.pdf');
});

test('the checker reports errors and warnings', () => {
  const root = copy('spec-book');
  fs.writeFileSync(path.join(root, 'comments.json'), '{"version":1,"comments":[{"id":"a","nodeID":"nope","start":0,"length":0,"quote":"x","author":"A","date":"2026-10-23T18:30:00Z","text":"t"}]}');
  const result = check(root);
  assert.equal(result.status, 0);
  assert.match(result.lines.join('\n'), /warning: comment "a": No section or folder has the id "nope"/);
  fs.writeFileSync(path.join(root, 'comments.json'), '{"version":1,"comments":[{"color":"red"}]}');
  assert.equal(check(root).status, 1);
});

test('underlined headings are shifted by depth like # headings', () => {
  const body = [
    'Title[^1]', '=====', '',
    'Two lines', 'of heading', '---', '',
    '- a list item', '---', '',
    'A paragraph.', '', '---', '',
    '```', 'code', '===', '```', '',
    '    indented', '    ---', '',
    '[^1]: A note.',
  ].join('\n');
  const { text } = transformBody(body, { depth: 2, sectionID: 's' });
  assert.equal(text, [
    '### Title[^s-1]', '',
    '#### Two lines of heading', '',
    '- a list item', '---', '',
    'A paragraph.', '', '---', '',
    '```', 'code', '===', '```', '',
    '    indented', '    ---', '',
    '[^s-1]: A note.',
  ].join('\n'));
  assert.equal(transformBody('Preface\n===', { depth: 1, front: true }).text, '## Preface {-}');
  assert.equal(transformBody('Kept {-}\n---', { depth: 1, front: true }).text, '### Kept {-}');
  const deep = transformBody('Deep\n---', { depth: 5 });
  assert.equal(deep.text, '###### Deep');
  assert.deepEqual(deep.warnings, ['A heading of level 7 was written at level 6.']);
});

test('the example book has the AGENTS.md a new book gets', () => {
  const repo = path.join(fixtures, '..', '..');
  const template = fs.readFileSync(path.join(repo, 'src', 'server', 'new-book-agents.md'), 'utf8');
  const example = fs.readFileSync(path.join(repo, 'examples', 'mybook', 'AGENTS.md'), 'utf8');
  assert.equal(example, template, 'Copy src/server/new-book-agents.md to examples/mybook/AGENTS.md.');
});
