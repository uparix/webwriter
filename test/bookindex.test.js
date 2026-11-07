// Index pieces: the numbered list of the pieces that follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_BODY, hasIndex, indexEntries, indexMarkdown, expandIndex } from '../shared/bookindex.js';
import { exportBook } from '../shared/export.js';
import { renderSection, setBookNodes } from '../public/js/render.js';

const node = (id, children = [], body = '') => ({
  kind: children.length ? 'group' : 'section',
  header: { id, title: id.toUpperCase(), synopsis: '', status: 'idea', role: 'body', unit: null, pageBreak: null },
  body,
  children,
});

const book = () => [
  node('before'),
  node('index', [], INDEX_BODY),
  node('one', [node('one-a', [node('deep-1'), node('deep-2')]), node('one-b')]),
  node('two'),
  node('trash', [node('gone')]),
];

test('an index numbers every following piece as a tree', () => {
  const entries = indexEntries(book(), 'index').map((e) => [e.number, e.id, e.depth]);
  assert.deepEqual(entries, [
    ['1', 'one', 0], ['1.1', 'one-a', 1], ['1.1.1', 'deep-1', 2], ['1.1.2', 'deep-2', 2], ['1.2', 'one-b', 1], ['2', 'two', 0],
  ]);
});

test('an index inside a folder lists its later siblings, then what follows the folder', () => {
  const roots = [node('a', [node('x'), node('idx', [], INDEX_BODY), node('y')]), node('b')];
  assert.deepEqual(indexEntries(roots, 'idx').map((e) => e.number + ' ' + e.id), ['1 y', '2 b']);
});

test('the index fence is found and replaced, and other fences are kept', () => {
  assert.ok(hasIndex('Intro\n\n```index\n```\n'));
  assert.ok(!hasIndex('```js\nindex\n```\n'));
  assert.equal(expandIndex('A\n```index\n```\n```js\nx\n```\nB', 'LIST'), 'A\nLIST\n```js\nx\n```\nB');
});

test('index Markdown escapes titles and indents by depth', () => {
  const md = indexMarkdown([{ number: '1', title: 'A *b*', depth: 0 }, { number: '1.1', title: 'C', depth: 1 }]);
  assert.equal(md, '1  A \\*b\\*\\\n    1.1  C');
});

test('export writes the index out', () => {
  const { markdown } = exportBook(book());
  assert.ok(!markdown.includes('```index'));
  assert.ok(markdown.includes('1.1.2  DEEP-2'));
  assert.ok(!markdown.includes('GONE'));
});

test('the rendered index links each entry to its piece', () => {
  const roots = book();
  setBookNodes(roots);
  const html = renderSection(roots[1], [], null, (n) => n.body);
  assert.match(html, /<span class="book-index-number">1\.1\.1<\/span><a href="#" data-open-node="deep-1">DEEP-1<\/a>/);
  assert.ok(!html.includes('<pre'));
});
