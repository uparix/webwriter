// The header the application owns at the top of every Markdown file.
import { STATUSES, ROLES, UNITS } from '../../shared/tree.js';

const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']);
const isAlnum = (c) => /^[A-Za-z0-9]$/.test(c);

function isPlain(value) {
  if (!isAlnum(value[0])) return false;
  return [...value].every((c) => isAlnum(c) || ' .,\'_-'.includes(c));
}

/** A scalar written plain when that is safe, otherwise double-quoted with `\\`, `\"`, and `\n` escapes. */
export function quoteScalar(value) {
  if (value === '') return '""';
  if (isPlain(value) && !RESERVED.has(value.toLowerCase())) return value;
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
  return `"${escaped}"`;
}

function unquoteDouble(value) {
  let out = '';
  const chars = [...value.slice(1)];
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === '\\') {
      i += 1;
      if (i >= chars.length) break;
      out += chars[i] === 'n' ? '\n' : chars[i];
      continue;
    }
    if (char === '"') break;
    out += char;
  }
  return out;
}

export function parseScalar(raw) {
  const value = raw.replace(/^[ \t]+|[ \t]+$/g, '');
  if (value.startsWith('"')) return unquoteDouble(value);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

export function normalizeNewlines(text) {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

export function makeHeader(fields) {
  return {
    id: fields.id, title: fields.title, synopsis: fields.synopsis ?? '', status: fields.status ?? 'idea',
    role: fields.role ?? 'body', unit: fields.unit ?? null, pageBreak: fields.pageBreak ?? null,
  };
}

export function sameHeader(a, b) {
  return a.id === b.id && a.title === b.title && a.synopsis === b.synopsis && a.status === b.status
    && a.role === b.role && (a.unit ?? null) === (b.unit ?? null) && (a.pageBreak ?? null) === (b.pageBreak ?? null);
}

/** The header in its fixed field order, one newline, then the body exactly as given. */
export function serializeSection(header, body) {
  const lines = [
    '---',
    `id: ${quoteScalar(header.id)}`,
    `title: ${quoteScalar(header.title)}`,
    `synopsis: ${quoteScalar(header.synopsis)}`,
    `status: ${header.status}`,
    `role: ${header.role}`,
  ];
  if (header.unit) lines.push(`unit: ${header.unit}`);
  else if (header.pageBreak != null) lines.push(`break: ${header.pageBreak ? 'true' : 'false'}`);
  lines.push('---', '');
  return lines.join('\n') + body;
}

/** `---\n<block>\n---\n?<body>`, with the shortest block. */
function splitHeader(text) {
  if (!text.startsWith('---\n')) return null;
  const rest = text.slice(4);
  const close = rest.indexOf('\n---');
  if (close < 0) return null;
  const block = rest.slice(0, close);
  const after = rest.slice(close + 4);
  return { block, body: after.startsWith('\n') ? after.slice(1) : after };
}

function headerFields(block, warnings) {
  const fields = {};
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      warnings.push(`Ignored header line "${line}".`);
      continue;
    }
    fields[match[1]] = parseScalar(match[2]);
  }
  return fields;
}

function headerFrom(fields, warnings) {
  for (const key of ['id', 'title', 'synopsis', 'status', 'role']) {
    if (!(key in fields)) warnings.push(`Header is missing ${key}.`);
  }
  let unit = null;
  if ('unit' in fields) {
    if (UNITS.includes(fields.unit)) unit = fields.unit;
    else warnings.push(`Unit "${fields.unit}" is not part, chapter, section, or text.`);
  }
  let pageBreak = null;
  if ('break' in fields) {
    if (fields.break === 'true') pageBreak = true;
    else if (fields.break === 'false') pageBreak = false;
    else warnings.push(`Page break "${fields.break}" is not true or false.`);
  }
  let status = 'idea';
  if ('status' in fields) {
    if (STATUSES.includes(fields.status)) status = fields.status;
    else warnings.push(`Status "${fields.status}" is not one of idea, draft, revise, done.`);
  }
  let role = 'body';
  if ('role' in fields) {
    if (ROLES.includes(fields.role)) role = fields.role;
    else warnings.push(`Role "${fields.role}" is not front or body.`);
  }
  return makeHeader({
    id: fields.id ? fields.id : 'section',
    title: fields.title ?? '',
    synopsis: fields.synopsis ?? '',
    status, role, unit, pageBreak,
  });
}

/** Header, body, and warnings of a section file. Reading is forgiving. */
export function parseSection(text) {
  const warnings = [];
  const normalized = normalizeNewlines(text);
  const split = splitHeader(normalized);
  if (!split) {
    warnings.push('Missing header. The file was read as a body.');
    return { header: makeHeader({ id: 'section', title: 'Untitled' }), body: normalized, warnings };
  }
  const fields = headerFields(split.block, warnings);
  return { header: headerFrom(fields, warnings), body: split.body, warnings };
}
