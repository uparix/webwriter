// Runs Pandoc for the Word export. Webwriter has no compile engine of its own.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wordFiles, exportBook, timestamped } from '../../shared/export.js';
import { resolveTagColors } from '../../shared/tags.js';

/** Draws tags as shaded text in Word. */
const TAG_FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tags.lua');
/** Writes page breaks and chapter numbers as Word page breaks and paragraphs. */
const BREAK_FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'breaks.lua');

export const NOT_INSTALLED = 'Pandoc is not installed. Install it, for example with `brew install pandoc`, and export again.';

/** Pandoc on the PATH or in the usual install places. */
export function pandocExecutable(env = process.env) {
  const home = env.HOME || os.homedir();
  const places = [
    ...(env.PATH || '').split(path.delimiter).filter(Boolean),
    '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', `${home}/.local/bin`, `${home}/.cabal/bin`,
  ];
  const name = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
  for (const place of places) {
    const candidate = path.join(place, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** Convert Markdown to a Word file. Pandoc runs in the book folder, so picture paths resolve. */
export function docx(markdown, output, resourceDirectory) {
  const pandoc = pandocExecutable();
  if (!pandoc) return Promise.reject(new Error(NOT_INSTALLED));
  return new Promise((resolve, reject) => {
    const child = spawn(pandoc, ['--from=markdown', '--to=docx', `--lua-filter=${TAG_FILTER}`, `--lua-filter=${BREAK_FILTER}`, '-o', output], {
      cwd: resourceDirectory, stdio: ['pipe', 'ignore', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errors.trim() || 'Pandoc failed.'));
    });
    child.stdin.end(markdown);
  });
}

/**
 * One Word file for each front-matter piece and each chapter, written into `directory`.
 * `tags` are the colors from tags.json, so each tag is shaded in its color.
 */
export async function writeChapters(book, directory, date = new Date(), tags = {}) {
  const exported = wordFiles(book.nodes);
  const names = [];
  for (const file of exported.files) {
    const name = date ? timestamped(file.name, date) : file.name;
    await docx(resolveTagColors(file.markdown, tags), path.join(directory, name), book.root);
    names.push(name);
  }
  return { files: names, warnings: exported.warnings };
}

/** The whole manuscript as one Word file at `file`. */
export async function writeBook(book, file, tags = {}) {
  const exported = exportBook(book.nodes);
  await docx(resolveTagColors(exported.markdown, tags), file, book.root);
  return { file, warnings: exported.warnings };
}
