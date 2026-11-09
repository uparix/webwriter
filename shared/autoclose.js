// Closing marks typed for the writer: `*` gives `*|*`, `[` gives `[|]`, and Enter after an opening
// code fence adds the fence that closes it. Pure functions on one line, so they can be tested apart
// from the editor.
import { fenceMark, fenceStep } from './fences.js';

export const PAIRS = { '*': '*', _: '_', '`': '`', '[': ']', '(': ')', '{': '}' };
const SYMMETRIC = new Set(['*', '_', '`']);
const CLOSERS = new Set([']', ')', '}']);
const WORD = /[\p{L}\p{N}]/u;
/** A pair opens only before the end of the line, a space, or punctuation that ends a phrase. */
const OPEN_BEFORE = /^(?:$|[\s)\]}.,;:!?'"])/;

/**
 * What typing `char` at `at` in `line`, with nothing selected, should do:
 * `over` steps over the closing mark already there, `pair` types the mark and its closer,
 * `unpair` types the character and drops the closer of an empty pair, null types it as usual.
 */
export function typed(line, at, char) {
  const before = line[at - 1];
  const after = line[at];
  const rest = line.slice(at);
  // A space in an empty `*|*` makes a list mark, not emphasis.
  if (char === ' ' && (before === '*' || before === '_')) {
    const left = /[*_]+$/.exec(line.slice(0, at))[0];
    if (rest.startsWith(left) && left.split('').every((c) => c === before)) return { action: 'unpair', length: left.length };
    return null;
  }
  if (CLOSERS.has(char)) return after === char ? { action: 'over' } : null;
  if (!(char in PAIRS)) return null;
  if (SYMMETRIC.has(char) && after === char) {
    // `*|*` typed again nests into `**|**`, for strong; otherwise the closer is stepped over.
    if (char !== '`' && before === char) return { action: 'pair' };
    return { action: 'over' };
  }
  if (!OPEN_BEFORE.test(rest)) return null;
  if (char === '*' || char === '_') {
    if (before && WORD.test(before)) return null; // 2*3, snake_case
  }
  // Backticks at the start of a line may be a code fence, which Enter closes.
  if (char === '`' && /^\s*`*$/.test(line.slice(0, at))) return null;
  if (char === '`' && before && WORD.test(before)) return null;
  return { action: 'pair' };
}

/** Whether Backspace at `at` should take out an empty pair, such as `[|]` or `*|*`, whole. */
export function emptyPair(line, at) {
  const before = line[at - 1];
  return before in PAIRS && line[at] === PAIRS[before];
}

/** What typing `char` around a selection of one line puts on each side, or null. */
export function wrapping(char) {
  return char in PAIRS ? { open: char, close: PAIRS[char] } : null;
}

/**
 * The fence that closes the code block opened on line `index`, when Enter is pressed at its end
 * and the text would otherwise end inside a code block; otherwise null.
 */
export function fenceToClose(lines, index) {
  let fence = null;
  for (let i = 0; i < index; i += 1) fence = fenceStep(lines[i], fence).fence;
  if (fence) return null; // Inside a code block, or on its closing line.
  const mark = fenceMark(lines[index]);
  if (!mark) return null;
  // The next fence below closes this one only when it carries no language: ```js opens a block of
  // its own. A bare fence below may still open a block, which then runs to the end of the text.
  const next = lines.slice(index + 1).map(fenceMark).find(Boolean);
  if (next && next.char === mark.char && !next.info.trim()) {
    let open = { char: mark.char, length: mark.length };
    for (let i = index + 1; i < lines.length; i += 1) open = fenceStep(lines[i], open).fence;
    if (!open) return null;
  }
  const indent = /^ */.exec(lines[index])[0];
  return indent + mark.char.repeat(mark.length);
}
