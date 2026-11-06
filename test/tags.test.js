import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tagsIn, tagColor, autoColor, colorValue, tagAttributes, tagMarkup, cleanTagName, decodeTags, encodeTags,
  resolveTagColors, TAG_COLORS,
} from '../shared/tags.js';
import { Renderer, setTagDefinitions } from '../public/js/render.js';
import { Mapped } from '../public/js/mapped.js';
import { exportBook } from '../shared/export.js';
import { check } from '../src/server/check.js';

test('tags are found outside code, with their own colors', () => {
  const text = 'A [draft]{.tag} and [Urgent]{.tag color=red}.\n`[no]{.tag}` [span]{.other} ![pic](x){.tag}\n```\n[no]{.tag}\n```';
  assert.deepEqual(tagsIn(text).map((t) => [t.name, t.color, text.slice(t.start, t.end)]),
    [['draft', null, '[draft]{.tag}'], ['Urgent', 'red', '[Urgent]{.tag color=red}']]);
  assert.deepEqual(tagAttributes('.tag color="dark red" .x'), { isTag: true, color: 'dark red' });
  assert.equal(tagMarkup(' a [b] '), '[a b]{.tag}');
  assert.equal(cleanTagName('x{y}\nz'), 'x y z');
});

test('a tag color comes from its own color, then tags.json, then its name', () => {
  assert.equal(tagColor('Draft', { draft: 'green' }), TAG_COLORS.green);
  assert.equal(tagColor('draft', { draft: 'green' }, 'red'), TAG_COLORS.red);
  assert.equal(tagColor('draft', {}, '#abcdef'), '#ABCDEF');
  assert.equal(tagColor('other', {}), TAG_COLORS[autoColor('other')]);
  assert.equal(autoColor('Other '), autoColor('other'));
  assert.equal(colorValue('nope'), null);
});

test('tags.json reads and writes in the layout of the other book files', () => {
  assert.equal(encodeTags({ draft: 'green', check: '#FFB3B3' }), '{\n  "tags" : {\n    "check" : "#FFB3B3",\n    "draft" : "green"\n  },\n  "version" : 1\n}\n');
  assert.deepEqual(decodeTags('{"version":1,"tags":{"Draft":"green"}}'), { draft: 'green' });
  assert.throws(() => decodeTags('{"version":1,"tags":{"x":"mauve"}}'), /color of "x"/);
  assert.throws(() => decodeTags('{"tags":{}}'), /version/);
});

test('tags render as pills that keep their body offsets, and export as written', () => {
  setTagDefinitions({ draft: 'green' });
  const html = new Renderer({ scope: 's' }).render(Mapped.identity('A [draft]{.tag} and [x]{.other}.'));
  assert.match(html, /<span class="tag" data-tag="draft" style="--tag:#B8EB9E"><span data-o="3">draft<\/span><\/span>/);
  assert.match(html, /<span class="pandoc-span"><span data-o="\d+">x<\/span><\/span>/);
  setTagDefinitions({});
  const book = [{ kind: 'section', header: { id: 'a', title: 'A', role: 'body', status: 'idea', unit: 'text' }, body: 'See [draft]{.tag}.', children: [] }];
  assert.equal(exportBook(book).markdown, '# A\n\nSee [draft]{.tag}.');
  assert.equal(resolveTagColors('See [draft]{.tag} and `[c]{.tag}`.', { draft: 'green' }), 'See [draft]{.tag color=#B8EB9E} and `[c]{.tag}`.');
});

test('the checker reports an unreadable tags.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-tags-'));
  fs.mkdirSync(path.join(root, 'manuscript'));
  fs.writeFileSync(path.join(root, 'book.json'), '{"title":"T","version":1}');
  fs.writeFileSync(path.join(root, 'tags.json'), '{"version":1,"tags":{"x":"mauve"}}');
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.lines[0], /tags.json cannot be read/);
});
