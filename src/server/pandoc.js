// Runs Pandoc for the Word export. Webwriter has no compile engine of its own.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wordFiles, exportBook, timestamped } from '../../shared/export.js';
import { resolveTagColors } from '../../shared/tags.js';
import { replaceMermaid } from '../../shared/mermaid.js';

/** Draws tags as shaded text in Word. */
const TAG_FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tags.lua');
/** Writes page breaks and chapter numbers as Word page breaks and paragraphs. */
const BREAK_FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'breaks.lua');
/** Gives `::: left`, `::: center`, and `::: right` divs their paragraph styles. */
const ALIGN_FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'align.lua');
/** Run on the written file: makes those paragraph styles aligned. */
const ALIGN_STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'align-styles.lua');

/** A line such as `::: right` or `::: {.right}` opens an aligned div. */
const ALIGN_DIV = /^ {0,3}:{3,}[ \t]*(?:(?:left|center|right)|\{[^}]*\.(?:left|center|right)(?![\w-])[^}]*\})[ \t]*:*[ \t]*$/m;

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

/** Run Pandoc with `args`, writing `input` to it. Pandoc runs in `cwd`, so picture paths resolve. */
function runPandoc(pandoc, args, cwd, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(pandoc, args, { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errors.trim() || 'Pandoc failed.'));
    });
    child.stdin.end(input);
  });
}

/** Convert Markdown to a Word file. Pandoc runs in the book folder, so picture paths resolve. */
export async function docx(markdown, output, resourceDirectory) {
  const pandoc = pandocExecutable();
  if (!pandoc) throw new Error(NOT_INSTALLED);
  const filters = [TAG_FILTER, BREAK_FILTER, ALIGN_FILTER].map((filter) => `--lua-filter=${filter}`);
  await runPandoc(pandoc, ['--from=markdown', '--to=docx', ...filters, '-o', output], resourceDirectory, markdown);
  if (ALIGN_DIV.test(markdown)) await runPandoc(pandoc, ['lua', ALIGN_STYLES, path.resolve(resourceDirectory, output)], resourceDirectory);
}

/** Pandoc knows no Mermaid, so the page draws each diagram as a PNG: 96 pixels to the inch. */
const PIXELS_PER_INCH = 96;

/**
 * Run `write(prepare)` with the page's PNGs of the mermaid diagrams in a temporary folder. `prepare`
 * makes a piece of exported Markdown ready for Pandoc: each mermaid fence becomes its picture, at the
 * width the fence asks for or else its own size, and each tag gets its color. A fence the page sent no picture for stays a code block, with a warning.
 */
async function withPictures(pictures, tags, warnings, write) {
  const bySource = new Map(pictures.map((p) => [p.source, p]));
  const dir = pictures.length ? fs.mkdtempSync(path.join(os.tmpdir(), 'webwriter-mermaid-')) : null;
  const written = new Map();
  let missing = 0;
  const pictureFor = ({ source, width }) => {
    const picture = bySource.get(source);
    if (!picture) {
      missing += 1;
      return null;
    }
    if (!written.has(source)) {
      const file = path.join(dir, `diagram-${written.size + 1}.png`);
      fs.writeFileSync(file, Buffer.from(picture.png, 'base64'));
      written.set(source, file);
    }
    return `![](<${written.get(source)}>){width=${width || `${(picture.width / PIXELS_PER_INCH).toFixed(2)}in`}}`;
  };
  try {
    return await write((markdown) => resolveTagColors(replaceMermaid(markdown, pictureFor), tags));
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (missing) warnings.push(`${missing} Mermaid diagram${missing === 1 ? '' : 's'} could not be drawn and ${missing === 1 ? 'is' : 'are'} shown as code.`);
  }
}

/**
 * One Word file for each front-matter piece and each chapter, written into `directory`.
 * `tags` are the colors from tags.json, so each tag is shaded in its color. `pictures` are the
 * page's PNGs of the mermaid diagrams, [{ source, png, width, height }].
 */
export async function writeChapters(book, directory, date = new Date(), tags = {}, pictures = []) {
  const exported = wordFiles(book.nodes);
  const names = [];
  await withPictures(pictures, tags, exported.warnings, async (prepare) => {
    for (const file of exported.files) {
      const name = date ? timestamped(file.name, date) : file.name;
      await docx(prepare(file.markdown), path.join(directory, name), book.root);
      names.push(name);
    }
  });
  return { files: names, warnings: exported.warnings };
}

/** The whole manuscript as one Word file at `file`. */
export async function writeBook(book, file, tags = {}, pictures = []) {
  const exported = exportBook(book.nodes);
  await withPictures(pictures, tags, exported.warnings, (prepare) => docx(prepare(exported.markdown), file, book.root));
  return { file, warnings: exported.warnings };
}
