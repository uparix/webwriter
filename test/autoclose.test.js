import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typed, emptyPair, wrapping, fenceToClose } from '../shared/autoclose.js';

/** Type `char` at the `|` in `line`; the action, or null. */
const at = (line, char) => typed(line.replace('|', ''), line.indexOf('|'), char)?.action ?? null;

test('brackets pair before a space or the end, and step over their closer', () => {
  assert.equal(at('see |', '['), 'pair');
  assert.equal(at('[x]|', '('), 'pair');
  assert.equal(at('[x]|', '{'), 'pair');
  assert.equal(at('a ^|', '['), 'pair');
  assert.equal(at('|word', '['), null);
  assert.equal(at('[text|]', ']'), 'over');
  assert.equal(at('(a|)', ')'), 'over');
  assert.equal(at('a|', ')'), null);
});

test('emphasis pairs outside words, nests for strong, and steps over its closer', () => {
  assert.equal(at('a |', '*'), 'pair');
  assert.equal(at('|', '*'), 'pair');
  assert.equal(at('*|*', '*'), 'pair');
  assert.equal(at('*it|*', '*'), 'over');
  assert.equal(at('2|', '*'), null);
  assert.equal(at('snake|', '_'), null);
  assert.equal(at('a |b', '_'), null);
});

test('a space in an empty pair of stars makes a list mark', () => {
  assert.deepEqual(typed('**', 1, ' '), { action: 'unpair', length: 1 });
  assert.equal(at('*a|*', ' '), null);
  assert.equal(at('a|', ' '), null);
});

test('backticks pair inside a line but not where a fence may start', () => {
  assert.equal(at('run |', '`'), 'pair');
  assert.equal(at('|', '`'), null);
  assert.equal(at('  `|', '`'), null);
  assert.equal(at('`x|`', '`'), 'over');
  assert.equal(at('`|`', '`'), 'over');
});

test('backspace takes out an empty pair only', () => {
  assert.equal(emptyPair('[]', 1), true);
  assert.equal(emptyPair('a**', 2), true);
  assert.equal(emptyPair('[a]', 2), false);
  assert.equal(emptyPair('a', 1), false);
});

test('a selection is wrapped in marks, not replaced', () => {
  assert.deepEqual(wrapping('*'), { open: '*', close: '*' });
  assert.deepEqual(wrapping('['), { open: '[', close: ']' });
  assert.equal(wrapping('a'), null);
});

test('enter after an unclosed fence adds its closer', () => {
  assert.equal(fenceToClose(['text', '```js'], 1), '```');
  assert.equal(fenceToClose(['  ~~~~'], 0), '  ~~~~');
  // Already closed below.
  assert.equal(fenceToClose(['```', 'code', '```'], 0), null);
  // On the closing line of a block, or inside it.
  assert.equal(fenceToClose(['```', 'code', '```'], 2), null);
  assert.equal(fenceToClose(['```', '```js'], 1), null);
  // Typed above a code block that names its language.
  assert.equal(fenceToClose(['```', '', '```js', 'x', '```'], 0), '```');
  // Not a fence.
  assert.equal(fenceToClose(['``'], 0), null);
});
