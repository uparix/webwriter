// Markdown (CommonMark, GitHub tables and strikethrough, Pandoc footnotes and attributes) as HTML.
// Every character copied from a body is wrapped in a span that carries its body offset, so comments
// can be highlighted on it and typing in the rendered text can land in the body.
import { fenceMark, fenceCloses } from '/shared/fences.js';
import { clampHeadingLevel, isFront, isGroup, startsNewPage, divisionLabel } from '/shared/tree.js';
import { Mapped, shiftHeadings, prepareNotes, noteNumber, NOTE_OPEN, NOTE_CLOSE } from './mapped.js';
import { highlightCode } from './code.js';
import { tagAttributes, tagColor } from '/shared/tags.js';
import { INDEX_INFO, indexEntries } from '/shared/bookindex.js';
import { MERMAID_INFO, mermaidWidth } from '/shared/mermaid.js';
import { mermaidHTML } from './mermaid.js';

/** The book's tag colors from tags.json, by tag name. */
let tagDefinitions = {};

export function setTagDefinitions(definitions) {
  tagDefinitions = definitions || {};
}

export const getTagDefinitions = () => tagDefinitions;

/** The book's tree, for the pieces an index lists. */
let bookNodes = [];

export function setBookNodes(nodes) {
  bookNodes = nodes || [];
}

/** Bumped when a picture changes on disk, so the browser loads it again instead of its cached copy. */
let pictureVersion = 0;

export function setPictureVersion(version) {
  pictureVersion = version;
}

/** Makes a mermaid fence's HTML. The page draws it with Mermaid; a built web page leaves that to its reader's browser. */
let mermaidFence = mermaidHTML;

export function setMermaidFence(make) {
  mermaidFence = make || mermaidHTML;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Mapped text as HTML: runs copied from the body in offset-carrying spans, made-up text as is. */
export function emit(m) {
  let html = '';
  let i = 0;
  while (i < m.text.length) {
    const offset = m.map[i];
    let j = i + 1;
    if (offset < 0) {
      while (j < m.text.length && m.map[j] < 0) j += 1;
      html += esc(m.text.slice(i, j));
    } else {
      while (j < m.text.length && m.map[j] === offset + (j - i)) j += 1;
      html += `<span data-o="${offset}">${esc(m.text.slice(i, j))}</span>`;
    }
    i = j;
  }
  return html;
}

// MARK: Pictures

/** A book-relative picture path, or null for a URL or a path that leaves the book. */
export function bookPath(source) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source)) return null;
  let decoded = source;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    decoded = source;
  }
  const parts = [];
  for (const part of decoded.replace(/^\/+/, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push(part);
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0 || parts.includes('..')) return null;
  return parts.join('/');
}

/** `width=50%` as 50. Only percentages scale with the page. */
export function widthPercent(attributes) {
  const match = /(?:^|\s)width=([\d.]+)%/.exec(attributes || '');
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 100) : null;
}

function picture(source, attributes) {
  const relative = bookPath(source);
  if (!relative) return `<span class="warning">[picture: ${esc(source)}]</span>`;
  const width = widthPercent(attributes);
  const url = `/book-file/${relative.split('/').map(encodeURIComponent).join('/')}${pictureVersion ? `?v=${pictureVersion}` : ''}`;
  return `<img class="picture" src="${url}" data-path="${esc(source)}" alt=""${width ? ` style="width:${width}%"` : ''}>`;
}

// MARK: Inlines

const PUNCT = /[!-/:-@[-`{-~]/;
const isPunct = (c) => c != null && (PUNCT.test(c) || /[\p{P}\p{S}]/u.test(c));
const isSpace = (c) => c == null || /\s/.test(c);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', shy: '­', times: '×',
};

function decodeEntity(text) {
  const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/.exec(text);
  if (!m) return null;
  let value = null;
  if (m[1]) value = String.fromCodePoint(Math.min(Number(m[1]), 0x10FFFF) || 0xFFFD);
  else if (m[2]) value = String.fromCodePoint(Math.min(parseInt(m[2], 16), 0x10FFFF) || 0xFFFD);
  else if (ENTITIES[m[3]]) value = ENTITIES[m[3]];
  return value == null ? null : { value, length: m[0].length };
}

/** The end of a `[...]` label starting at `open`, skipping code spans and escapes. -1 when unclosed. */
function labelEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') {
      let run = 0;
      while (text[i + run] === '`') run += 1;
      const close = findTickRun(text, i + run, run);
      if (close >= 0) {
        i = close + run - 1;
        continue;
      }
      i += run - 1;
      continue;
    }
    if (c === '[') depth += 1;
    if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** A run of exactly `run` backticks at or after `from`. */
function findTickRun(text, from, run) {
  let i = from;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n += 1;
    if (n === run) return i;
    i += n;
  }
  return -1;
}

/** `(destination "title"){attributes}` after a link label. */
function linkTail(text, at) {
  if (text[at] !== '(') return null;
  let i = at + 1;
  while (text[i] === ' ' || text[i] === '\n') i += 1;
  let destination = '';
  if (text[i] === '<') {
    const close = text.indexOf('>', i + 1);
    if (close < 0) return null;
    destination = text.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    const start = i;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === '(') depth += 1;
      if (c === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      i += 1;
    }
    destination = text.slice(start, i).replace(/\\(.)/g, '$1');
  }
  while (text[i] === ' ' || text[i] === '\n') i += 1;
  if (text[i] === '"' || text[i] === "'" || text[i] === '(') {
    const closer = text[i] === '(' ? ')' : text[i];
    const close = text.indexOf(closer, i + 1);
    if (close < 0) return null;
    i = close + 1;
    while (text[i] === ' ' || text[i] === '\n') i += 1;
  }
  if (text[i] !== ')') return null;
  i += 1;
  let attributes = '';
  if (text[i] === '{') {
    const close = text.indexOf('}', i);
    if (close >= 0) {
      attributes = text.slice(i + 1, close);
      i = close + 1;
    }
  }
  return { destination, attributes, end: i };
}

class Inline {
  constructor(ctx) {
    this.ctx = ctx;
  }

  render(m) {
    const pieces = this.scan(m);
    this.emphasis(pieces);
    return this.flatten(pieces);
  }

  flatten(pieces) {
    return pieces.map((p) => (p.type === 'html' ? p.html : emit(p.m))).join('');
  }

  scan(m) {
    const text = m.text;
    const pieces = [];
    let textStart = 0;
    const flush = (end) => {
      if (end > textStart) pieces.push({ type: 'text', m: m.slice(textStart, end) });
    };
    const html = (end, value) => {
      pieces.push({ type: 'html', html: value });
      textStart = end;
    };
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === NOTE_OPEN) {
        const close = text.indexOf(NOTE_CLOSE, i);
        if (close > i) {
          flush(i);
          html(close + 1, this.noteRef(text.slice(i + 1, close)));
          i = close + 1;
          continue;
        }
      }
      if (c === '\\' && i + 1 < text.length) {
        if (text[i + 1] === '\n') {
          flush(i);
          html(i + 2, '<br>');
          i += 2;
          continue;
        }
        if (/[!-/:-@[-`{-~]/.test(text[i + 1])) {
          flush(i);
          pieces.push({ type: 'text', m: m.slice(i + 1, i + 2) });
          textStart = i + 2;
          i += 2;
          continue;
        }
      }
      if (c === '\n') {
        // Two spaces before a newline make a hard break.
        let spaces = 0;
        while (text[i - 1 - spaces] === ' ') spaces += 1;
        if (spaces >= 2) {
          flush(i - spaces);
          html(i + 1, '<br>');
          pieces.push({ type: 'text', m: m.slice(i, i + 1) });
          i += 1;
          continue;
        }
      }
      if (c === '`') {
        let run = 0;
        while (text[i + run] === '`') run += 1;
        const close = findTickRun(text, i + run, run);
        if (close < 0) {
          i += run;
          continue;
        }
        flush(i);
        let content = m.slice(i + run, close);
        const t = content.text.replace(/\n/g, ' ');
        if (t.length >= 2 && t[0] === ' ' && t[t.length - 1] === ' ' && t.trim() !== '') content = content.slice(1, content.length - 1);
        html(close + run, `<code>${emit(content)}</code>`);
        i = close + run;
        continue;
      }
      if (c === '&') {
        const entity = decodeEntity(text.slice(i));
        if (entity) {
          flush(i);
          html(i + entity.length, esc(entity.value));
          i += entity.length;
          continue;
        }
      }
      if (c === '<') {
        const auto = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(text.slice(i))
          || /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/.exec(text.slice(i));
        if (auto) {
          flush(i);
          const href = auto[1].includes(':') ? auto[1] : `mailto:${auto[1]}`;
          html(i + auto[0].length, `<a href="${esc(href)}" class="external">${emit(m.slice(i + 1, i + auto[0].length - 1))}</a>`);
          i += auto[0].length;
          continue;
        }
        const tag = /^(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<!--[\s\S]*?-->)/.exec(text.slice(i));
        if (tag) {
          flush(i);
          html(i + tag[0].length, `<span class="raw-html">${emit(m.slice(i, i + tag[0].length))}</span>`);
          i += tag[0].length;
          continue;
        }
      }
      if (c === '[' || (c === '!' && text[i + 1] === '[')) {
        const open = c === '!' ? i + 1 : i;
        const close = labelEnd(text, open);
        const tail = close >= 0 ? linkTail(text, close + 1) : null;
        if (tail) {
          flush(i);
          const label = m.slice(open + 1, close);
          if (c === '!') {
            html(tail.end, picture(tail.destination, tail.attributes));
          } else {
            const inner = new Inline(this.ctx).render(label);
            html(tail.end, `<a href="${esc(tail.destination)}" class="external">${inner}</a>`);
          }
          i = tail.end;
          continue;
        }
        // A Pandoc span, `[text]{.class key=value}`: with the class `tag`, a colored tag.
        if (c === '[' && close > open + 1 && text[close + 1] === '{') {
          const end = text.indexOf('}', close + 2);
          if (end > 0 && !text.slice(close + 2, end).includes('\n')) {
            flush(i);
            const attributes = tagAttributes(text.slice(close + 2, end));
            const inner = new Inline(this.ctx).render(m.slice(open + 1, close));
            if (attributes.isTag) {
              const name = text.slice(open + 1, close);
              const color = tagColor(name, tagDefinitions, attributes.color);
              html(end + 1, `<span class="tag" data-tag="${esc(name)}" style="--tag:${color}">${inner}</span>`);
            } else {
              html(end + 1, `<span class="pandoc-span">${inner}</span>`);
            }
            i = end + 1;
            continue;
          }
        }
      }
      if (c === '*' || c === '_' || c === '~') {
        let run = 0;
        while (text[i + run] === c) run += 1;
        const before = text[i - 1];
        const after = text[i + run];
        const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
        const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
        let canOpen = left;
        let canClose = right;
        if (c === '_') {
          canOpen = left && (!right || isPunct(before));
          canClose = right && (!left || isPunct(after));
        }
        if (c === '~' && run > 2) {
          i += run;
          continue;
        }
        flush(i);
        pieces.push({ type: 'delim', char: c, count: run, orig: run, canOpen, canClose, m: m.slice(i, i + run) });
        textStart = i + run;
        i += run;
        continue;
      }
      i += 1;
    }
    flush(text.length);
    return pieces;
  }

  /** Strong, emphasis, and strikethrough, by CommonMark's delimiter rules. */
  emphasis(pieces) {
    let i = 0;
    while (i < pieces.length) {
      const closer = pieces[i];
      if (closer.type !== 'delim' || !closer.canClose || closer.count === 0) {
        i += 1;
        continue;
      }
      let found = -1;
      for (let j = i - 1; j >= 0; j -= 1) {
        const opener = pieces[j];
        if (opener.type !== 'delim' || opener.char !== closer.char || !opener.canOpen || opener.count === 0) continue;
        if (closer.char === '~') {
          if (opener.count !== closer.count) continue;
        } else if ((opener.canClose || closer.canOpen) && (opener.orig + closer.orig) % 3 === 0
          && !(opener.orig % 3 === 0 && closer.orig % 3 === 0)) {
          continue;
        }
        found = j;
        break;
      }
      if (found < 0) {
        i += 1;
        continue;
      }
      const opener = pieces[found];
      const use = closer.char === '~' ? closer.count : (opener.count >= 2 && closer.count >= 2 ? 2 : 1);
      const tag = closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em';
      const inner = this.flatten(pieces.slice(found + 1, i));
      opener.count -= use;
      opener.m = opener.m.slice(0, opener.m.length - use);
      closer.count -= use;
      closer.m = closer.m.slice(use);
      pieces.splice(found + 1, i - found - 1, { type: 'html', html: `<${tag}>${inner}</${tag}>` });
      i = found + 2;
    }
  }

  noteRef(label) {
    const notes = this.ctx.notes;
    const number = notes ? noteNumber(notes, label) : null;
    const key = `${this.ctx.scope}:${label}`;
    if (number == null) {
      if (label.startsWith('__inline_')) return '';
      return `<span class="warning missing-note" title="This note has no definition.">[^${esc(label)}]</span>`;
    }
    return `<sup class="fnref" id="ref:${esc(key)}"><a href="#" data-note="${esc(key)}">${number}</a></sup>`;
  }
}

// MARK: Blocks

const BLANK = /^[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const HTML_BLOCK = /^ {0,3}<(?:\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)|!--)/;
// A Pandoc fenced div: `::: center` or `::: {.center}` opens one, a line of colons alone closes it.
const DIV_OPEN = /^ {0,3}:{3,}[ \t]*(\{[^}]*\}|[^\s{}:]+)[ \t]*:*[ \t]*$/;
const DIV_CLOSE = /^ {0,3}:{3,}[ \t]*$/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function startsBlock(text) {
  if (fenceMark(text) || DIV_OPEN.test(text) || DIV_CLOSE.test(text) || ATX.test(text) || HR.test(text) || QUOTE.test(text) || HTML_BLOCK.test(text)) return true;
  const list = LIST.exec(text);
  return Boolean(list && list[3] !== '' && (!/\d/.test(list[2]) || /^1[.)]$/.test(list[2])));
}

/** The classes of a fenced div's attributes: `center` or `{.center #id key=value}`. */
function divClasses(attributes) {
  if (!attributes.startsWith('{')) return [attributes];
  return attributes.slice(1, -1).split(/\s+/).filter((a) => a.startsWith('.')).map((a) => a.slice(1)).filter(Boolean);
}

/** Leading indentation in columns, with tabs to the next multiple of four. */
function indentOf(text) {
  let col = 0;
  for (const c of text) {
    if (c === ' ') col += 1;
    else if (c === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** `line` without its first `columns` columns of indentation. */
function dropIndent(line, columns) {
  let col = 0;
  let i = 0;
  while (i < line.text.length && col < columns) {
    const c = line.text[i];
    if (c === ' ') col += 1;
    else if (c === '\t') col += 4 - (col % 4);
    else break;
    i += 1;
  }
  return line.slice(i);
}

function splitCells(line) {
  let text = line.text;
  let start = 0;
  let end = text.length;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (text[start] === '|') start += 1;
  if (end > start && text[end - 1] === '|' && text[end - 2] !== '\\') end -= 1;
  const cells = [];
  let cellStart = start;
  let inCode = 0;
  for (let i = start; i < end; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '`') {
      let run = 0;
      while (text[i + run] === '`') run += 1;
      inCode = inCode === run ? 0 : (inCode || run);
      i += run - 1;
      continue;
    }
    if (text[i] === '|' && !inCode) {
      cells.push(line.slice(cellStart, i).trim());
      cellStart = i + 1;
    }
  }
  cells.push(line.slice(cellStart, end).trim());
  return cells;
}

export class Renderer {
  /**
   * ctx: { scope, notes, indexID, headingShift } — `scope` tells note anchors apart when several
   * sections share one view; `headingShift` is the depth underlined headings are shifted by.
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.inline = new Inline(ctx);
  }

  /** Blocks of `entries`: [{ line: Mapped, no: body line number }]. */
  blocks(entries) {
    let html = '';
    let i = 0;
    const at = (k) => entries[k]?.line.text;
    const lineAttr = (k) => (entries[k]?.no != null ? ` data-line="${entries[k].no}"` : '');
    while (i < entries.length) {
      const text = at(i);
      if (BLANK.test(text)) {
        i += 1;
        continue;
      }
      const div = DIV_OPEN.exec(text);
      if (div) {
        // Divs nest; colons inside a code block close nothing. An unclosed div runs to the end.
        let depth = 1;
        let code = null;
        let k = i + 1;
        while (k < entries.length) {
          const t = at(k);
          const mark = fenceMark(t);
          if (code) {
            if (mark && fenceCloses(code, mark)) code = null;
          } else if (mark) {
            code = { char: mark.char, length: mark.length };
          } else if (DIV_OPEN.test(t)) {
            depth += 1;
          } else if (DIV_CLOSE.test(t)) {
            depth -= 1;
            if (depth === 0) break;
          }
          k += 1;
        }
        const classes = divClasses(div[1]).map((c) => ` div-${esc(c)}`).join('');
        html += `<div class="fenced-div${classes}"${lineAttr(i)}>${this.blocks(entries.slice(i + 1, k))}</div>`;
        i = k + 1;
        continue;
      }
      const fence = fenceMark(text);
      if (fence) {
        const open = { char: fence.char, length: fence.length };
        const indent = indentOf(text);
        const content = [];
        let k = i + 1;
        let closed = false;
        while (k < entries.length) {
          const mark = fenceMark(at(k));
          if (mark && fenceCloses(open, mark)) {
            closed = true;
            break;
          }
          content.push(dropIndent(entries[k].line, indent));
          k += 1;
        }
        const language = fence.info.trim().split(/\s+/)[0] || '';
        if (language === INDEX_INFO && this.ctx.indexID != null) {
          html += this.indexBlock(indexEntries(bookNodes, this.ctx.indexID), lineAttr(i));
          i = closed ? k + 1 : k;
          continue;
        }
        const code = this.codeBlock(content, language, lineAttr(i + 1 < entries.length ? i + 1 : i));
        if (language === MERMAID_INFO) {
          this.mermaids = (this.mermaids || 0) + 1;
          const width = mermaidWidth(fence.info);
          const attrs = lineAttr(i) + (width ? ` style="--mermaid-width:${width}"` : '');
          html += mermaidFence(content.map((l) => l.text).join('\n'), `${this.ctx.scope}:${this.mermaids}`, code, attrs);
        } else {
          html += code;
        }
        i = closed ? k + 1 : k;
        continue;
      }
      if (indentOf(text) >= 4) {
        const content = [];
        let k = i;
        while (k < entries.length && (indentOf(at(k)) >= 4 || BLANK.test(at(k)))) {
          content.push(dropIndent(entries[k].line, 4));
          k += 1;
        }
        while (content.length && BLANK.test(content[content.length - 1].text)) {
          content.pop();
          k -= 1;
        }
        html += this.codeBlock(content, '', lineAttr(i));
        i = k;
        continue;
      }
      const atx = ATX.exec(text);
      if (atx) {
        let content = entries[i].line.slice(atx[0].length);
        // Closing hashes and Pandoc attributes such as `{-}` are not shown.
        const attr = /[ \t]*\{[^}]*\}[ \t]*$/.exec(content.text);
        if (attr) content = content.slice(0, attr.index);
        const closing = /(?:^|[ \t]+)#+[ \t]*$/.exec(content.text);
        if (closing) content = content.slice(0, closing.index);
        const level = atx[1].length;
        html += `<h${level} class="h${level}"${lineAttr(i)}>${this.inline.render(content.trim())}</h${level}>`;
        i += 1;
        continue;
      }
      if (HR.test(text)) {
        html += `<hr${lineAttr(i)}>`;
        i += 1;
        continue;
      }
      if (HTML_BLOCK.test(text)) {
        let k = i;
        const lines = [];
        while (k < entries.length && !BLANK.test(at(k))) {
          lines.push(entries[k].line);
          k += 1;
        }
        html += this.htmlBlock(lines, lineAttr(i));
        i = k;
        continue;
      }
      if (QUOTE.test(text)) {
        const inner = [];
        let k = i;
        while (k < entries.length) {
          const t = at(k);
          const q = QUOTE.exec(t);
          if (q) inner.push({ line: entries[k].line.slice(q[0].length), no: entries[k].no });
          else if (!BLANK.test(t) && inner.length && !BLANK.test(inner[inner.length - 1].line.text) && !startsBlock(t)) {
            inner.push(entries[k]);
          } else break;
          k += 1;
        }
        html += `<blockquote${lineAttr(i)}>${this.blocks(inner)}</blockquote>`;
        i = k;
        continue;
      }
      const list = LIST.exec(text);
      if (list) {
        const result = this.list(entries, i);
        html += result.html;
        i = result.next;
        continue;
      }
      if (i + 1 < entries.length && text.includes('|') && TABLE_DELIMITER.test(at(i + 1)) && at(i + 1).includes('-')) {
        const header = splitCells(entries[i].line);
        const aligns = splitCells(entries[i + 1].line).map((c) => {
          const t = c.text.trim();
          if (t.startsWith(':') && t.endsWith(':')) return 'center';
          if (t.endsWith(':')) return 'right';
          if (t.startsWith(':')) return 'left';
          return '';
        });
        if (aligns.length === header.length) {
          let k = i + 2;
          const rows = [];
          while (k < entries.length && !BLANK.test(at(k)) && !startsBlock(at(k))) {
            rows.push(splitCells(entries[k].line));
            k += 1;
          }
          const cell = (tag, c, n) => `<${tag}${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${c ? this.inline.render(c) : ''}</${tag}>`;
          html += `<table${lineAttr(i)}><thead><tr>${header.map((c, n) => cell('th', c, n)).join('')}</tr></thead><tbody>`
            + rows.map((r) => `<tr>${aligns.map((_, n) => cell('td', r[n], n)).join('')}</tr>`).join('')
            + '</tbody></table>';
          i = k;
          continue;
        }
      }
      // A paragraph, or a setext heading when it ends on a line of = or -.
      const lines = [entries[i].line];
      let k = i + 1;
      let setext = 0;
      while (k < entries.length && !BLANK.test(at(k))) {
        if (/^ {0,3}=+[ \t]*$/.test(at(k))) {
          setext = 1;
          break;
        }
        if (/^ {0,3}-+[ \t]*$/.test(at(k))) {
          setext = 2;
          break;
        }
        if (startsBlock(at(k))) break;
        lines.push(entries[k].line);
        k += 1;
      }
      const joined = new Mapped();
      lines.forEach((l, n) => {
        joined.append(n === 0 ? l : l.slice(indentOf(l.text) > 0 ? l.text.length - l.text.trimStart().length : 0));
        if (n < lines.length - 1) joined.append(entries[i + n].line.length >= 0 ? this.newline(entries, i + n) : Mapped.madeUp('\n'));
      });
      if (setext) {
        // Shifted by the piece's depth, as shiftHeadings shifts # headings, and without Pandoc attributes.
        let text = joined.trim();
        const attr = /[ \t]*\{[^}]*\}[ \t]*$/.exec(text.text);
        if (attr) text = text.slice(0, attr.index);
        const level = clampHeadingLevel(setext + (this.ctx.headingShift ?? 0)).level;
        html += `<h${level} class="h${level}"${lineAttr(i)}>${this.inline.render(text)}</h${level}>`;
        i = k + 1;
      } else {
        html += `<p${lineAttr(i)}>${this.inline.render(joined.trim())}</p>`;
        i = k;
      }
    }
    return html;
  }

  /** The newline after entry `k`, mapped to its body offset when it has one. */
  newline(entries, k) {
    const line = entries[k].line;
    const last = line.map[line.length - 1];
    const next = entries[k + 1]?.line.map.find((o) => o >= 0);
    if (last >= 0 && next != null && next >= 0 && next > last) return new Mapped('\n', [last + 1]);
    return Mapped.madeUp('\n');
  }

  list(entries, start) {
    const first = LIST.exec(entries[start].line.text);
    const ordered = /\d/.test(first[2]);
    const bullet = first[2].slice(-1);
    const items = [];
    let loose = false;
    let k = start;
    while (k < entries.length) {
      const text = entries[k].line.text;
      const marker = LIST.exec(text);
      if (!marker || /\d/.test(marker[2]) !== ordered || marker[2].slice(-1) !== bullet) break;
      const spaces = marker[3].length;
      const width = marker[1].length + marker[2].length + (spaces > 4 || spaces === 0 ? 1 : spaces);
      const item = [{ line: entries[k].line.slice(Math.min(text.length, marker[0].length - (spaces > 4 ? spaces - 1 : 0))), no: entries[k].no }];
      k += 1;
      let blankRun = 0;
      while (k < entries.length) {
        const t = entries[k].line.text;
        if (BLANK.test(t)) {
          blankRun += 1;
          item.push({ line: new Mapped(), no: entries[k].no });
          k += 1;
          continue;
        }
        if (indentOf(t) >= width) {
          if (blankRun > 0) loose = true;
          item.push({ line: dropIndent(entries[k].line, width), no: entries[k].no });
          blankRun = 0;
          k += 1;
          continue;
        }
        if (blankRun === 0 && !startsBlock(t) && !LIST.test(t)) {
          item.push(entries[k]);
          k += 1;
          continue;
        }
        break;
      }
      // Trailing blank lines belong between items, not inside one.
      while (item.length > 1 && BLANK.test(item[item.length - 1].line.text)) {
        item.pop();
        k -= 1;
      }
      items.push({ item, no: entries[start].no });
      let after = k;
      while (after < entries.length && BLANK.test(entries[after].line.text)) after += 1;
      const nextMarker = after < entries.length ? LIST.exec(entries[after].line.text) : null;
      if (nextMarker && /\d/.test(nextMarker[2]) === ordered && nextMarker[2].slice(-1) === bullet) {
        if (after > k) loose = true;
        k = after;
      } else break;
    }
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : '';
    const body = items.map(({ item }) => `<li>${this.blocks(item)}</li>`).join('');
    return { html: `<${tag}${startAttr} class="${loose ? 'loose' : 'tight'}" data-line="${entries[start].no}">${body}</${tag}>`, next: k };
  }

  codeBlock(lines, language, lineAttr) {
    const content = new Mapped();
    lines.forEach((l) => {
      content.append(l);
      const end = l.map[l.length - 1];
      content.append(end != null && end >= 0 ? new Mapped('\n', [end + 1]) : Mapped.madeUp('\n'));
    });
    return `<pre class="code"${lineAttr} data-code="1"><code>${highlightCode(content, language, emit)}</code></pre>`;
  }

  /** An index: each following piece, numbered and indented by depth. A click opens the piece. */
  indexBlock(entries, lineAttr) {
    if (!entries.length) return `<p class="book-index-empty"${lineAttr}>No pages follow this index.</p>`;
    const rows = entries.map((e) => `<p class="book-index-entry" style="--depth:${e.depth}">`
      + `<span class="book-index-number">${esc(e.number)}</span>`
      + `<a href="#" data-open-node="${esc(e.id)}">${esc(e.title)}</a></p>`);
    return `<div class="book-index"${lineAttr} contenteditable="false">${rows.join('')}</div>`;
  }

  htmlBlock(lines, lineAttr) {
    const raw = lines.map((l) => l.text).join('\n').trim();
    if (/^<div class="page-break"><\/div>$/.test(raw)) return `<div class="page-break-mark"${lineAttr}>— Page break —</div>`;
    const division = /^<p class="chapter-number">([\s\S]*)<\/p>$/.exec(raw);
    if (division) return `<p class="division"${lineAttr}>${esc(division[1])}</p>`;
    const joined = new Mapped();
    lines.forEach((l, n) => {
      joined.append(l);
      if (n < lines.length - 1) joined.appendMadeUp('\n');
    });
    return `<pre class="raw-html-block"${lineAttr}>${emit(joined)}</pre>`;
  }

  /** A body as HTML. Notes are numbered from 1 and printed at the end. */
  render(mapped) {
    const notes = prepareNotes(mapped);
    this.ctx.notes = notes;
    const entries = notes.mapped.lines().map((entry, no) => ({ line: entry.line, no }));
    let html = this.blocks(entries);
    if (notes.unclosedFence) html += '<p class="warning">Unclosed code fence.</p>';
    const defined = notes.order.filter((label) => notes.definitions.has(label));
    if (defined.length) {
      html += '<div class="notes"><hr class="notes-rule"><ol>';
      for (const label of defined) {
        const key = `${this.ctx.scope}:${label}`;
        const inner = new Renderer({ scope: this.ctx.scope, notes }).blocks(
          Mapped.madeUp(notes.definitions.get(label)).lines().map((e) => ({ line: e.line, no: null })),
        );
        html += `<li id="note:${esc(key)}">${inner}<a href="#" class="backref" data-ref="${esc(key)}">↩</a></li>`;
      }
      html += '</ol></div>';
    }
    return html;
  }
}

/** A Markdown string rendered with no body offsets, such as an exported manuscript for print. */
export function renderPlain(markdown, scope) {
  return new Renderer({ scope }).render(Mapped.madeUp(markdown));
}

// MARK: Sections, groups, and the book

/**
 * One section as export shows it: its title at its depth, then its body shifted by that depth.
 * `bodyOf` gives the text to show for a node, such as unsaved text in the editor.
 */
export function renderSection(node, ancestors, division, bodyOf) {
  const depth = ancestors.length + 1;
  const front = isFront(node, ancestors);
  const level = clampHeadingLevel(depth).level;
  let html = `<section class="node-block" data-node="${esc(node.header.id)}">`;
  if (front) html += '<p class="kicker">Front matter</p>';
  if (division) html += `<p class="division">${esc(divisionLabel(division))}</p>`;
  html += `<h${level} class="h${level} node-title">${esc(node.header.title || 'Untitled')}</h${level}>`;
  html += new Renderer({ scope: node.header.id, indexID: node.header.id, headingShift: depth }).render(shiftHeadings(bodyOf(node), depth));
  return html + '</section>';
}

const PAGE_BREAK = '<div class="page-break-mark">— Page break —</div>';

/** A group in tree order: its own body, then each descendant's title and body. */
export function renderGroup(node, ancestors, divisions, bodyOf) {
  let html = renderSection(node, ancestors, divisions[node.header.id], bodyOf);
  for (const child of node.children) {
    if (startsNewPage(child)) html += PAGE_BREAK;
    html += renderNode(child, [...ancestors, node], divisions, bodyOf);
  }
  return html;
}

function renderNode(node, ancestors, divisions, bodyOf) {
  if (isGroup(node)) return renderGroup(node, ancestors, divisions, bodyOf);
  return renderSection(node, ancestors, divisions[node.header.id], bodyOf);
}

/** The manuscript straight through. The trash is the caller's to leave out. */
export function renderBook(nodes, divisions, bodyOf) {
  return nodes.map((node, index) => (index > 0 && startsNewPage(node) ? PAGE_BREAK : '') + renderNode(node, [], divisions, bodyOf)).join('');
}
