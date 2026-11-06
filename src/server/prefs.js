// The writer's preferences, per user and not in the book: the last book, the recent books,
// the review author name, and the color for new comments.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { COLORS } from '../../shared/comments.js';
import { writeText, makeDirectory } from './fsutil.js';

const MAX_RECENT = 10;

export function preferencesFile(env = process.env) {
  if (env.WEBWRITER_PREFS) return env.WEBWRITER_PREFS;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'webwriter', 'preferences.json');
}

/** The user's full name where the system knows it, otherwise the login name. */
function fullUserName() {
  try {
    if (process.platform === 'darwin') {
      const name = execFileSync('id', ['-F'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (name) return name;
    }
  } catch {
    // Fall back to the login name.
  }
  return os.userInfo().username;
}

export class Preferences {
  constructor(file = preferencesFile()) {
    this.file = file;
    this.values = {};
    try {
      this.values = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      this.values = {};
    }
  }

  save() {
    try {
      makeDirectory(path.dirname(this.file));
      writeText(this.file, JSON.stringify(this.values, null, 2) + '\n');
    } catch {
      // Preferences are a convenience. A read-only home folder must not stop the writer.
    }
  }

  get lastBook() { return this.values.lastBook || null; }

  get recentBooks() { return Array.isArray(this.values.recentBooks) ? this.values.recentBooks : []; }

  get reviewAuthor() { return this.values.reviewAuthor || fullUserName(); }

  get reviewColor() { return COLORS.includes(this.values.reviewColor) ? this.values.reviewColor : null; }

  rememberBook(root) {
    this.values.lastBook = root;
    this.values.recentBooks = [root, ...this.recentBooks.filter((p) => p !== root)].slice(0, MAX_RECENT);
    this.save();
  }

  clearRecent() {
    this.values.recentBooks = [];
    this.save();
  }

  update({ reviewAuthor, reviewColor }) {
    if (typeof reviewAuthor === 'string' && reviewAuthor.trim()) this.values.reviewAuthor = reviewAuthor.trim();
    if (reviewColor === null || COLORS.includes(reviewColor)) this.values.reviewColor = reviewColor;
    this.save();
  }
}
