// `webwriter build`: the book as one web page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../src/server/site.js';

const example = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'mybook');

test('the example book becomes one page with its pictures, diagrams, and stylesheet', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-site-'));
  const result = await buildSite(example, out);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.pictures.sort(), ['images/book-folder.drawio.svg', 'images/open-book.jpg', 'images/writing-workflow.drawio.svg']);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /<title>A Field Guide to Webwriter<\/title>/);
  assert.match(html, /<h2 class="h2"[^>]*>Copyright<\/h2>/);
  assert.match(html, /<img class="picture" src="images\/open-book\.jpg"/);
  assert.doesNotMatch(html, /\/book-file\//);
  assert.match(html, /<pre class="mermaid">flowchart/);
  assert.match(html, /<script src="mermaid\.min\.js"><\/script>/);
  // Notes link to their definitions and back without the app's script.
  assert.match(html, /<a href="#note:g0:preface-1" data-note="g0:preface-1">/);
  assert.match(html, /<a href="#ref:g0:preface-1" class="backref"/);
  assert.doesNotMatch(html, /href="#"/);
  // The trash is left out.
  assert.doesNotMatch(html, /Old Opening/i);
  for (const file of ['app.css', 'mermaid.min.js', 'images/open-book.jpg', 'images/book-folder.drawio.svg', 'images/writing-workflow.drawio.svg']) {
    assert.ok(fs.existsSync(path.join(out, file)), file);
  }
});

test('a book without diagrams gets no Mermaid, and a missing picture is a warning', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-site-book-'));
  fs.mkdirSync(path.join(root, 'manuscript'));
  fs.writeFileSync(path.join(root, 'manuscript', '010-one.md'), '---\nid: one\ntitle: One\n---\nText ![](images/gone.png)\n');
  const out = path.join(root, 'site');
  const result = await buildSite(root, out);
  assert.ok(result.warnings.includes('The picture images/gone.png is not in the book folder.'), result.warnings.join('\n'));
  assert.ok(!fs.existsSync(path.join(out, 'mermaid.min.js')));
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /<script/);
});

test('the output folder cannot be the book folder', async () => {
  await assert.rejects(buildSite(example, example), /must not be the book folder/);
});
