// Pipe tables (`| a | b |`) in a Markdown body: finding the table under the cursor, lining up its
// columns, and changing its rows, columns, and alignment. Only the table's own lines change.
// Offsets are UTF-16 code units, like the editor's.
import { fenceStep } from './fences.js';

export const TABLE_COMMANDS = [
  { id: 'insertTable', name: 'Insert Table', inserts: 'A table with two columns and one row, at the cursor' },
  { id: 'formatTable', name: 'Format Table', inserts: 'Lines up the columns of the table under the cursor' },
  { id: 'rowAbove', name: 'Insert Row Above', inserts: 'An empty row above the current row' },
  { id: 'rowBelow', name: 'Insert Row Below', inserts: 'An empty row below the current row' },
  { id: 'columnLeft', name: 'Insert Column Left', inserts: 'An empty column left of the current column' },
  { id: 'columnRight', name: 'Insert Column Right', inserts: 'An empty column right of the current column' },
  { id: 'deleteRow', name: 'Delete Row', inserts: 'Removes the current row' },
  { id: 'deleteColumn', name: 'Delete Column', inserts: 'Removes the current column' },
  { id: 'alignLeft', name: 'Align Column Left', inserts: ':--- in the delimiter row of the current column' },
  { id: 'alignCenter', name: 'Align Column Center', inserts: ':---: in the delimiter row of the current column' },
  { id: 'alignRight', name: 'Align Column Right', inserts: '---: in the delimiter row of the current column' },
  { id: 'alignNone', name: 'Remove Column Alignment', inserts: '--- in the delimiter row of the current column' },
];

const DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const isBlank = (line) => /^[ \t]*$/.test(line);

/** Columns a string takes on screen: wide East Asian characters count two, combining marks none. */
export function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (/\p{Mn}|\p{Me}|​|‍|️/u.test(char)) continue;
    const wide = (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0xA4CF) || (code >= 0xAC00 && code <= 0xD7A3)
      || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF00 && code <= 0xFF60)
      || (code >= 0xFFE0 && code <= 0xFFE6) || (code >= 0x1F300 && code <= 0x1FAFF) || (code >= 0x20000 && code <= 0x3FFFD);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Cells of one row, split on pipes that are neither escaped nor inside a code span. */
export function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let start = 0;
  let ticks = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') {
      let run = 0;
      while (text[i + run] === '`') run += 1;
      ticks = ticks === run ? 0 : (ticks || run);
      i += run - 1;
      continue;
    }
    if (c === '|' && !ticks) {
      cells.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  cells.push(text.slice(start).trim());
  return cells;
}

/** The column of `column` characters into a row line: the number of cell separators before it. */
function columnAt(line, column) {
  const lead = line.length - line.trimStart().length;
  let col = 0;
  let ticks = 0;
  const starts = line.trimStart().startsWith('|');
  for (let i = 0; i < column && i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') {
      let run = 0;
      while (line[i + run] === '`') run += 1;
      ticks = ticks === run ? 0 : (ticks || run);
      i += run - 1;
      continue;
    }
    if (c === '|' && !ticks && !(starts && i === lead)) col += 1;
  }
  return col;
}

function alignOf(cell) {
  const t = cell.trim();
  if (t.startsWith(':') && t.endsWith(':') && t.length > 1) return 'center';
  if (t.endsWith(':')) return 'right';
  if (t.startsWith(':')) return 'left';
  return 'none';
}

/** The lines of `text` with the offset each starts at. */
function linesOf(text) {
  const lines = [];
  let start = 0;
  for (const line of text.split('\n')) {
    lines.push({ line, start });
    start += line.length + 1;
  }
  return lines;
}

/**
 * The pipe table that holds `offset`, or null. A table is a header row, a delimiter row, and the rows
 * after it up to a blank line, outside fenced code. Returns where it is, its cells, and the cell at `offset`.
 */
export function findTable(text, offset) {
  const lines = linesOf(text);
  let index = lines.findIndex((l, i) => offset >= l.start && (i === lines.length - 1 || offset < lines[i + 1].start));
  if (index < 0) return null;
  const fenced = [];
  let fence = null;
  for (const { line } of lines) {
    const stepped = fenceStep(line, fence);
    fence = stepped.fence;
    fenced.push(stepped.fenced);
  }
  const rowLine = (i) => i >= 0 && i < lines.length && !fenced[i] && !isBlank(lines[i].line) && lines[i].line.includes('|');
  if (!rowLine(index)) return null;
  let first = index;
  while (rowLine(first - 1)) first -= 1;
  // The header is the last line at or above the cursor that has a delimiter row right below it.
  const isDelimiter = (i) => rowLine(i) && DELIMITER.test(lines[i].line) && lines[i].line.includes('-');
  let header = -1;
  for (let i = first; i <= index; i += 1) {
    if (!isDelimiter(i) && isDelimiter(i + 1)) header = i;
  }
  if (header < 0) return null;
  let last = header + 1;
  while (rowLine(last + 1)) last += 1;
  if (index > last) return null;
  const headerCells = splitRow(lines[header].line);
  const aligns = splitRow(lines[header + 1].line).map(alignOf);
  const rows = [];
  for (let i = header + 2; i <= last; i += 1) rows.push(splitRow(lines[i].line));
  const columns = Math.max(headerCells.length, aligns.length, ...rows.map((r) => r.length));
  const pad = (cells, fill) => [...cells, ...Array(columns - cells.length).fill(fill)];
  const row = index <= header + 1 ? 0 : index - header - 1;
  const column = Math.min(columnAt(lines[index].line, offset - lines[index].start), columns - 1);
  const end = lines[last].start + lines[last].line.length;
  return {
    start: lines[header].start,
    end,
    indent: lines[header].line.slice(0, lines[header].line.length - lines[header].line.trimStart().length),
    cells: [pad(headerCells, ''), ...rows.map((r) => pad(r, ''))],
    aligns: pad(aligns, 'none').slice(0, columns),
    row,
    column,
  };
}

/** Text in a cell padded to `width` columns by its alignment. */
function padCell(text, width, align) {
  const room = width - displayWidth(text);
  if (room <= 0) return { text, lead: 0 };
  if (align === 'right') return { text: ' '.repeat(room) + text, lead: room };
  if (align === 'center') {
    const lead = Math.floor(room / 2);
    return { text: ' '.repeat(lead) + text + ' '.repeat(room - lead), lead };
  }
  return { text: text + ' '.repeat(room), lead: 0 };
}

/**
 * The table as text with its columns lined up, and where each cell's text starts in it.
 * `positions[row][column]` is an offset into the returned text; row 0 is the header.
 */
export function formatTable(table) {
  const columns = table.aligns.length;
  const widths = Array.from({ length: columns }, (_, c) => Math.max(3, ...table.cells.map((r) => displayWidth(r[c] ?? ''))));
  const lines = [];
  const positions = [];
  let offset = 0;
  const addRow = (cells) => {
    const starts = [];
    let line = `${table.indent}|`;
    cells.forEach((cell, c) => {
      const padded = padCell(cell, widths[c], table.aligns[c]);
      starts.push(offset + line.length + 1 + padded.lead);
      line += ` ${padded.text} |`;
    });
    positions.push(starts);
    lines.push(line);
    offset += line.length + 1;
  };
  addRow(table.cells[0]);
  const delimiter = table.aligns.map((align, c) => {
    const w = widths[c];
    if (align === 'center') return `:${'-'.repeat(w - 2)}:`;
    if (align === 'right') return `${'-'.repeat(w - 1)}:`;
    if (align === 'left') return `:${'-'.repeat(w - 1)}`;
    return '-'.repeat(w);
  });
  const delimiterLine = `${table.indent}| ${delimiter.join(' | ')} |`;
  lines.push(delimiterLine);
  offset += delimiterLine.length + 1;
  for (const row of table.cells.slice(1)) addRow(row);
  return { text: lines.join('\n'), positions };
}

const clone = (table) => ({ ...table, cells: table.cells.map((r) => [...r]), aligns: [...table.aligns] });
const emptyRow = (table) => Array(table.aligns.length).fill('');

/**
 * Apply a table command at `offset` of `text`. `at` may name the cell instead ({ row, column }),
 * as a click in the rendered table does. Returns { text, anchor, head } for the whole body, or null
 * when there is no table there or the command does not apply.
 */
export function editTable(command, text, offset, at = null) {
  if (command === 'insertTable') return insertTable(text, offset);
  const found = findTable(text, offset);
  if (!found) return null;
  const table = clone(found);
  let row = at ? at.row : found.row;
  let column = at ? at.column : found.column;
  const rows = table.cells.length;
  const columns = table.aligns.length;
  switch (command) {
    case 'formatTable':
      break;
    case 'nextCell':
      if (column + 1 < columns) column += 1;
      else {
        column = 0;
        row += 1;
        if (row >= rows) table.cells.push(emptyRow(table));
      }
      break;
    case 'previousCell':
      if (column > 0) column -= 1;
      else if (row > 0) {
        row -= 1;
        column = columns - 1;
      }
      break;
    case 'nextRow':
      row += 1;
      if (row >= rows) table.cells.push(emptyRow(table));
      break;
    case 'rowAbove':
      // Nothing goes above the header. The new row is the first one below it.
      row = Math.max(1, row);
      table.cells.splice(row, 0, emptyRow(table));
      break;
    case 'rowBelow':
      row += 1;
      table.cells.splice(row, 0, emptyRow(table));
      break;
    case 'deleteRow':
      if (row === 0) return null;
      table.cells.splice(row, 1);
      row = Math.min(row, table.cells.length - 1);
      break;
    case 'columnLeft':
    case 'columnRight':
      if (command === 'columnRight') column += 1;
      for (const r of table.cells) r.splice(column, 0, '');
      table.aligns.splice(column, 0, 'none');
      break;
    case 'deleteColumn':
      if (columns <= 1) return null;
      for (const r of table.cells) r.splice(column, 1);
      table.aligns.splice(column, 1);
      column = Math.min(column, columns - 2);
      break;
    case 'alignLeft':
    case 'alignCenter':
    case 'alignRight':
    case 'alignNone':
      table.aligns[column] = command.slice(5).toLowerCase();
      break;
    default:
      return null;
  }
  const formatted = formatTable(table);
  const next = text.slice(0, found.start) + formatted.text + text.slice(found.end);
  const cellStart = found.start + formatted.positions[row][column];
  const cellText = table.cells[row][column];
  // Moving into a cell selects its text, so typing replaces it.
  const select = ['nextCell', 'previousCell', 'nextRow'].includes(command) && cellText !== '';
  return { text: next, anchor: cellStart, head: select ? cellStart + cellText.length : cellStart, start: found.start, end: found.end, length: formatted.text.length };
}

/** Enter on the last row when it is empty leaves the table: the row goes, and a new paragraph starts below. */
export function leaveTable(text, offset) {
  const found = findTable(text, offset);
  if (!found || found.row !== found.cells.length - 1 || found.row === 0) return null;
  if (found.cells[found.row].some((cell) => cell !== '')) return null;
  const table = clone(found);
  table.cells.pop();
  const formatted = formatTable(table).text;
  // The new paragraph sits on its own line, with a blank line between it and any text below.
  const rest = text.slice(found.end).replace(/^\n+/, '');
  const next = `${text.slice(0, found.start)}${formatted}\n\n${rest ? `\n\n${rest}` : ''}`;
  const cursor = found.start + formatted.length + 2;
  return { text: next, anchor: cursor, head: cursor };
}

/** A two-column table at the cursor, with a blank line before and after, and its first heading selected. */
function insertTable(text, offset) {
  const at = Math.max(0, Math.min(offset, text.length));
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
  const emptyLine = isBlank(text.slice(lineStart, lineEnd));
  let before = emptyLine ? text.slice(0, lineStart) : text.slice(0, lineEnd);
  let after = emptyLine ? text.slice(lineEnd) : text.slice(lineEnd);
  if (before !== '' && !before.endsWith('\n\n')) before += before.endsWith('\n') ? '\n' : '\n\n';
  after = after.replace(/^\n*/, '');
  const table = formatTable({ indent: '', aligns: ['none', 'none'], cells: [['Column 1', 'Column 2'], ['', '']] });
  const next = `${before}${table.text}\n${after ? `\n${after}` : ''}`;
  const anchor = before.length + table.positions[0][0];
  return { text: next, anchor, head: anchor + 'Column 1'.length };
}
