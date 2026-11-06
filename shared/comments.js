// Review comments: the comments.json format, keeping comments on their text, and merging
// changes made by other programs. Offsets are UTF-16 code units, which JavaScript strings use.

export const COMMENTS_FILE = 'comments.json';
export const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
export const COLOR_HEX = {
  yellow: '#FFE86B', green: '#B8EB9E', blue: '#ADD9FF', pink: '#FFC2D6', purple: '#D6C2FF',
};

/** Yellow is the default and the color of comments that have none. */
export const highlight = (comment) => comment.color || 'yellow';

// MARK: JSON layout

/**
 * The JSON layout of the book-level files: two-space indent, sorted keys, `" : "` between key and
 * value, slashes not escaped, non-ASCII written as itself. No trailing newline; callers add it.
 */
export function stableStringify(value, indent = '') {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[\n\n' + indent + ']';
    return `[\n${value.map((v) => inner + stableStringify(v, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  if (keys.length === 0) return '{\n\n' + indent + '}';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)} : ${stableStringify(value[k], inner)}`).join(',\n')}\n${indent}}`;
}

// MARK: Dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** ISO 8601 as whole-second UTC, as the file stores it. Null when it is not a date. */
export function normalizeDate(text) {
  if (typeof text !== 'string' || !ISO_DATE.test(text)) return null;
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  return wholeSeconds(new Date(time));
}

export function wholeSeconds(date) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

// MARK: Reading and writing

export class CommentsFileError extends Error {}

function place(path) {
  return path === '' ? 'the top level' : path;
}

/** Comments from the text of a comments.json, decoded the way Bookwriter decodes them. Throws when unreadable. */
export function decodeComments(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new CommentsFileError(`The JSON is not valid. ${error.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new CommentsFileError('the top level has the wrong type. Expected an object.');
  }
  if (!('version' in data)) throw new CommentsFileError('"version" is missing at the top level.');
  if (!Number.isInteger(data.version)) throw new CommentsFileError('version has the wrong type. Expected an integer.');
  if (!('comments' in data)) throw new CommentsFileError('"comments" is missing at the top level.');
  if (!Array.isArray(data.comments)) throw new CommentsFileError('comments has the wrong type. Expected an array.');
  return data.comments.map((raw, index) => decodeComment(raw, `comments[${index}]`));
}

function decodeComment(raw, path) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CommentsFileError(`${place(path)} has the wrong type. Expected an object.`);
  }
  const need = (key, check, what) => {
    if (!(key in raw) || raw[key] === null) throw new CommentsFileError(`"${key}" is missing at ${path}.`);
    if (!check(raw[key])) throw new CommentsFileError(`${path}.${key} has the wrong type. Expected ${what}.`);
    return raw[key];
  };
  const isString = (v) => typeof v === 'string';
  const comment = {
    id: need('id', isString, 'a string'),
    nodeID: need('nodeID', isString, 'a string'),
    start: need('start', Number.isInteger, 'an integer'),
    length: need('length', Number.isInteger, 'an integer'),
    quote: need('quote', isString, 'a string'),
    author: need('author', isString, 'a string'),
    date: need('date', isString, 'a date string'),
    text: need('text', isString, 'a string'),
  };
  const date = normalizeDate(comment.date);
  if (!date) throw new CommentsFileError(`${path}.date is not valid. Expected date string to be ISO8601-formatted.`);
  comment.date = date;
  if (raw.color != null) {
    if (!COLORS.includes(raw.color)) {
      throw new CommentsFileError(`${path}.color is not valid. Cannot initialize CommentColor from invalid String value ${raw.color}`);
    }
    comment.color = raw.color;
  }
  return comment;
}

/** One comment with exactly the stored keys. A comment without a color has no `color` key. */
function stored(comment) {
  const out = {
    author: comment.author, date: comment.date, id: comment.id, length: comment.length,
    nodeID: comment.nodeID, quote: comment.quote, start: comment.start, text: comment.text,
  };
  if (comment.color) out.color = comment.color;
  return out;
}

/** The text of comments.json for these comments, with a newline at the end. */
export function encodeComments(comments) {
  return stableStringify({ comments: comments.map(stored), version: 1 }) + '\n';
}

export function sameComment(a, b) {
  return a.id === b.id && a.nodeID === b.nodeID && a.start === b.start && a.length === b.length
    && a.quote === b.quote && a.author === b.author && a.date === b.date && a.text === b.text
    && (a.color || null) === (b.color || null);
}

export function sameComments(a, b) {
  return a.length === b.length && a.every((c, i) => sameComment(c, b[i]));
}

// MARK: Checking

/** Problems with `comments`. With `findBody`, each comment is also checked against its text. */
export function commentProblems(comments, findBody = null) {
  const problems = [];
  const seen = new Set();
  const add = (severity, message, commentID = null) => problems.push({ severity, message, commentID });
  for (const comment of comments) {
    const id = comment.id === '' ? null : comment.id;
    if (comment.id === '') add('error', 'A comment has an empty id. Bookwriter gives it a new one.');
    if (comment.id !== '') {
      if (seen.has(comment.id)) add('error', 'The id is used by more than one comment. Bookwriter keeps only the first.', id);
      seen.add(comment.id);
    }
    if (comment.nodeID === '') add('error', 'nodeID is empty. Bookwriter drops the comment.', id);
    if (comment.start < 0) add('error', 'start is negative. Bookwriter places the comment by its quote.', id);
    if (comment.length < 0) add('error', 'length is negative. Bookwriter places the comment by its quote.', id);
    if (!findBody || comment.nodeID === '') continue;
    const body = findBody(comment.nodeID);
    if (body == null) {
      add('warning', `No section or folder has the id "${comment.nodeID}". The comment is not shown, and is dropped when the outline changes.`, id);
      continue;
    }
    const inBody = comment.start >= 0 && comment.length >= 0 && comment.start + comment.length <= body.length;
    if (inBody && body.substr(comment.start, comment.length) === comment.quote) continue;
    if (comment.quote === '') add('warning', 'quote is empty, so the comment cannot follow its text.', id);
    else if (!body.includes(comment.quote)) {
      add('warning', `The quote is not in the body of "${comment.nodeID}". The comment is shown without a highlight.`, id);
    } else {
      add('warning', 'start and length do not cover the quote. Bookwriter moves the comment onto the nearest copy of the quote.', id);
    }
  }
  return problems;
}

export function describeProblem(problem) {
  return `${problem.severity}: ${problem.commentID != null ? `comment "${problem.commentID}": ` : ''}${problem.message}`;
}

export function newCommentID() {
  return globalThis.crypto.randomUUID().toUpperCase();
}

/**
 * Comments as read from a file, put right so that saving them makes a valid file:
 * a repeated id keeps its first comment, an empty id gets a new one, a negative start or length
 * becomes 0 (the comment is then placed by its quote), and a comment without a node is dropped.
 */
export function repaired(comments) {
  const seen = new Set();
  const out = [];
  for (const comment of comments) {
    const fixed = { ...comment };
    if (fixed.id === '') fixed.id = newCommentID();
    if (fixed.nodeID === '' || seen.has(fixed.id)) continue;
    seen.add(fixed.id);
    fixed.start = Math.max(0, fixed.start);
    fixed.length = Math.max(0, fixed.length);
    out.push(fixed);
  }
  return out;
}

// MARK: Anchors

/**
 * Move a comment's range for one edit: [rangeStart, rangeStart + rangeLength) of the body was replaced
 * by `inserted` characters. Text typed inside the comment joins it; text typed at either edge does not.
 */
export function shiftRange(comment, rangeStart, rangeLength, inserted) {
  const delta = inserted - rangeLength;
  const start = comment.start;
  const end = comment.start + comment.length;
  const rangeEnd = rangeStart + rangeLength;
  if (rangeEnd <= start) return { start: start + delta, length: comment.length };
  if (rangeStart >= end) return { start, length: comment.length };
  const newStart = Math.min(start, rangeStart);
  const newEnd = end > rangeEnd ? end + delta : rangeStart + inserted;
  return { start: newStart, length: Math.max(0, newEnd - newStart) };
}

const TRIMMABLE = new Set(['*', '_', '~', '`', ' ', '\t', '\n']);

/** The range without whitespace and inline marks at either end. A range that is nothing else is kept. */
export function trimRange(range, body) {
  if (range.start < 0 || range.start + range.length > body.length) return range;
  let start = range.start;
  let end = range.start + range.length;
  while (start < end && TRIMMABLE.has(body[start])) start += 1;
  while (end > start && TRIMMABLE.has(body[end - 1])) end -= 1;
  return start < end ? { start, length: end - start } : range;
}

/**
 * Put a comment back on its quote in `body`, the nearest copy to where it was.
 * A comment whose quote is gone stays, with an empty range, where it was.
 */
export function reanchor(comment, body) {
  const { start, length, quote } = comment;
  if (start >= 0 && start + length <= body.length && body.substr(start, length) === quote) return { start, length };
  const fallback = { start: Math.min(Math.max(0, start), body.length), length: 0 };
  if (quote === '') return fallback;
  let best = -1;
  let from = 0;
  while (from < body.length) {
    const found = body.indexOf(quote, from);
    if (found < 0) break;
    if (best < 0 || Math.abs(found - start) < Math.abs(best - start)) best = found;
    from = found + 1;
  }
  return best < 0 ? fallback : { start: best, length: quote.length };
}

/**
 * Like `reanchor`, but when the quote is gone it also accepts the quote with its spaces changed, as
 * lining up a table changes them. Returns { start, length, quote } with the text it found.
 */
export function reanchorLoose(comment, body) {
  const exact = reanchor(comment, body);
  if (exact.length > 0 || comment.quote.trim() === '') return { ...exact, quote: comment.quote };
  const tokens = comment.quote.trim().match(/\||\s+|[^\s|]+/g);
  const isSpace = (t) => t != null && /^\s+$/.test(t);
  let pattern = '';
  tokens.forEach((token, i) => {
    const before = tokens[i - 1];
    const after = tokens[i + 1];
    if (isSpace(token)) pattern += before === '|' || after === '|' ? '\\s*' : '\\s+';
    else if (token === '|') {
      if (before != null && !isSpace(before)) pattern += '[ \\t]*';
      pattern += '\\|';
      if (after != null && !isSpace(after)) pattern += '[ \\t]*';
    } else pattern += token.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  });
  let best = null;
  for (const match of body.matchAll(new RegExp(pattern, 'g'))) {
    if (!best || Math.abs(match.index - comment.start) < Math.abs(best.index - comment.start)) best = match;
  }
  if (!best) return { ...exact, quote: comment.quote };
  return { start: best.index, length: best[0].length, quote: best[0] };
}

// MARK: Merging

function movedOutside(base, theirs) {
  return theirs.nodeID !== base.nodeID || theirs.start !== base.start || theirs.length !== base.length || theirs.quote !== base.quote;
}

function mergeFields(mine, base, theirs) {
  const out = { ...mine };
  if (theirs.text !== base.text) out.text = theirs.text;
  if (theirs.author !== base.author) out.author = theirs.author;
  if (theirs.date !== base.date) out.date = theirs.date;
  if ((theirs.color || null) !== (base.color || null)) out.color = theirs.color;
  if (movedOutside(base, theirs)) {
    out.nodeID = theirs.nodeID;
    out.start = theirs.start;
    out.length = theirs.length;
    out.quote = theirs.quote;
  }
  return out;
}

function byID(list) {
  const map = new Map();
  for (const c of list) if (!map.has(c.id)) map.set(c.id, c);
  return map;
}

/**
 * A three-way merge by comment id. `base` is the file as last read or written, `mine` is what the
 * application has now, and `theirs` is the file as it is now. Additions and deletions on either side
 * are kept. Where both sides changed one comment, each field the other program changed takes its value.
 */
export function mergeComments(base, mine, theirs) {
  const before = byID(base);
  const now = byID(theirs);
  const kept = new Set(mine.map((c) => c.id));
  const merged = [];
  for (const comment of mine) {
    const old = before.get(comment.id);
    if (!old) {
      merged.push(comment);
      continue;
    }
    const fresh = now.get(comment.id);
    if (!fresh) continue;
    merged.push(mergeFields(comment, old, fresh));
  }
  const added = new Set();
  for (const comment of theirs) {
    if (before.has(comment.id) || kept.has(comment.id) || added.has(comment.id)) continue;
    added.add(comment.id);
    merged.push(comment);
  }
  return merged;
}

/** The ids of comments that `theirs` added or moved to other text, compared with `base`. */
export function placedOutside(base, theirs) {
  const before = byID(base);
  return new Set(theirs.filter((c) => {
    const old = before.get(c.id);
    return !old || movedOutside(old, c);
  }).map((c) => c.id));
}
