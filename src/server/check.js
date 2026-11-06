// Checks a book's book.json and comments.json the way Webwriter reads them.
// Exit status: 0 with no errors (warnings allowed), 1 with errors, 2 for a wrong call.
import path from 'node:path';
import * as fsu from './fsutil.js';
import { BOOK_FILE, LEGACY_FILE, parseBookFile } from './bookfile.js';
import { loadBook } from './bookstore.js';
import { commentsPath } from './commentfile.js';
import { COMMENTS_FILE, commentProblems, decodeComments, describeProblem } from '../../shared/comments.js';
import { find } from '../../shared/tree.js';
import { TAGS_FILE, decodeTags } from '../../shared/tags.js';

export const USAGE = `usage: webwriter check <book folder>

Checks book.json, comments.json, and tags.json the way Webwriter reads them, and each comment
against the text it points at. Errors mean the file is wrong: Webwriter cannot read it,
or drops comments from it. Warnings mean Webwriter will move or hide a comment.`;

/** Problems with the book's comments file, each checked against its text. */
function commentFileProblems(root) {
  const text = fsu.tryReadText(commentsPath(root));
  if (text == null) return [];
  let comments;
  try {
    comments = decodeComments(text);
  } catch (error) {
    return [{ severity: 'error', message: `${COMMENTS_FILE} cannot be read: ${error.message}`, commentID: null }];
  }
  let book = null;
  try {
    book = loadBook(root);
  } catch {
    book = null;
  }
  const problems = commentProblems(comments, book ? (id) => find(book.nodes, id)?.node.body ?? null : null);
  if (!book) problems.push({ severity: 'warning', message: 'The book could not be read, so comments were not checked against their text.', commentID: null });
  if (comments.length === 0) problems.push({ severity: 'warning', message: 'The file has no comments. Webwriter deletes the file instead of writing an empty list.', commentID: null });
  return problems;
}

/** Runs the check and returns { lines, status }. */
export function check(folder) {
  const root = path.resolve(folder);
  if (!fsu.isDirectory(root)) return { lines: [`error: ${root} is not a folder.`], status: 1 };
  const problems = [];
  const warn = (message) => problems.push({ severity: 'warning', message, commentID: null });
  const titleText = fsu.tryReadText(path.join(root, BOOK_FILE));
  const legacy = fsu.exists(path.join(root, LEGACY_FILE));
  if (titleText != null) {
    try {
      if (parseBookFile(titleText) === '') warn(`${BOOK_FILE} has an empty title. Webwriter uses the folder name.`);
    } catch (error) {
      problems.push({ severity: 'error', message: `${BOOK_FILE} cannot be read: ${error.message}`, commentID: null });
    }
    if (legacy) warn(`${LEGACY_FILE} is no longer used, because ${BOOK_FILE} holds the title. It can be deleted.`);
  } else if (legacy) {
    warn(`The title is in ${LEGACY_FILE}, the older format. Webwriter moves it to ${BOOK_FILE} when it opens the book.`);
  } else if (fsu.isDirectory(path.join(root, 'manuscript'))) {
    warn(`There is no ${BOOK_FILE}. Webwriter uses the folder name as the title.`);
  } else {
    warn(`This folder has neither ${BOOK_FILE} nor manuscript/, so it is not a book yet.`);
  }
  problems.push(...commentFileProblems(root));
  const tagsText = fsu.tryReadText(path.join(root, TAGS_FILE));
  if (tagsText != null) {
    try {
      decodeTags(tagsText);
    } catch (error) {
      problems.push({ severity: 'error', message: `${TAGS_FILE} cannot be read: ${error.message}`, commentID: null });
    }
  }

  const lines = problems.map(describeProblem);
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  let summary;
  const text = fsu.tryReadText(commentsPath(root));
  if (text == null) summary = 'no comments.json';
  else {
    try {
      const count = decodeComments(text).length;
      summary = `${count} comment${count === 1 ? '' : 's'}`;
    } catch {
      summary = 'comments.json unreadable';
    }
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  lines.push(errors === 0 ? `OK: ${summary}, ${plural(warnings, 'warning')}.` : `FAILED: ${plural(errors, 'error')}, ${plural(warnings, 'warning')}.`);
  return { lines, status: errors === 0 ? 0 : 1 };
}
