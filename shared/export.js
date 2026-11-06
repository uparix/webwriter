// Manuscript export: one Pandoc Markdown file, written in tree order.
import { fenceStep, codeSpans, insideSpans } from './fences.js';
import {
  clampHeadingLevel, divisions, divisionLabel, isChapter, isFront, isTrash, startsNewPage, find,
} from './tree.js';

export const CHAPTER_NUMBER_CLASS = 'chapter-number';
export const PAGE_BREAK_CLASS = 'page-break';
export const PAGE_BREAK = `<div class="${PAGE_BREAK_CLASS}"></div>`;

export function divisionOpener(division) {
  return `<p class="${CHAPTER_NUMBER_CLASS}">${divisionLabel(division)}</p>`;
}

// MARK: Body transform

/** `[^label]` becomes `[^id-label]`, except inside a code span. */
export function prefixFootnotes(line, sectionID) {
  const spans = codeSpans(line);
  let out = '';
  let index = 0;
  while (index < line.length) {
    if (line[index] === '[' && line[index + 1] === '^' && !insideSpans(index, spans)) {
      const close = line.indexOf(']', index + 2);
      if (close > index + 2) {
        out += `[^${sectionID}-${line.slice(index + 2, close)}]`;
        index = close + 1;
        continue;
      }
    }
    out += line[index];
    index += 1;
  }
  return out;
}

function unnumbered(text) {
  if (/\{\s*-\s*\}/.test(text)) return text;
  if (text === '') return '{-}';
  return `${text} {-}`.replace(/^\s+/, '');
}

function shiftHeading(line, options, warnings) {
  const match = /^(#{1,6})([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  const raw = match[1].length + options.depth;
  const clamped = clampHeadingLevel(raw);
  if (clamped.clamped) warnings.push(`A heading of level ${raw} was written at level ${clamped.level}.`);
  let text = match[3];
  if (options.sectionID != null) text = prefixFootnotes(text, options.sectionID);
  if (options.front) text = unnumbered(text);
  return '#'.repeat(clamped.level) + match[2] + text;
}

/** Shift body headings by the depth and, when asked, prefix footnote labels. Fenced code is copied through. */
export function transformBody(body, options) {
  const warnings = [];
  const out = [];
  let fence = null;
  for (const line of body.split('\n')) {
    const stepped = fenceStep(line, fence);
    fence = stepped.fence;
    if (stepped.fenced) {
      out.push(line);
      continue;
    }
    const heading = shiftHeading(line, options, warnings);
    if (heading != null) out.push(heading);
    else out.push(options.sectionID != null ? prefixFootnotes(line, options.sectionID) : line);
  }
  if (fence) warnings.push('Unclosed code fence.');
  return { text: out.join('\n'), warnings };
}

// MARK: Whole book

function noteKey(node, ancestors) {
  if (isFront(node, ancestors)) return 'front';
  if (isChapter(node)) return `chapter:${node.header.id}`;
  const owner = [...ancestors].reverse().find(isChapter);
  if (owner) return `chapter:${owner.header.id}`;
  return `node:${node.header.id}`;
}

function titleHeading(depth, title, front, warnings, division) {
  const clamped = clampHeadingLevel(depth);
  if (clamped.clamped && depth > 6) {
    warnings.push(`"${title}" is deeper than heading level 6 and was written at level 6.`);
  }
  const heading = `${'#'.repeat(clamped.level)} ${title}${front ? ' {-}' : ''}`;
  if (!division) return heading;
  return `${divisionOpener(division)}\n\n${heading}`;
}

function exportOwn(node, ancestors, warnings, numbered, followed) {
  const front = isFront(node, ancestors);
  const depth = ancestors.length + 1;
  const heading = titleHeading(depth, node.header.title, front, warnings, numbered[node.header.id]);
  const transformed = transformBody(node.body, { depth, sectionID: node.header.id, front });
  warnings.push(...transformed.warnings);
  const body = transformed.text.replace(/\n+$/, '');
  const text = body === '' ? heading : `${heading}\n\n${body}`;
  if (startsNewPage(node) && followed) return `${PAGE_BREAK}\n\n${text}`;
  return text;
}

function walkPieces(nodes, ancestors, warnings, numbered, followed, nested) {
  const pieces = [];
  nodes.forEach((node, index) => {
    if (nested === 'omit' && ancestors.length > 0 && isChapter(node)) return;
    pieces.push({
      key: noteKey(node, ancestors),
      markdown: exportOwn(node, ancestors, warnings, numbered, followed || index > 0),
    });
    pieces.push(...walkPieces(node.children, [...ancestors, node], warnings, numbered, true, nested));
  });
  return pieces;
}

function markdownOf(node, warnings, numbered, nested) {
  return walkPieces([node], [], warnings, numbered, false, nested).map((p) => p.markdown).join('\n\n');
}

/** Manuscript Markdown split where notes are printed: front matter, each chapter, anything else alone. */
export function noteGroups(nodes) {
  const warnings = [];
  const pieces = walkPieces(nodes.filter((n) => !isTrash(n)), [], warnings, divisions(nodes), false, 'enter');
  const groups = [];
  for (const piece of pieces) {
    const last = groups[groups.length - 1];
    if (last && last.key === piece.key) last.parts.push(piece.markdown);
    else groups.push({ key: piece.key, parts: [piece.markdown] });
  }
  return { groups: groups.map((g) => g.parts.join('\n\n')), warnings };
}

export function exportBook(nodes) {
  const exported = noteGroups(nodes);
  return { markdown: exported.groups.join('\n\n'), warnings: exported.warnings };
}

// MARK: One chapter

/** One chapter and the sections inside it, numbered as in the whole book. A nested chapter is left out. */
export function exportChapter(nodes, id) {
  const found = find(nodes.filter((n) => !isTrash(n)), id);
  if (!found || !isChapter(found.node)) return null;
  const warnings = [];
  const numbered = divisions(nodes);
  const markdown = markdownOf(found.node, warnings, numbered, 'omit');
  return { markdown, warnings, title: found.node.header.title, filename: `${fileStem(found.node, numbered)}.pdf` };
}

// MARK: Word files

/** One Word file for each front-matter piece and one for each chapter. Parts are not files. */
export function wordFiles(nodes) {
  const warnings = [];
  const files = [];
  const used = new Set();
  const numbered = divisions(nodes);
  const collect = (list, ancestors) => {
    for (const node of list) {
      if (isTrash(node)) continue;
      const parent = ancestors[ancestors.length - 1];
      const frontRoot = isFront(node, ancestors) && !(parent ? isFront(parent, ancestors.slice(0, -1)) : false);
      if (frontRoot || isChapter(node)) {
        const name = uniqueName(used, `${fileStem(node, numbered)}.docx`);
        files.push({ name, markdown: markdownOf(node, warnings, numbered, 'enter') });
      }
      if (!frontRoot) collect(node.children, [...ancestors, node]);
    }
  };
  collect(nodes, []);
  return { files, warnings };
}

/** `cc-title` for a chapter and `FM-title` for front matter. */
export function fileStem(node, numbered) {
  const division = numbered[node.header.id];
  const code = division && division.kind === 'chapter' ? String(division.number).padStart(2, '0') : 'FM';
  return `${code}-${fileTitle(node.header.title)}`;
}

function uniqueName(used, name) {
  let candidate = name;
  let n = 2;
  while (used.has(candidate)) {
    candidate = name.replaceAll('.docx', `-${n}.docx`);
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

// MARK: Export file names

/** A title made safe for a file name: no path or reserved characters, no trailing dots. */
export function fileTitle(title) {
  let cleaned = [...title].filter((c) => !'\\/:*?"<>|'.includes(c)).join('')
    .replace(/\s+/g, ' ')
    .trim();
  while (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1);
  return cleaned === '' ? 'untitled' : cleaned;
}

/** `name.ext` with the export's date and time before the extension: `name 2026-10-19 17-45.ext`. */
export function timestamped(name, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} ${stamp}`;
  return `${name.slice(0, dot)} ${stamp}${name.slice(dot)}`;
}
