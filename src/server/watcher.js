// Reports files that change anywhere under a folder, such as a book folder edited by another
// program while Webwriter has it open. Changes that come close together arrive as one batch.
import fs from 'node:fs';
import path from 'node:path';

export class FolderWatcher {
  /** `onChange` receives the changed paths, relative to the folder, with `/` separators. */
  constructor(root, onChange, latency = 300) {
    this.root = root;
    this.pending = new Set();
    this.timer = null;
    this.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      const relative = filename ? String(filename).split(path.sep).join('/') : '';
      this.pending.add(relative);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const paths = [...this.pending];
        this.pending.clear();
        onChange(paths);
      }, latency);
    });
    this.watcher.on('error', () => this.stop());
  }

  stop() {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}

/** Whether a changed path is one the application follows: the manuscript, the title, the comments, or the tag colors. */
export function relevantChange(relative) {
  if (relative === '') return { manuscript: true, comments: true, tags: true };
  const parts = relative.split('/');
  const name = parts[parts.length - 1];
  // Temporary files of atomic writes start with a dot. Their rename is reported under the real name.
  if (name.startsWith('.') && parts.length === 1) return { manuscript: false, comments: false, tags: false };
  return {
    manuscript: parts[0] === 'manuscript' || relative === 'book.json',
    comments: relative === 'comments.json',
    tags: relative === 'tags.json',
  };
}
