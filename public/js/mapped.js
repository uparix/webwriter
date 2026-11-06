// Text that remembers where each character came from in a body. A character copied from the body
// carries its body offset (UTF-16); a made-up character, such as a shifted heading mark, carries -1.
import { fenceStep, codeSpans, insideSpans } from '/shared/fences.js';
import { clampHeadingLevel } from '/shared/tree.js';

export class Mapped {
  constructor(text = '', map = []) {
    this.text = text;
    this.map = map;
  }

  static identity(text, base = 0) {
    const map = new Array(text.length);
    for (let i = 0; i < text.length; i += 1) map[i] = base + i;
    return new Mapped(text, map);
  }

  static madeUp(text) {
    return new Mapped(text, new Array(text.length).fill(-1));
  }

  get length() {
    return this.text.length;
  }

  slice(start, end = this.text.length) {
    return new Mapped(this.text.slice(start, end), this.map.slice(start, end));
  }

  append(other) {
    this.text += other.text;
    this.map = this.map.concat(other.map);
    return this;
  }

  appendMadeUp(text) {
    return this.append(Mapped.madeUp(text));
  }

  /** Lines without their newlines, each with the offset of the newline that ended it (-1 for the last). */
  lines() {
    const out = [];
    let start = 0;
    for (;;) {
      const nl = this.text.indexOf('\n', start);
      if (nl < 0) {
        out.push({ line: this.slice(start), nl: -1 });
        return out;
      }
      out.push({ line: this.slice(start, nl), nl: this.map[nl] });
      start = nl + 1;
    }
  }

  static joined(lines) {
    const out = new Mapped();
    lines.forEach(({ line, nl }, index) => {
      out.append(line);
      if (index < lines.length - 1) out.append(new Mapped('\n', [nl]));
    });
    return out;
  }

  trim() {
    let start = 0;
    let end = this.text.length;
    while (start < end && /\s/.test(this.text[start])) start += 1;
    while (end > start && /\s/.test(this.text[end - 1])) end -= 1;
    return this.slice(start, end);
  }
}

/** Body headings shifted down by the node's depth. Fenced code is left alone. */
export function shiftHeadings(body, depth) {
  let fence = null;
  const lines = Mapped.identity(body).lines();
  for (const entry of lines) {
    const stepped = fenceStep(entry.line.text, fence);
    fence = stepped.fence;
    if (stepped.fenced) continue;
    const match = /^(#{1,6})[ \t]/.exec(entry.line.text);
    if (!match) continue;
    const level = clampHeadingLevel(match[1].length + depth).level;
    entry.line = Mapped.madeUp('#'.repeat(level)).append(entry.line.slice(match[1].length));
  }
  return Mapped.joined(lines);
}

export const NOTE_OPEN = '';
export const NOTE_CLOSE = '';

/**
 * Pandoc footnotes, which CommonMark does not know. References become private-use markers the
 * renderer turns into note numbers. Definition lines are blanked rather than removed, so every
 * other line keeps its line number.
 */
export function prepareNotes(source) {
  const definitions = new Map();
  const order = [];
  const state = { inline: 0 };
  let fence = null;
  let open = null;
  const lines = source.lines();
  for (const entry of lines) {
    const text = entry.line.text;
    const stepped = fenceStep(text, fence);
    fence = stepped.fence;
    if (stepped.fenced) {
      open = null;
      continue;
    }
    if (open) {
      if (text.trim() === '') {
        open.blank = true;
        entry.line = new Mapped();
        continue;
      }
      if (text.startsWith('    ') || text.startsWith('\t')) {
        definitions.set(open.label, (definitions.get(open.label) || '') + (open.blank ? '\n\n' : '\n') + text.trim());
        open.blank = false;
        entry.line = new Mapped();
        continue;
      }
      open = null;
    }
    const match = /^\[\^([^\]]+)\]:[ \t]?(.*)$/.exec(text);
    if (match) {
      const label = match[1];
      definitions.set(label, markReferences(Mapped.madeUp(match[2]), order, definitions, state).text);
      open = { label, blank: false };
      entry.line = new Mapped();
      continue;
    }
    entry.line = markReferences(entry.line, order, definitions, state);
  }
  const missing = order.filter((label) => !definitions.has(label));
  return { mapped: Mapped.joined(lines), definitions, order, missing, unclosedFence: fence != null };
}

export function noteNumber(notes, label) {
  if (!notes.definitions.has(label)) return null;
  const index = notes.order.indexOf(label);
  return index < 0 ? null : index + 1;
}

/** `[^label]` and inline `^[text]`, outside code spans, become markers. */
function markReferences(line, order, definitions, state) {
  const text = line.text;
  const spans = codeSpans(text);
  const out = new Mapped();
  let index = 0;
  let copiedFrom = 0;
  const mark = (label, close) => {
    out.append(line.slice(copiedFrom, index));
    out.appendMadeUp(NOTE_OPEN + label + NOTE_CLOSE);
    index = close + 1;
    copiedFrom = index;
  };
  while (index < text.length) {
    if (!insideSpans(index, spans) && index + 1 < text.length) {
      if (text[index] === '^' && text[index + 1] === '[') {
        const close = text.indexOf(']', index + 2);
        if (close >= 0) {
          state.inline += 1;
          const label = `__inline_${state.inline}`;
          definitions.set(label, text.slice(index + 2, close));
          if (!order.includes(label)) order.push(label);
          mark(label, close);
          continue;
        }
      }
      if (text[index] === '[' && text[index + 1] === '^') {
        const close = text.indexOf(']', index + 2);
        if (close > index + 2) {
          const label = text.slice(index + 2, close);
          if (!order.includes(label)) order.push(label);
          mark(label, close);
          continue;
        }
      }
    }
    index += 1;
  }
  out.append(line.slice(copiedFrom));
  return out;
}
