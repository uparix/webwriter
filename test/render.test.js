// The browser renderer, run in Node through test/browser-paths.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, renderSection, bookPath, widthPercent } from '../public/js/render.js';
import { Mapped, shiftHeadings, prepareNotes } from '../public/js/mapped.js';

const render = (body) => new Renderer({ scope: 's' }).render(Mapped.identity(body));

/** Every offset-carrying span must hold exactly the body text at its offset. */
function assertSpansMatch(html, body) {
  for (const [, offset, text] of html.matchAll(/<span data-o="(\d+)">([^<]*)<\/span>/g)) {
    const plain = text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    assert.equal(body.substr(Number(offset), plain.length), plain, `span at ${offset}`);
  }
}

test('rendered text keeps body offsets', () => {
  const body = 'A **bold** and *em* `code` [link](http://x.org) \\* &amp; x.[^1]\n\n> quote\n> more\n\n- one\n- two\n\n| a | b |\n|---|--:|\n| *x* | y |\n\n```js\nlet a = "s"; // c\n```\n\n[^1]: Note.\n';
  const html = render(body);
  assertSpansMatch(html, body);
  assert.match(html, /<strong><span data-o="4">bold<\/span><\/strong>/);
  assert.match(html, /<sup class="fnref"[^>]*><a href="#" data-note="s:1">1<\/a><\/sup>/);
  assert.match(html, /<ul class="tight"[^>]*><li>.*one.*<\/li><li>.*two.*<\/li><\/ul>/);
  assert.match(html, /<th style="text-align:right">/);
  assert.match(html, /class="tok-keyword"><span data-o="\d+">let</);
  assert.match(html, /<li id="note:s:1"><p>Note\.<\/p>/);
});

test('notes: missing definitions, inline notes, unclosed fences', () => {
  assert.match(render('x[^nope]'), /class="warning missing-note"/);
  assert.match(render('x^[inline]'), /data-note="s:__inline_1">1</);
  assert.match(render('```\ncode'), /Unclosed code fence\./);
  const notes = prepareNotes(Mapped.identity('a[^1]\n[^1]: one\n    more\nb'));
  assert.equal(notes.definitions.get('1'), 'one\nmore');
  assert.equal(notes.mapped.text, 'a1\n\n\nb');
});

test('headings shift by depth and hide Pandoc attributes', () => {
  const shifted = shiftHeadings('# Sub {-}\n```\n# not\n```', 2);
  assert.equal(shifted.text, '### Sub {-}\n```\n# not\n```');
  assert.match(render(shifted.text), /<h3 class="h3"[^>]*><span data-o="\d+">Sub<\/span><\/h3>/);
  const section = renderSection({ kind: 'section', header: { id: 'p', title: 'Preface', role: 'front' }, body: 'Hi', children: [] }, [], null, (n) => n.body);
  assert.match(section, /<p class="kicker">Front matter<\/p><h1 class="h1 node-title">Preface<\/h1>/);
});

test('pictures and export HTML blocks', () => {
  assert.equal(bookPath('images/a b.jpg'), 'images/a b.jpg');
  assert.equal(bookPath('../outside.jpg'), null);
  assert.equal(bookPath('https://x.org/a.png'), null);
  assert.equal(widthPercent('width=40%'), 40);
  assert.match(render('![c](images/a.jpg){width=40%}'), /<img class="picture" src="\/book-file\/images\/a.jpg"[^>]*style="width:40%">/);
  assert.match(render('![c](../x.jpg)'), /\[picture: \.\.\/x\.jpg\]/);
  assert.match(render('<div class="page-break"></div>'), /page-break-mark/);
  assert.match(render('<p class="chapter-number">Chapter 2</p>'), /<p class="division"[^>]*>Chapter 2<\/p>/);
});
