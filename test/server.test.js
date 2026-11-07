import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from '../src/server/server.js';
import { Preferences } from '../src/server/prefs.js';
import { makeHeader, serializeSection } from '../src/server/header.js';
import { pandocExecutable } from '../src/server/pandoc.js';

/** A server on a fresh book, on a free port, and a way to call it as the page does. */
async function serve() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-server-'));
  const prefs = new Preferences(path.join(root, '..', `${path.basename(root)}-prefs.json`));
  const { server } = createServer({ book: root, prefs, quitWhenClosed: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, raw = false) => {
    const headers = { 'X-Webwriter': '1' };
    if (!raw && body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + url, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { root, server, call };
}

test('diagrams are named in images/ and written there only', async () => {
  const { root, server, call } = await serve();
  try {
    assert.equal((await call('POST', '/api/diagram/new', { name: 'Review Flow' })).data.path, 'images/review-flow.drawio.svg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxfile/&gt;"><text>Ü</text></svg>';
    assert.equal((await call('POST', '/api/diagram/write?path=images/review-flow.drawio.svg', svg, true)).status, 200);
    assert.equal(fs.readFileSync(path.join(root, 'images/review-flow.drawio.svg'), 'utf8'), svg);
    assert.equal((await call('POST', '/api/diagram/new', { name: 'Review Flow' })).data.path, 'images/review-flow-2.drawio.svg');
    assert.equal((await call('POST', '/api/diagram/write?path=../evil.svg', svg, true)).status, 400);
    assert.equal((await call('POST', '/api/diagram/write?path=manuscript/x.svg', svg, true)).status, 400);
    assert.equal((await call('POST', '/api/diagram/write?path=images/x.js', svg, true)).status, 400);
    assert.equal((await call('POST', '/api/diagram/write?path=images/x.svg', 'not svg', true)).status, 400);
    const forbidden = await fetch(`http://127.0.0.1:${server.address().port}/api/diagram/new`, { method: 'POST' });
    assert.equal(forbidden.status, 403);
  } finally {
    server.close();
  }
});

test('a new index goes first in the book and holds the index fence', async () => {
  const { server, call } = await serve();
  try {
    await call('POST', '/api/create', { kind: 'section', title: 'Opening' });
    const { id } = (await call('POST', '/api/create', { kind: 'index', title: 'Index', placement: { type: 'top', id: null } })).data;
    const { nodes } = (await call('GET', '/api/book')).data;
    const first = nodes.find((n) => n.header.id !== 'trash');
    assert.equal(first.header.id, id);
    assert.equal(first.body, '```index\n```\n');
  } finally {
    server.close();
  }
});

/** A piece written straight into the book folder, as another program would. */
function writePiece(root, relative, fields, body = '') {
  const file = path.join(root, 'manuscript', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeSection(makeHeader(fields), body));
}

/** An index, a chapter folder with one text, and a chapter text. */
function writeSmallBook(root) {
  writePiece(root, '010-contents.md', { id: 'contents', title: 'Contents' }, '```index\n```\n');
  writePiece(root, '020-one/_index.md', { id: 'one', title: 'One', unit: 'chapter' }, 'The first chapter.\n');
  writePiece(root, '020-one/010-alpha.md', { id: 'alpha', title: 'Alpha' }, 'Alpha text.\n');
  writePiece(root, '030-two.md', { id: 'two', title: 'Two', unit: 'chapter' }, 'Beta text.\n');
}

const order = (nodes) => nodes.filter((n) => n.header.id !== 'trash').map((n) => n.header.id);

test('moves reorder and nest pieces on disk, and a folder cannot go into itself', async () => {
  const { root, server, call } = await serve();
  try {
    for (const [kind, title] of [['section', 'A'], ['section', 'B'], ['group', 'F']]) {
      await call('POST', '/api/create', { kind, title });
    }
    assert.deepEqual((await call('POST', '/api/move', { movingID: 'b', targetID: 'a', zone: 'before' })).data, { moved: true });
    let { nodes } = (await call('GET', '/api/book')).data;
    assert.deepEqual(order(nodes), ['b', 'a', 'f']);
    assert.deepEqual(fs.readdirSync(path.join(root, 'manuscript')).filter((n) => n !== 'trash').sort(), ['010-b.md', '020-a.md', '030-f']);

    assert.equal((await call('POST', '/api/move', { movingID: 'a', targetID: 'f', zone: 'inside' })).data.moved, true);
    ({ nodes } = (await call('GET', '/api/book')).data);
    assert.deepEqual(order(nodes), ['b', 'f']);
    assert.deepEqual(nodes.find((n) => n.header.id === 'f').children.map((n) => n.header.id), ['a']);
    assert.ok(fs.existsSync(path.join(root, 'manuscript', '020-f', '010-a.md')));

    assert.equal((await call('POST', '/api/move', { movingID: 'f', targetID: 'a', zone: 'before' })).data.moved, false);
    assert.equal((await call('POST', '/api/move', { movingID: 'missing', targetID: 'a', zone: 'before' })).data.moved, false);
  } finally {
    server.close();
  }
});

test('a new text below another goes right after it', async () => {
  const { server, call } = await serve();
  try {
    for (const title of ['A', 'C']) await call('POST', '/api/create', { kind: 'section', title });
    await call('POST', '/api/create', { kind: 'section', title: 'B', placement: { type: 'below', id: 'a' } });
    assert.deepEqual(order((await call('GET', '/api/book')).data.nodes), ['a', 'b', 'c']);
    assert.equal((await call('POST', '/api/create', { kind: 'section', title: '  ' })).status, 400);
  } finally {
    server.close();
  }
});

test('trashed pieces leave the manuscript, and emptying the trash deletes them', async () => {
  const { root, server, call } = await serve();
  try {
    for (const title of ['Keep', 'Drop']) await call('POST', '/api/create', { kind: 'section', title });
    await call('POST', '/api/trash', { id: 'drop' });
    let { nodes } = (await call('GET', '/api/book')).data;
    assert.deepEqual(order(nodes), ['keep']);
    assert.deepEqual(nodes.find((n) => n.header.id === 'trash').children.map((n) => n.header.id), ['drop']);
    await call('POST', '/api/empty-trash');
    ({ nodes } = (await call('GET', '/api/book')).data);
    assert.equal(nodes.find((n) => n.header.id === 'trash').children.length, 0);
    assert.deepEqual(fs.readdirSync(path.join(root, 'manuscript', 'trash')).filter((n) => n !== '_index.md'), []);
  } finally {
    server.close();
  }
});

test('a save is refused when the file changed since the page read it', async () => {
  const { root, server, call } = await serve();
  try {
    await call('POST', '/api/create', { kind: 'section', title: 'Text' });
    const [node] = (await call('GET', '/api/book')).data.nodes.filter((n) => n.header.id === 'text');
    const save = (body, expected) => call('POST', '/api/node/save', { file: node.file, header: node.header, body, expected });
    assert.equal((await save('First.\n', { header: node.header, body: '' })).data.result, 'saved');
    fs.writeFileSync(node.file, serializeSection(node.header, 'Changed elsewhere.\n'));
    assert.deepEqual((await save('Second.\n', { header: node.header, body: 'First.\n' })).data, { conflict: true });
    assert.match(fs.readFileSync(node.file, 'utf8'), /Changed elsewhere/);
    assert.equal((await call('POST', '/api/node/save', { file: path.join(root, 'book.json'), header: node.header, body: '' })).status, 400);
    assert.equal((await call('POST', '/api/title', { title: 'New Title' })).data.result, 'saved');
    assert.equal((await call('GET', '/api/book')).data.title, 'New Title');
  } finally {
    server.close();
  }
});

test('the manuscript export writes the index out, with page breaks and chapter numbers', async () => {
  const { root, server, call } = await serve();
  try {
    writeSmallBook(root);
    const file = path.join(root, 'out.md');
    const { data } = await call('POST', '/api/export/manuscript', { file });
    assert.equal(data.file, file);
    const markdown = fs.readFileSync(file, 'utf8');
    assert.ok(markdown.includes('1\u00a0\u00a0One\\\n\u00a0\u00a0\u00a0\u00a01.1\u00a0\u00a0Alpha\\\n2\u00a0\u00a0Two'));
    assert.ok(!markdown.includes('```index'));
    assert.ok(markdown.includes('<p class="chapter-number">Chapter 2</p>'));
    assert.ok(markdown.includes('<div class="page-break"></div>'));
    assert.ok(markdown.endsWith('\n'));
  } finally {
    server.close();
  }
});

test('each window gets a hello with the number of windows open', async () => {
  const { server } = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const opened = [];
  const hello = async () => {
    const controller = new AbortController();
    opened.push(controller);
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = response.body.getReader();
    const { value } = await reader.read();
    return JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ''));
  };
  try {
    assert.equal((await hello()).windows, 1);
    const second = await hello();
    assert.equal(second.windows, 2);
    assert.equal(second.type, 'hello');
  } finally {
    for (const controller of opened) controller.abort();
    server.close();
  }
});

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const wordSkip = !pandocExecutable() ? 'Pandoc is not installed' : !hasUnzip ? 'unzip is not installed' : false;
const documentXML = (docx) => execFileSync('unzip', ['-p', docx, 'word/document.xml'], { encoding: 'utf8' });

test('Export Word writes the whole book into one Word file', { skip: wordSkip }, async () => {
  const { root, server, call } = await serve();
  try {
    writeSmallBook(root);
    const file = path.join(root, 'book.docx');
    const { data } = await call('POST', '/api/export/word-book', { file });
    assert.deepEqual(data, { file, warnings: [] });
    const xml = documentXML(file);
    assert.equal(xml.match(/<w:br w:type="page"\/>/g)?.length, 2);
    for (const text of ['Chapter 1', 'Chapter 2', 'Alpha text.', 'Beta text.', '1.1\u00a0\u00a0Alpha']) {
      assert.ok(xml.includes(text), text);
    }
    assert.ok(!xml.includes('page-break') && !xml.includes('chapter-number'));
    assert.equal((await call('POST', '/api/export/word-book', { file: path.join(root, 'missing', 'x.docx') })).status, 400);
  } finally {
    server.close();
  }
});

test('Export Chapters to Word writes a file for each chapter, with its number', { skip: wordSkip }, async () => {
  const { root, server, call } = await serve();
  try {
    writeSmallBook(root);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-word-'));
    const { data } = await call('POST', '/api/export/word', { dir });
    assert.equal(data.files.length, 2);
    assert.ok(data.files.every((name) => name.endsWith('.docx')));
    const first = documentXML(path.join(dir, data.files.find((name) => name.startsWith('01-'))));
    assert.ok(first.includes('Chapter 1') && first.includes('Alpha text.'));
    assert.ok(!first.includes('Beta text.'));
  } finally {
    server.close();
  }
});

test('a new book is a folder with its name and title, opened at once', async () => {
  const { server, call } = await serve();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-new-'));
  try {
    const { data } = await call('POST', '/api/book/new', { parent, title: 'My Novel' });
    const root = path.join(parent, 'My Novel');
    assert.equal(data.root, root);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'book.json'), 'utf8')), { title: 'My Novel', version: 1 });
    assert.ok(fs.statSync(path.join(root, 'manuscript', 'trash')).isDirectory());
    const book = (await call('GET', '/api/book')).data;
    assert.equal(book.root, root);
    assert.equal(book.title, 'My Novel');
    assert.deepEqual(order(book.nodes), []);

    // A folder that is already there is used only when it is empty.
    fs.mkdirSync(path.join(parent, 'Empty'));
    assert.equal((await call('POST', '/api/book/new', { parent, title: 'Empty' })).status, 200);
    const taken = await call('POST', '/api/book/new', { parent, title: 'My Novel' });
    assert.equal(taken.status, 400);
    assert.match(taken.data.error, /already exists/);
    for (const title of ['', '  ', 'a/b', 'a\\b', '..', '.hidden']) {
      assert.equal((await call('POST', '/api/book/new', { parent, title })).status, 400, JSON.stringify(title));
    }
    assert.equal((await call('POST', '/api/book/new', { parent: path.join(parent, 'missing'), title: 'X' })).status, 400);
  } finally {
    server.close();
  }
});
