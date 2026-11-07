import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server/server.js';
import { Preferences } from '../src/server/prefs.js';

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
