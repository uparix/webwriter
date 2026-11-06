// The twelve markup commands, the smallest-edit diff, and find. Offsets are UTF-16, like the editor's.
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

/** Apply a command. Returns the new text and selection { text, anchor, head }. */
export function applyMarkup(command, text, anchor, head, { language = '', picturePath = '' } = {}) {
  switch (command) {
    case 'emphasis': return wrap(text, anchor, head, '*', '*');
    case 'strong': return wrap(text, anchor, head, '**', '**');
    case 'inlineCode': return wrap(text, anchor, head, '`', '`');
    case 'link': return wrap(text, anchor, head, '[', '](url)');
    case 'picture':
      if (picturePath === '') return { text, anchor, head };
      return picture(text, anchor, head, picturePath);
    case 'subsection': return prefixLine(text, anchor, head, '# ');
    case 'lowerSubsection': return prefixLine(text, anchor, head, '## ');
    case 'bullet': return prefixLine(text, anchor, head, '- ');
    case 'numbered': return prefixLine(text, anchor, head, '1. ');
    case 'quotation': return prefixLine(text, anchor, head, '> ');
    case 'codeBlock': return codeBlock(text, anchor, head, language);
    case 'footnote': return footnote(text, anchor, head);
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
