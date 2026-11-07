// Mermaid diagrams: a `mermaid` code fence whose text the browser draws as a diagram. The fence stays
// in the text as written, so exported Markdown keeps it. Shared by the server (Word export) and the
// browser (renderer).
import { fenceMark, fenceCloses } from './fences.js';

export const MERMAID_INFO = 'mermaid';
/** What Insert Mermaid Diagram puts in an empty fence, to start from. */
export const MERMAID_SAMPLE = 'flowchart LR\n  A[Start] --> B[End]';

export const isMermaidInfo = (info) => info.trim().split(/\s+/)[0] === MERMAID_INFO;

/** A fenced line without the fence's own indent, by CommonMark's rule. */
export function dropFenceIndent(line, indent) {
  let n = 0;
  while (n < indent && line[n] === ' ') n += 1;
  return line.slice(n);
}

/**
 * The mermaid fences in `markdown`: [{ start, end, source }], where lines `start` to `end` (exclusive)
 * are the fence and `source` is the text inside it. An unclosed fence runs to the end, as in the
 * renderer.
 */
export function mermaidBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const mark = fenceMark(lines[i]);
    if (!mark) {
      i += 1;
      continue;
    }
    const indent = lines[i].length - lines[i].trimStart().length;
    let k = i + 1;
    while (k < lines.length) {
      const close = fenceMark(lines[k]);
      if (close && fenceCloses(mark, close)) break;
      k += 1;
    }
    const end = Math.min(k + 1, lines.length);
    if (isMermaidInfo(mark.info)) {
      blocks.push({ start: i, end, source: lines.slice(i + 1, k).map((l) => dropFenceIndent(l, indent)).join('\n') });
    }
    i = end;
  }
  return blocks;
}

/** The source of every mermaid fence in `markdown`, each once. */
export const mermaidSources = (markdown) => [...new Set(mermaidBlocks(markdown).map((b) => b.source))];

/** `markdown` with each mermaid fence replaced by `replace(source)`, or kept when that gives null. */
export function replaceMermaid(markdown, replace) {
  const lines = markdown.split('\n');
  const out = [];
  let at = 0;
  for (const block of mermaidBlocks(markdown)) {
    out.push(...lines.slice(at, block.start));
    const replacement = replace(block.source);
    out.push(...(replacement == null ? lines.slice(block.start, block.end) : [replacement]));
    at = block.end;
  }
  out.push(...lines.slice(at));
  return out.join('\n');
}
