// The fifteen markup commands, the smallest-edit diff, and find. Offsets are UTF-16, like the editor's.
import { fenceMark, fenceCloses } from './fences.js';

export const COMMANDS = [
  { id: 'emphasis', name: 'Emphasis', shortcut: '⌘I', inserts: '*…* around the selection' },
  { id: 'strong', name: 'Strong', shortcut: '⌘B', inserts: '**…** around the selection' },
  { id: 'inlineCode', name: 'Inline code', shortcut: '⌘E', inserts: '`…` around the selection' },
  { id: 'link', name: 'Link', inserts: '[selection](url)' },
  { id: 'picture', name: 'Picture', inserts: '![selection](images/file){width=100%}, and moves that file into the book' },
  { id: 'subsection', name: 'Subsection', inserts: '# at the start of the current line' },
  { id: 'lowerSubsection', name: 'Lower subsection', inserts: '## at the start of the current line' },
  { id: 'bullet', name: 'Bullet list', inserts: '- at the start of the current line' },
  { id: 'numbered', name: 'Numbered list', inserts: '1. at the start of the current line' },
  { id: 'quotation', name: 'Quotation', inserts: '> at the start of the current line' },
  { id: 'codeBlock', name: 'Code block', inserts: 'A fenced block around the selection, with a blank line before and after' },
  { id: 'footnote', name: 'Footnote', inserts: '[^n] at the cursor, and a matching definition at the end of the section' },
  { id: 'left', name: 'Align Left', inserts: '::: left and ::: around the paragraph, picture, or diagram at the cursor' },
  { id: 'center', name: 'Center', inserts: '::: center and ::: around the paragraph, picture, or diagram at the cursor' },
  { id: 'right', name: 'Align Right', inserts: '::: right and ::: around the paragraph, picture, or diagram at the cursor' },
];

/** The palette finds a command by its name, so "foot" reaches Footnote and "pic" reaches Picture. */
export function matchingCommands(query, commands = COMMANDS) {
  const needle = query.trim().toLowerCase();
  if (needle === '') return commands;
  const words = commands.filter((c) => c.name.toLowerCase().split(' ').some((w) => w.startsWith(needle)));
  const anywhere = commands.filter((c) => c.name.toLowerCase().includes(needle) && !words.includes(c));
  return [...words, ...anywhere];
}

const clamp = (text, index) => Math.max(0, Math.min(index, text.length));

function span(text, anchor, head) {
  const a = clamp(text, anchor);
  const h = clamp(text, head);
  return { start: Math.min(a, h), end: Math.max(a, h), head: h };
}

const splice = (text, start, end, insert) => text.slice(0, start) + insert + text.slice(end);

function wrap(text, anchor, head, open, close) {
  const { start, end } = span(text, anchor, head);
  const selected = text.slice(start, end);
  const next = splice(text, start, end, open + selected + close);
  const cursor = selected === '' ? start + open.length : start + open.length + selected.length + close.length;
  return { text: next, anchor: cursor, head: cursor };
}

/** How many `char`s run back from `index`, or forward from it. */
function runBack(text, index, char) {
  let n = 0;
  while (index - n > 0 && text[index - n - 1] === char) n += 1;
  return n;
}

function runForward(text, index, char) {
  let n = 0;
  while (index + n < text.length && text[index + n] === char) n += 1;
  return n;
}

/**
 * How many marks of one run of `char` to take off for a style, or 0 when the run does not hold it.
 * `*` and `***` hold emphasis, `**` and `***` strong; a run of backticks holds inline code.
 */
function marksToRemove(run, kind) {
  if (kind === 'emphasis') return run % 2 === 1 ? 1 : 0;
  if (kind === 'strong') return run >= 2 ? 2 : 0;
  return run;
}

/**
 * Emphasis, Strong, and Inline code switch on and off. When the selection, or an empty pair of marks
 * at the cursor, already has the style, just outside it or as the selection's own ends, the marks are
 * taken off. Otherwise the selection is wrapped and stays selected, so a second click takes it off.
 */
function toggleWrap(text, anchor, head, kind) {
  const char = kind === 'inlineCode' ? '`' : '*';
  const { start, end } = span(text, anchor, head);
  const outside = Math.min(runBack(text, start, char), runForward(text, end, char));
  const out = marksToRemove(outside, kind);
  if (out) {
    const next = text.slice(0, start - out) + text.slice(start, end) + text.slice(end + out);
    return { text: next, anchor: start - out, head: end - out };
  }
  if (end > start) {
    const selected = text.slice(start, end);
    const inside = Math.min(runForward(selected, 0, char), runBack(selected, selected.length, char));
    const cut = marksToRemove(inside, kind);
    if (cut && selected.length > 2 * cut) {
      const next = text.slice(0, start) + selected.slice(cut, selected.length - cut) + text.slice(end);
      return { text: next, anchor: start, head: end - 2 * cut };
    }
  }
  const mark = { emphasis: '*', strong: '**', inlineCode: '`' }[kind];
  if (end === start) return wrap(text, anchor, head, mark, mark);
  const next = splice(text, start, end, mark + text.slice(start, end) + mark);
  return { text: next, anchor: start + mark.length, head: end + mark.length };
}

function lineStart(text, index) {
  const at = clamp(text, index);
  if (at === 0) return 0;
  return text.lastIndexOf('\n', at - 1) + 1;
}

function prefixLine(text, anchor, head, prefix) {
  const cursor = span(text, anchor, head).head;
  const start = lineStart(text, cursor);
  const next = splice(text, start, start, prefix);
  // The anchor moves with the prefix only when it sits at or after the line start.
  const movedAnchor = anchor >= start ? anchor + prefix.length : anchor;
  return { text: next, anchor: Math.max(0, Math.min(movedAnchor, next.length)), head: cursor + prefix.length };
}

/** Swap `length` characters at `at` for `insert`, moving offsets past them along and those inside to `at`. */
function replaceAt(text, anchor, head, at, length, insert) {
  const move = (o) => (o <= at ? o : o < at + length ? at + insert.length : o - length + insert.length);
  return { text: splice(text, at, at + length, insert), anchor: move(anchor), head: move(head) };
}

// The mark a line starts with, for each kind of line command.
const LINE_MARKS = {
  heading: /^ {0,3}(#{1,6})(?:[ \t]+|$)/,
  list: /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/,
  quotation: /^ {0,3}> ?/,
};

/**
 * Subsection, Lower subsection, Bullet list, Numbered list, and Quotation switch on and off. On a line
 * that already has the command's own mark, the mark is taken off. A subsection of the other level, or a
 * list of the other kind, is changed to this one. Any other line gets the mark at its start.
 */
function toggleLine(text, anchor, head, command) {
  const cursor = span(text, anchor, head).head;
  const start = lineStart(text, cursor);
  const lineEnd = text.indexOf('\n', start);
  const line = text.slice(start, lineEnd < 0 ? text.length : lineEnd);
  if (command === 'subsection' || command === 'lowerSubsection') {
    const own = command === 'subsection' ? '# ' : '## ';
    const match = LINE_MARKS.heading.exec(line);
    if (!match) return prefixLine(text, anchor, head, own);
    const same = match[1].length === own.length - 1;
    return replaceAt(text, anchor, head, start, match[0].length, same ? '' : own);
  }
  if (command === 'bullet' || command === 'numbered') {
    const own = command === 'bullet' ? '- ' : '1. ';
    const match = LINE_MARKS.list.exec(line);
    if (!match) return prefixLine(text, anchor, head, own);
    const numbered = /\d/.test(match[2]);
    const same = numbered === (command === 'numbered');
    // Indentation stays, so a nested item stays nested.
    const at = start + match[1].length;
    return replaceAt(text, anchor, head, at, match[0].length - match[1].length, same ? '' : own);
  }
  const match = LINE_MARKS.quotation.exec(line);
  if (match) return replaceAt(text, anchor, head, start, match[0].length, '');
  return prefixLine(text, anchor, head, '> ');
}

function codeBlock(text, anchor, head, language) {
  const { start, end } = span(text, anchor, head);
  const selected = text.slice(start, end);
  let working = text;
  let at = start;
  const before = text.slice(0, start);
  if (start === 0) {
    working = '\n' + working;
    at = 1;
  } else if (before.endsWith('\n\n')) {
    // Already a blank line before.
  } else if (before.endsWith('\n')) {
    working = before + '\n' + text.slice(start);
    at = start + 1;
  } else {
    working = before + '\n\n' + text.slice(start);
    at = start + 2;
  }
  const selectedEnd = end + (at - start);
  const interior = selected === '' ? '\n' : (selected.endsWith('\n') ? selected : selected + '\n');
  const fence = '```' + language + '\n' + interior + '```\n\n';
  const next = splice(working, at, selectedEnd, fence);
  if (language === '') return { text: next, anchor: at + 3, head: at + 3 };
  const inside = at + 3 + language.length + 1 + selected.length;
  return { text: next, anchor: inside, head: inside };
}

/** The next number not used by a `[^n]:` definition in the section. */
export function nextFootnoteNumber(text) {
  const used = new Set();
  for (const line of text.split('\n')) {
    const match = /^\[\^(\d+)\]:/.exec(line);
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

function footnote(text, anchor, head) {
  const cursor = span(text, anchor, head).head;
  const n = nextFootnoteNumber(text);
  let next = splice(text, cursor, cursor, `[^${n}]`);
  if (!next.endsWith('\n')) next += '\n';
  if (!next.endsWith('\n\n')) next += '\n';
  next += `[^${n}]: `;
  return { text: next, anchor: next.length, head: next.length };
}

function destination(relative) {
  const clean = relative.replace(/[\r\n]/g, '');
  if (clean === '' || /[\s()]/.test(clean)) return `<${clean.replace(/[<>]/g, '')}>`;
  return clean;
}

function picture(text, anchor, head, relative) {
  const { start, end } = span(text, anchor, head);
  const caption = text.slice(start, end)
    .replaceAll('\r\n', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('\\', '\\\\')
    .replaceAll(']', '\\]');
  const mark = `![${caption}](${destination(relative)}){width=100%}`;
  const next = splice(text, start, end, mark);
  const cursor = caption === '' ? start + 2 : start + mark.length;
  return { text: next, anchor: cursor, head: cursor };
}

/** The fenced code blocks of `lines` as [first, last] line numbers. An unclosed fence runs to the end. */
function fencedRanges(lines) {
  const ranges = [];
  let open = null;
  lines.forEach((line, n) => {
    const mark = fenceMark(line);
    if (!mark) return;
    if (open) {
      if (fenceCloses(open, mark)) {
        ranges.push([open.first, n]);
        open = null;
      }
      return;
    }
    open = { char: mark.char, length: mark.length, first: n };
  });
  if (open) ranges.push([open.first, lines.length - 1]);
  return ranges;
}

/** What goes after a closing `:::` so a blank line follows it, or a line end at the end of the text. */
function trailing(after) {
  if (after.startsWith('\n\n')) return '';
  return after === '' || after.startsWith('\n') ? '\n' : '\n\n';
}

// A Pandoc fenced div: `::: center` or `::: {.center}` opens one, a line of colons alone closes it.
const DIV_OPEN = /^ {0,3}:{3,}[ \t]*(\{[^}]*\}|[^\s{}:]+)[ \t]*:*[ \t]*$/;
const DIV_CLOSE = /^ {0,3}:{3,}[ \t]*$/;
const SIDES = ['left', 'center', 'right'];

/** The side a div's attributes name, `center` or `{.center #id}`, or null. */
function sideOf(attributes) {
  const classes = attributes.startsWith('{')
    ? attributes.slice(1, -1).split(/\s+/).filter((a) => a.startsWith('.')).map((a) => a.slice(1))
    : [attributes];
  return classes.find((c) => SIDES.includes(c)) || null;
}

/** The closed divs that set a side, as { open, close, side } line numbers. Colons in code close nothing. */
function alignedDivs(lines) {
  const found = [];
  const stack = [];
  let code = null;
  lines.forEach((line, n) => {
    const mark = fenceMark(line);
    if (code) {
      if (mark && fenceCloses(code, mark)) code = null;
      return;
    }
    if (mark) {
      code = { char: mark.char, length: mark.length };
      return;
    }
    const open = DIV_OPEN.exec(line);
    if (open) stack.push({ open: n, side: sideOf(open[1]) });
    else if (DIV_CLOSE.test(line) && stack.length) {
      const div = stack.pop();
      if (div.side) found.push({ ...div, close: n });
    }
  });
  return found;
}

/**
 * The aligned div a command acts on instead of wrapping: without a selection, the innermost one
 * around the cursor, its fence lines included; with one, a div whose content the selection covers
 * and whose fences hold it.
 */
function alignedDivAt(lines, first, last, selection) {
  const divs = alignedDivs(lines).filter((d) => (selection
    ? d.open <= first && last <= d.close && first <= d.open + 1 && d.close - 1 <= last
    : d.open <= first && first <= d.close));
  return divs.sort((a, b) => b.open - a.open)[0] || null;
}

/** Take a div's fence lines away, keeping what was inside. An empty div goes with its blank lines. */
function unwrapDiv(text, anchor, head, lines, starts, div) {
  const content = lines.slice(div.open + 1, div.close);
  const empty = content.every((l) => /^[ \t]*$/.test(l));
  const from = starts[div.open];
  const closeEnd = starts[div.close] + lines[div.close].length;
  let to = Math.min(closeEnd + 1, text.length);
  // When the div stood alone between blank lines, one of them goes too, so one blank line is left.
  const before = text.slice(0, from);
  if (empty && (before === '' || before.endsWith('\n\n')) && text.slice(to).startsWith('\n')) to += 1;
  const inner = empty ? '' : content.join('\n') + (closeEnd + 1 <= text.length && to > closeEnd ? '\n' : '');
  const innerStart = from;
  const innerEnd = from + Math.max(0, inner.length - (inner.endsWith('\n') ? 1 : 0));
  const openEnd = starts[div.open + 1] ?? text.length;
  const move = (o) => {
    if (o < from) return o;
    if (o < openEnd) return innerStart;
    if (o < starts[div.close]) return o - (openEnd - from);
    if (o <= to) return innerEnd;
    return o - (to - from) + inner.length;
  };
  if (from > 0 && to >= text.length && empty) {
    // An empty div at the end: drop the line end before it too, unless that leaves no blank line.
    const next = text.slice(0, from).replace(/\n$/, '');
    return { text: next + (next.endsWith('\n') ? '' : '\n'), anchor: Math.min(move(anchor), next.length), head: Math.min(move(head), next.length) };
  }
  return { text: text.slice(0, from) + inner + text.slice(to), anchor: move(anchor), head: move(head) };
}

/** Name another side on a div's opening line, keeping its colons and other attributes. */
function changeSide(text, anchor, head, lines, starts, div, side) {
  const line = lines[div.open];
  const attributes = DIV_OPEN.exec(line)[1];
  const changed = attributes.startsWith('{')
    ? attributes.replace(new RegExp(`\\.${div.side}(?![\\w-])`), `.${side}`)
    : side;
  const at = starts[div.open] + line.indexOf(attributes);
  return replaceAt(text, anchor, head, at, attributes.length, changed);
}

/**
 * Wraps whole lines in a Pandoc fenced div, such as `::: center` … `:::`, set off by blank lines. With a
 * selection, the lines it touches. Without one, the block at the cursor: the paragraph, or the whole
 * fenced block, such as a Mermaid diagram. On a blank line, an empty div with the cursor inside.
 * In a div already set to this side, the div is taken away; in one set to another side, it is changed.
 */
function align(text, anchor, head, side) {
  const opening = `::: ${side}\n`;
  const { start, end } = span(text, anchor, head);
  const lines = text.split('\n');
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (index) => {
    let n = 0;
    while (n + 1 < starts.length && starts[n + 1] <= index) n += 1;
    return n;
  };
  const blank = (n) => /^[ \t]*$/.test(lines[n]);
  let first = lineAt(start);
  // A selection that ends at the start of a line leaves that line out.
  let last = end > start && end === starts[lineAt(end)] ? lineAt(end) - 1 : lineAt(end);
  if (last < first) last = first;
  const div = alignedDivAt(lines, first, last, end > start);
  if (div) {
    if (div.side === side) return unwrapDiv(text, anchor, head, lines, starts, div);
    return changeSide(text, anchor, head, lines, starts, div, side);
  }
  const fences = fencedRanges(lines);
  const fenceOf = (n) => fences.find(([a, b]) => a <= n && n <= b);
  const fenceFirst = fenceOf(first);
  const fenceLast = fenceOf(last);
  if (fenceFirst) first = fenceFirst[0];
  if (fenceLast) last = fenceLast[1];
  if (start === end && !fenceFirst) {
    if (blank(first)) {
      const before = text.slice(0, starts[first]);
      const after = text.slice(starts[first] + lines[first].length);
      const lead = before === '' || before.endsWith('\n\n') ? '' : '\n';
      const next = before + lead + opening + '\n:::' + trailing(after) + after;
      const cursor = before.length + lead.length + opening.length;
      return { text: next, anchor: cursor, head: cursor };
    }
    while (first > 0 && !blank(first - 1) && !fenceOf(first - 1)) first -= 1;
    while (last + 1 < lines.length && !blank(last + 1) && !fenceOf(last + 1)) last += 1;
  }
  const from = starts[first];
  const to = starts[last] + lines[last].length;
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : '\n';
  const block = `${opening}${text.slice(from, to)}\n:::`;
  const next = before + lead + block + trailing(after) + after;
  const cursor = before.length + lead.length + block.length;
  return { text: next, anchor: cursor, head: cursor };
}

/** Apply a command. Returns the new text and selection { text, anchor, head }. */
export function applyMarkup(command, text, anchor, head, { language = '', picturePath = '' } = {}) {
  switch (command) {
    case 'emphasis':
    case 'strong':
    case 'inlineCode': return toggleWrap(text, anchor, head, command);
    case 'link': return wrap(text, anchor, head, '[', '](url)');
    case 'picture':
      if (picturePath === '') return { text, anchor, head };
      return picture(text, anchor, head, picturePath);
    case 'subsection':
    case 'lowerSubsection':
    case 'bullet':
    case 'numbered':
    case 'quotation': return toggleLine(text, anchor, head, command);
    case 'codeBlock': return codeBlock(text, anchor, head, language);
    case 'footnote': return footnote(text, anchor, head);
    case 'left':
    case 'center':
    case 'right': return align(text, anchor, head, command);
    default: return { text, anchor, head };
  }
}

/** Language tag of the last fenced block in tree order. An empty tag wins when it is last. */
export function latestLanguage(bodies) {
  let language = '';
  for (const body of bodies) {
    let fence = null;
    for (const line of body.split('\n')) {
      const mark = fenceMark(line);
      if (!mark) continue;
      if (fence) {
        if (fenceCloses(fence, mark)) fence = null;
        continue;
      }
      fence = { char: mark.char, length: mark.length };
      language = mark.info.split(/\s+/).filter(Boolean)[0] || '';
    }
  }
  return language;
}

/** The shortest single edit that turns `before` into `after`: { start, length, insert }. */
export function changedSpan(before, after) {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix
    && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix += 1;
  return {
    start: prefix,
    length: before.length - suffix - prefix,
    insert: after.slice(prefix, after.length - suffix),
  };
}

// MARK: Find

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

/** Find through one text or, in tree order, through the whole book. The search wraps around. */
export class Finder {
  /** Null when the query is empty or the regular expression is invalid. */
  static make(query, options) {
    if (!query) return null;
    let pattern = options.regex ? query : escapeRegExp(query);
    if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;
    try {
      return new Finder(new RegExp(pattern, options.matchCase ? 'gmu' : 'gimu'));
    } catch {
      try {
        return new Finder(new RegExp(pattern, options.matchCase ? 'gm' : 'gim'));
      } catch {
        return null;
      }
    }
  }

  constructor(expression) {
    this.expression = expression;
  }

  /** Non-empty matches in [from, to) as { start, length }. */
  matches(text, from = 0, to = text.length) {
    const start = Math.max(0, Math.min(from, text.length));
    const end = Math.max(start, Math.min(to, text.length));
    if (start >= end) return [];
    const re = new RegExp(this.expression.source, this.expression.flags);
    const region = text.slice(0, end);
    re.lastIndex = start;
    const out = [];
    let m;
    while ((m = re.exec(region)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push({ start: m.index, length: m[0].length });
    }
    return out;
  }

  first(part, from = 0, to) {
    const m = this.matches(part.text, from, to)[0];
    return m ? { id: part.id, ...m } : null;
  }

  last(part, from = 0, to) {
    const all = this.matches(part.text, from, to);
    const m = all[all.length - 1];
    return m ? { id: part.id, ...m } : null;
  }

  /** The next match after `from` in the current text, then later texts, then around the book. */
  next(parts, currentID, from) {
    if (parts.length === 0) return null;
    let index = parts.findIndex((p) => p.id === currentID);
    const offset = index >= 0 ? from : 0;
    if (index < 0) index = 0;
    const current = parts[index];
    const hit = this.first(current, offset);
    if (hit) return hit;
    for (const part of parts.slice(index + 1)) {
      const h = this.first(part);
      if (h) return h;
    }
    for (const part of parts.slice(0, index)) {
      const h = this.first(part);
      if (h) return h;
    }
    return this.first(current, 0, offset);
  }

  /** The previous match before `from`, walking backward and wrapping to the end. */
  previous(parts, currentID, from) {
    if (parts.length === 0) return null;
    const found = parts.findIndex((p) => p.id === currentID);
    const index = found >= 0 ? found : parts.length - 1;
    const current = parts[index];
    const offset = found < 0 ? current.text.length : from;
    const behind = this.matches(current.text, 0, offset).filter((m) => m.start < offset);
    if (behind.length) return { id: current.id, ...behind[behind.length - 1] };
    for (const part of parts.slice(0, index).reverse()) {
      const h = this.last(part);
      if (h) return h;
    }
    for (const part of parts.slice(index + 1).reverse()) {
      const h = this.last(part);
      if (h) return h;
    }
    return this.last(current, offset);
  }

  /** Replace every match. With a regular expression the replacement may use `$1`; otherwise it is literal. */
  replaceAll(text, replacement, regex) {
    let count = 0;
    const re = new RegExp(this.expression.source, this.expression.flags);
    const out = text.replace(re, (...args) => {
      const match = args[0];
      if (match.length === 0) return match;
      count += 1;
      if (!regex) return replacement;
      return expandTemplate(replacement, args);
    });
    return { text: out, count };
  }
}

/** `$1`, `$&`, and `$$` in a replacement, filled from one match's arguments to `String.replace`. */
export function expandTemplate(template, args) {
  const hasGroups = typeof args[args.length - 1] === 'object';
  const groups = args.slice(1, hasGroups ? -3 : -2);
  return template.replace(/\$(\$|&|\d{1,2})/g, (whole, key) => {
    if (key === '$') return '$';
    if (key === '&') return args[0];
    const n = Number(key);
    if (n >= 1 && n <= groups.length) return groups[n - 1] ?? '';
    return whole;
  });
}
