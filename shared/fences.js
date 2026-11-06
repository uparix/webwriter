// Code fences and inline code spans, by CommonMark's rules.
// Shared by the server (export) and the browser (editor, renderer).

/** A fence opener or closer, using CommonMark's rule that a closer carries no info string. */
export function fenceMark(line) {
  let indent = 0;
  while (indent < 4 && line[indent] === ' ') indent += 1;
  if (indent > 3) return null;
  const char = line[indent];
  if (char !== '`' && char !== '~') return null;
  let run = 0;
  while (line[indent + run] === char) run += 1;
  if (run < 3) return null;
  const info = line.slice(indent + run);
  if (char === '`' && info.includes('`')) return null;
  return { char, length: run, info };
}

export function fenceCloses(open, mark) {
  return mark.char === open.char && mark.length >= open.length && mark.info.trim() === '';
}

/** Advance the fence state one line. `fenced` is true for a fence line or a line inside one. */
export function fenceStep(line, fence) {
  const mark = fenceMark(line);
  if (!mark) return { fence, fenced: fence != null };
  if (!fence) return { fence: { char: mark.char, length: mark.length }, fenced: true };
  return { fence: fenceCloses(fence, mark) ? null : fence, fenced: true };
}

/** Closed inline code spans on one line, as [start, end) offsets. An unmatched backtick is text. */
export function codeSpans(line) {
  const ranges = [];
  let index = 0;
  while (index < line.length) {
    let ticks = 0;
    while (line[index + ticks] === '`') ticks += 1;
    if (ticks === 0) {
      index += 1;
      continue;
    }
    const closer = line.indexOf('`'.repeat(ticks), index + ticks);
    if (closer < 0) break;
    ranges.push([index, closer + ticks]);
    index = closer + ticks;
  }
  return ranges;
}

export function insideSpans(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}
