// Reports files that change anywhere under a folder, such as a book folder edited by another
// program while Webwriter has it open. Changes that come close together arrive as one batch.
import fs from 'node:fs';
import path from 'node:path';

export class FolderWatcher {
  /**
   * `onChange` receives the changed paths, relative to the folder, with `/` separators. When watching
   * fails, such as when the folder is moved or the system has no watches left, it stops and `onError`
   * receives the error.
   */
  constructor(root, onChange, latency = 300, onError = () => {}) {
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
    this.watcher.on('error', (error) => {
      this.stop();
      onError(error);
    });
  }

  stop() {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}

/** Whether a changed path is one the application follows: the manuscript, the title, the comments, the tag colors, or the pictures. */
export function relevantChange(relative) {
  if (relative === '') return { manuscript: true, comments: true, tags: true, pictures: true };
  const parts = relative.split('/');
  const name = parts[parts.length - 1];
  // Temporary files of atomic writes start with a dot. Their rename is reported under the real name.
  if (name.startsWith('.')) return { manuscript: false, comments: false, tags: false, pictures: false };
  return {
    manuscript: parts[0] === 'manuscript' || relative === 'book.json',
    comments: relative === 'comments.json',
    tags: relative === 'tags.json',
    pictures: parts[0] === 'images',
  };
}
