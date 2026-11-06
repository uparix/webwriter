// Pictures live in `images/` beside `manuscript/`. Paths in the text count from the book folder.
import fs from 'node:fs';
import path from 'node:path';
import * as fsu from './fsutil.js';

export const PICTURE_DIR = 'images';
export const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'tif', 'tiff', 'heic', 'pdf'];

export function isPicture(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return PICTURE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/** A taken name becomes `name-2`, `name-3`, and so on. */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n += 1;
  return `${stem}-${n}${ext}`;
}

function cleanName(name) {
  const cleaned = [...name].filter((c) => !'<>\r\n'.includes(c)).join('').trim();
  return cleaned === '' ? 'picture' : cleaned;
}

/**
 * Move `source` into `images/` and return the path to write in the text.
 * A file already in `images/` stays put.
 */
export function placePicture(source, root) {
  const bookRoot = fsu.canonical(root);
  const from = fsu.canonical(source);
  const name = cleanName(path.basename(from));
  if (!isPicture(name) || fsu.isDirectory(from)) throw new Error('Choose a picture file.');
  const relative = path.relative(bookRoot, from);
  if (fsu.isInside(bookRoot, from) && relative.split(path.sep)[0] === PICTURE_DIR && relative.includes(path.sep)) {
    return relative.split(path.sep).join('/');
  }
  const images = path.join(bookRoot, PICTURE_DIR);
  fsu.makeDirectory(images);
  const stored = uniqueName(name, new Set(fsu.readDir(images).map((e) => e.name)));
  fsu.move(from, path.join(images, stored));
  return `${PICTURE_DIR}/${stored}`;
}

/** Store uploaded bytes in `images/` under a free name and return the path to write in the text. */
export function storeUpload(name, bytes, root) {
  const clean = cleanName(path.basename(name));
  if (!isPicture(clean)) throw new Error('Choose a picture file.');
  const images = path.join(root, PICTURE_DIR);
  fsu.makeDirectory(images);
  const stored = uniqueName(clean, new Set(fsu.readDir(images).map((e) => e.name)));
  // Written through a dot-name, so a half-written picture is never shown.
  const temp = path.join(images, `.${stored}.upload`);
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, path.join(images, stored));
  return `${PICTURE_DIR}/${stored}`;
}
