// comments.json on disk. The application never writes an invalid file.
import path from 'node:path';
import * as fsu from './fsutil.js';
import {
  COMMENTS_FILE, commentProblems, decodeComments, encodeComments, sameComments, describeProblem,
} from '../../shared/comments.js';

export const commentsPath = (root) => path.join(root, COMMENTS_FILE);

/** The book's comments. A book without the file has none. Throws when the file cannot be read. */
export function loadComments(root) {
  const text = fsu.tryReadText(commentsPath(root));
  if (text == null) return [];
  return decodeComments(text);
}

/** Write the comments. With none left the file is removed, so a book without review stays as it was. */
export function saveComments(root, comments) {
  if (comments.length === 0) {
    fsu.remove(commentsPath(root));
    return;
  }
  const errors = commentProblems(comments).filter((p) => p.severity === 'error');
  if (errors.length) {
    throw new Error(`The review comments were not saved, because the file would not be valid: ${errors.map(describeProblem).join(' ')}`);
  }
  const text = encodeComments(comments);
  // What is written must read back as the same comments, or it is not written at all.
  let readBack = null;
  try {
    readBack = decodeComments(text);
  } catch {
    readBack = null;
  }
  const normalized = comments.map((c) => ({ ...c, color: c.color || undefined }));
  if (!readBack || !sameComments(readBack, normalized)) {
    throw new Error('The review comments were not saved, because the file would not be valid: The comments did not read back as written.');
  }
  if (fsu.tryReadText(commentsPath(root)) === text) return;
  fsu.writeText(commentsPath(root), text);
}
