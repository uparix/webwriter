// The browser renderer, run in Node through test/browser-paths.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, renderSection, bookPath, widthPercent, safeHref } from '../public/js/render.js';
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

test('underlined headings show at their depth, without Pandoc attributes', () => {
  const node = { kind: 'section', header: { id: 'p', title: 'Piece', role: 'body' }, body: 'Sub {-}\n===\n\nLower\n---\n', children: [] };
  const section = renderSection(node, [{ header: { id: 'g', role: 'body' } }], null, (n) => n.body);
  assert.match(section, /<h3 class="h3"[^>]*><span data-o="0">Sub<\/span><\/h3>/);
  assert.match(section, /<h4 class="h4"[^>]*><span data-o="\d+">Lower<\/span><\/h4>/);
  assert.match(render('Plain\n==='), /<h1 class="h1"/);
});

test('a fenced div such as ::: center wraps its blocks, nests, and ignores colons in code', () => {
  const body = '::: center\nA **line**.\n\n```\n:::\n```\n\n::: {.center .note}\ninner\n:::\n:::\n\nAfter.';
  const html = render(body);
  assertSpansMatch(html, body);
  const plain = html.replace(/<\/?span[^>]*>/g, '');
  assert.match(plain, /^<div class="fenced-div div-center" data-line="0"><p data-line="1">A <strong>/);
  assert.match(plain, /<code>:::\n<\/code><\/pre><div class="fenced-div div-center div-note" data-line="7"><p data-line="8">inner<\/p><\/div><\/div><p data-line="12">After/);
  assert.match(render('::: right\nx\n:::'), /^<div class="fenced-div div-right" data-line="0">/);
  assert.match(render('Text\n::: center\nopen').replace(/<\/?span[^>]*>/g, ''), /<p data-line="0">Text<\/p><div class="fenced-div div-center" data-line="1"><p data-line="2">open<\/p><\/div>/);
});

test('only web, mail, and note links can be followed', () => {
  for (const ok of ['https://pandoc.org', 'http://x.org/a?b', 'mailto:a@b.org', '#note', 'HTTPS://X.ORG']) assert.equal(safeHref(ok), ok);
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '/book-file/images/x.svg', 'images/x.svg', '//evil.org', 'file:///etc/passwd']) {
    assert.equal(safeHref(bad), null, bad);
  }
  const html = render('[a](javascript:alert(1)) <javascript:alert(2)> [b](https://x.org)');
  assert.doesNotMatch(html, /href="javascript/i);
  assert.match(html, /<a class="external blocked" title="Not followed: javascript:alert\(1\)">/);
  assert.match(html, /<a href="https:\/\/x\.org" class="external">/);
});
