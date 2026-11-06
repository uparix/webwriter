// `book.json`: facts about the whole book. Today that is the title.
// Older books keep the title in `book.yaml`; loading such a book writes `book.json` and removes `book.yaml`.
import { stableStringify } from '../../shared/comments.js';
import { normalizeNewlines, parseScalar } from './header.js';

export const BOOK_FILE = 'book.json';
export const LEGACY_FILE = 'book.yaml';

export function serializeBookFile(title) {
  return stableStringify({ title, version: 1 }) + '\n';
}

/** The title in a `book.json`. Throws when the file is not valid, with the reason. */
export function parseBookFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The JSON is not valid. ${error.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('the top level has the wrong type. Expected an object.');
  }
  if (!('title' in data) || data.title === null) throw new Error('"title" is missing at the top level.');
  if (typeof data.title !== 'string') throw new Error('title has the wrong type. Expected to decode String.');
  if (!('version' in data) || data.version === null) throw new Error('"version" is missing at the top level.');
  if (!Number.isInteger(data.version)) throw new Error('version has the wrong type. Expected to decode Int.');
  if (data.version !== 1) throw new Error(`"version" is ${data.version}, and this Bookwriter knows only version 1.`);
  return data.title;
}

/** The title in an older `book.yaml`: the first line that starts with `title:`. */
export function parseLegacyTitle(text) {
  for (const line of normalizeNewlines(text).split('\n')) {
    const match = /^title:\s*(.*)$/.exec(line);
    if (match) return parseScalar(match[1]);
  }
  return '';
}
