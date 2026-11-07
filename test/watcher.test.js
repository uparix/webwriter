import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FolderWatcher, relevantChange } from '../src/server/watcher.js';

test('the changes followed are the manuscript, book.json, comments, tags, and pictures', () => {
  assert.deepEqual(relevantChange('manuscript/010-one/020-two.md'), { manuscript: true, comments: false, tags: false, pictures: false });
  assert.equal(relevantChange('book.json').manuscript, true);
  assert.equal(relevantChange('comments.json').comments, true);
  assert.equal(relevantChange('tags.json').tags, true);
  assert.equal(relevantChange('images/flow.drawio.svg').pictures, true);
  // Anything else in the folder, and the temporary files of atomic writes, are left alone.
  assert.deepEqual(relevantChange('AGENTS.md'), { manuscript: false, comments: false, tags: false, pictures: false });
  assert.deepEqual(relevantChange('manuscript/.tmp-1234'), { manuscript: false, comments: false, tags: false, pictures: false });
  assert.deepEqual(relevantChange('.comments.json.tmp'), { manuscript: false, comments: false, tags: false, pictures: false });
  // A change without a name may be anything.
  assert.deepEqual(relevantChange(''), { manuscript: true, comments: true, tags: true, pictures: true });
});

test('changes close together arrive as one batch of relative paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-watch-'));
  fs.mkdirSync(path.join(root, 'manuscript'));
  let watcher;
  try {
    const batch = await new Promise((resolve) => {
      watcher = new FolderWatcher(root, resolve, 200);
      fs.writeFileSync(path.join(root, 'manuscript', '010-a.md'), 'a');
      fs.writeFileSync(path.join(root, 'tags.json'), '{}');
    });
    assert.ok(batch.includes('manuscript/010-a.md'), batch.join(', '));
    assert.ok(batch.includes('tags.json'), batch.join(', '));
  } finally {
    watcher?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('when watching fails, the watcher stops and reports the error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-watch-'));
  const errors = [];
  const watcher = new FolderWatcher(root, () => {}, 300, (error) => errors.push(error.message));
  try {
    watcher.watcher.emit('error', new Error('no watches left'));
    assert.deepEqual(errors, ['no watches left']);
    assert.equal(watcher.watcher, null);
  } finally {
    watcher.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
