// The few file operations the book needs. Files are UTF-8 with LF line endings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function tryReadText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Write atomically so a crash never leaves half a file. The temporary name starts with a dot, so it is ignored. */
export function writeText(file, text) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.webwriter-${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, text, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/** Directory entries, without names that start with a dot. */
export function readDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, isDirectory: isDirectory(path.join(dir, entry.name)) }));
}

export const exists = (p) => fs.existsSync(p);

export function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function makeDirectory(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Rename or move, creating the destination directory. Works across volumes. */
export function move(from, to) {
  makeDirectory(path.dirname(to));
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** Remove a file or a directory. A missing path is not an error. */
export function remove(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function canonical(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Whether `child` is `parent` or inside it. */
export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
