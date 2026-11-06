import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTable, formatTable, editTable, leaveTable, splitRow, displayWidth } from '../shared/table.js';

const body = 'Intro.\n\n| Unit | Numbered |\n|:--|--:|\n| Chapter | yes |\n| Text | no |\n\nAfter.';
const at = (needle, plus = 0) => body.indexOf(needle) + plus;

test('the table under the cursor, with its row and column', () => {
  const t = findTable(body, at('yes'));
  assert.equal(body.slice(t.start, t.end), '| Unit | Numbered |\n|:--|--:|\n| Chapter | yes |\n| Text | no |');
  assert.deepEqual(t.cells, [['Unit', 'Numbered'], ['Chapter', 'yes'], ['Text', 'no']]);
  assert.deepEqual(t.aligns, ['left', 'right']);
  assert.deepEqual([t.row, t.column], [1, 1]);
  assert.deepEqual([findTable(body, at('Unit')).row, findTable(body, at(':--')).row], [0, 0]);
  assert.equal(findTable(body, at('Intro')), null);
  assert.equal(findTable('```\n| a | b |\n|---|---|\n```', 5), null);
  assert.equal(findTable('| not | a table |', 3), null);
});

test('cells split on pipes outside code and escapes; wide characters count two', () => {
  assert.deepEqual(splitRow('| a \\| b | `c | d` | e |'), ['a \\| b', '`c | d`', 'e']);
  assert.deepEqual(splitRow('a | b'), ['a', 'b']);
  assert.equal(displayWidth('日本'), 4);
  assert.equal(displayWidth('é'), 1);
});

test('formatting lines up columns by alignment', () => {
  const { text } = formatTable(findTable(body, at('yes')));
  assert.equal(text, '| Unit    | Numbered |\n| :------ | -------: |\n| Chapter |      yes |\n| Text    |       no |');
});

test('Tab moves to the next cell, selects its text, and adds a row after the last', () => {
  const r = editTable('nextCell', body, at('Chapter'));
  assert.equal(r.text.slice(r.anchor, r.head), 'yes');
  const end = editTable('nextCell', body, at('no'));
  assert.match(end.text, /\| Text {4}\| {7}no \|\n\| {9}\| {10}\|\n\nAfter\./);
  assert.equal(end.text.slice(end.anchor - 2, end.anchor), '| ');
  const back = editTable('previousCell', body, at('Chapter'));
  assert.equal(back.text.slice(back.anchor, back.head), 'Numbered');
});

test('rows and columns are inserted and deleted around the current cell', () => {
  const rows = (r) => findTable(r.text, r.anchor).cells;
  assert.deepEqual(rows(editTable('rowAbove', body, at('yes'))), [['Unit', 'Numbered'], ['', ''], ['Chapter', 'yes'], ['Text', 'no']]);
  assert.deepEqual(rows(editTable('rowAbove', body, at('Unit'))), [['Unit', 'Numbered'], ['', ''], ['Chapter', 'yes'], ['Text', 'no']]);
  assert.deepEqual(rows(editTable('rowBelow', body, at('yes'))), [['Unit', 'Numbered'], ['Chapter', 'yes'], ['', ''], ['Text', 'no']]);
  assert.deepEqual(rows(editTable('deleteRow', body, at('yes'))), [['Unit', 'Numbered'], ['Text', 'no']]);
  assert.equal(editTable('deleteRow', body, at('Unit')), null);
  assert.deepEqual(rows(editTable('columnLeft', body, at('yes'))), [['Unit', '', 'Numbered'], ['Chapter', '', 'yes'], ['Text', '', 'no']]);
  assert.deepEqual(rows(editTable('columnRight', body, at('yes'))), [['Unit', 'Numbered', ''], ['Chapter', 'yes', ''], ['Text', 'no', '']]);
  assert.deepEqual(rows(editTable('deleteColumn', body, at('yes'))), [['Unit'], ['Chapter'], ['Text']]);
  assert.deepEqual(findTable(editTable('alignCenter', body, at('Chapter')).text, 12).aligns, ['center', 'right']);
  // A cell named directly, as a click in the rendered table names it.
  assert.deepEqual(rows(editTable('deleteRow', body, at('Unit'), { row: 2, column: 0 })), [['Unit', 'Numbered'], ['Chapter', 'yes']]);
  assert.ok(editTable('rowBelow', body, at('Chapter')).text.endsWith('\n\nAfter.'));
  assert.ok(editTable('rowBelow', body, at('Chapter')).text.startsWith('Intro.\n\n'));
});

test('inserting a table and leaving it with Enter on an empty last row', () => {
  const r = editTable('insertTable', 'Text here', 9);
  assert.equal(r.text, 'Text here\n\n| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |\n');
  assert.equal(r.text.slice(r.anchor, r.head), 'Column 1');
  const empty = editTable('insertTable', '', 0);
  assert.ok(empty.text.startsWith('| Column 1'));
  const added = editTable('nextRow', body, at('no')).text;
  const left = leaveTable(added, added.lastIndexOf('|') - 2);
  assert.equal(left.text, `Intro.\n\n${formatTable(findTable(body, 12)).text}\n\n\n\nAfter.`);
  assert.equal(left.text.slice(left.anchor), '\n\nAfter.');
  assert.equal(leaveTable(body, at('no')), null);
});
