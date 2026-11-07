// The Webwriter server: the book folder's file operations as a small JSON API, the browser app
// as static files, and a stream of change notices so the page follows edits made by other programs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fsu from './fsutil.js';
import {
  loadBook, saveNode, saveTitle, createNode, moveNode, trashNode, emptyTrash, nodeFilePath, fileMatches,
} from './bookstore.js';
import { serializeSection } from './header.js';
import { BOOK_FILE, serializeBookFile } from './bookfile.js';
import { loadComments, saveComments } from './commentfile.js';
import { placePicture, storeUpload, isPicture, uniqueName, PICTURE_DIR } from './pictures.js';
import { slugify } from './naming.js';
import { writeChapters, writeBook } from './pandoc.js';
import { Preferences } from './prefs.js';
import { FolderWatcher, relevantChange } from './watcher.js';
import { exportBook } from '../../shared/export.js';
import { walk, isTrash } from '../../shared/tree.js';
import { INDEX_BODY } from '../../shared/bookindex.js';
import { TAGS_FILE, decodeTags, encodeTags } from '../../shared/tags.js';

/** The book's tag colors. A book without tags.json has none; one that cannot be read throws. */
function loadTags(root) {
  const text = fsu.tryReadText(path.join(root, TAGS_FILE));
  return text == null ? {} : decodeTags(text);
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** A new book's guide for AI agents to its files, written as AGENTS.md in the book folder. */
const AGENTS_TEMPLATE = path.join(here, 'new-book-agents.md');
export const AGENTS_FILE = 'AGENTS.md';
const appRoot = path.resolve(here, '..', '..');
const STATIC = {
  '/js/': path.join(appRoot, 'public', 'js'),
  '/shared/': path.join(appRoot, 'shared'),
  '/vendor/codemirror/': path.join(appRoot, 'node_modules', 'codemirror'),
  '/vendor/mermaid/': path.join(appRoot, 'node_modules', 'mermaid', 'dist'),
  '/drawio/': path.join(appRoot, 'vendor', 'drawio'),
};
const PAGES = {
  '/': path.join(appRoot, 'public', 'index.html'),
  '/index.html': path.join(appRoot, 'public', 'index.html'),
  '/print.html': path.join(appRoot, 'public', 'print.html'),
  '/app.css': path.join(appRoot, 'public', 'app.css'),
  '/favicon.svg': path.join(appRoot, 'public', 'favicon.svg'),
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.heic': 'image/heic', '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** A node as the page sees it: its place on disk, header, body, and children. */
function serializeNode(node) {
  return {
    kind: node.kind, header: node.header, body: node.body, prefix: node.prefix, slug: node.slug,
    dir: node.dir, entryName: node.entryName, file: nodeFilePath(node), children: node.children.map(serializeNode),
  };
}

/**
 * draw.io in embed mode: the copy `npm run fetch-drawio` puts in vendor/drawio, served from Webwriter's
 * own address, or else draw.io's site. `--drawio-url` or WEBWRITER_DRAWIO_URL names another.
 */
export const DEFAULT_DRAWIO_URL = fs.existsSync(path.join(appRoot, 'vendor', 'drawio', 'index.html'))
  ? '/drawio/index.html'
  : 'https://embed.diagrams.net/';

export function createServer({
  book = null, prefs = new Preferences(), remember = true, quitWhenClosed = true, log = () => {},
  drawioURL = process.env.WEBWRITER_DRAWIO_URL || DEFAULT_DRAWIO_URL,
} = {}) {
  // A new id for every start. A window that reconnects to a different one reloads, so it never runs old code.
  const bootID = Math.random().toString(36).slice(2);
  const state = { root: null, watcher: null, clients: new Set(), quitTimer: null, everConnected: false };

  function open(folder, { rememberIt = remember } = {}) {
    const root = path.resolve(folder.replace(/^~(?=$|\/)/, os.homedir()));
    if (!fsu.isDirectory(root)) throw new HttpError(400, `${root} is not a folder.`);
    loadBook(root); // Creates the manuscript and trash when missing, and converts book.yaml.
    state.watcher?.stop();
    state.root = root;
    try {
      state.watcher = new FolderWatcher(root, (paths) => {
        const kinds = paths.map(relevantChange);
        const manuscript = kinds.some((k) => k.manuscript);
        const comments = kinds.some((k) => k.comments);
        const tags = kinds.some((k) => k.tags);
        const pictures = kinds.some((k) => k.pictures);
        if (manuscript || comments || tags || pictures) broadcast({ type: 'changed', manuscript, comments, tags, pictures });
      });
    } catch (error) {
      log(`Cannot watch ${root}: ${error.message}`);
      state.watcher = null;
    }
    if (rememberIt) prefs.rememberBook(root);
    broadcast({ type: 'opened', root });
    return root;
  }

  function requireBook() {
    if (!state.root) throw new HttpError(409, 'No book is open.');
    return state.root;
  }

  /** A path the page sent, which must lie inside the open book's manuscript. */
  function manuscriptPath(file) {
    const root = requireBook();
    const resolved = path.resolve(String(file || ''));
    if (!fsu.isInside(path.join(root, 'manuscript'), resolved) || !resolved.endsWith('.md')) {
      throw new HttpError(400, 'That file is not part of the book.');
    }
    return resolved;
  }

  function broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of state.clients) client.write(data);
  }

  const api = {
    'GET /api/state': () => ({
      book: state.root, recent: prefs.recentBooks, author: prefs.reviewAuthor, color: prefs.reviewColor,
      home: os.homedir(), platform: process.platform, sep: path.sep, drawioURL,
    }),
    'POST /api/open': ({ body }) => ({ root: open(body.path) }),
    /** A new book: a folder named after the book in `parent`, with the title in book.json. */
    'POST /api/book/new': ({ body }) => {
      const title = String(body.title || '').trim();
      if (!title) throw new HttpError(400, 'A book needs a name.');
      if (/[\\/]/.test(title) || title === '.' || title === '..' || title.startsWith('.')) {
        throw new HttpError(400, 'A book name cannot contain / or \\, or start with a dot.');
      }
      const parent = path.resolve(String(body.parent || ''));
      if (!fsu.isDirectory(parent)) throw new HttpError(400, `${parent} is not a folder.`);
      const root = path.join(parent, title);
      if (fsu.exists(root) && (!fsu.isDirectory(root) || fsu.readDir(root).length > 0)) {
        throw new HttpError(400, `${root} already exists. Choose another name, or open it with Open Book.`);
      }
      fsu.makeDirectory(root);
      fsu.writeText(path.join(root, BOOK_FILE), serializeBookFile(title));
      fsu.writeText(path.join(root, AGENTS_FILE), fsu.readText(AGENTS_TEMPLATE));
      return { root: open(root) };
    },
    'POST /api/recent/clear': () => {
      prefs.clearRecent();
      return { ok: true };
    },
    'POST /api/prefs': ({ body }) => {
      prefs.update({ reviewAuthor: body.author, reviewColor: body.color });
      return { author: prefs.reviewAuthor, color: prefs.reviewColor };
    },
    'GET /api/book': () => {
      const loaded = loadBook(requireBook());
      return { root: loaded.root, title: loaded.title, warnings: loaded.warnings, nodes: loaded.nodes.map(serializeNode) };
    },
    /** Save one node. The file must still be what the page last read, or nothing is written. */
    'POST /api/node/save': ({ body }) => {
      const file = manuscriptPath(body.file);
      if (body.force) {
        fsu.makeDirectory(path.dirname(file));
        const text = serializeSection(body.header, body.body);
        if (fsu.tryReadText(file) !== text) fsu.writeText(file, text);
        return { result: 'saved' };
      }
      if (body.expected && !fileMatches(file, body.expected.header, body.expected.body)) return { conflict: true };
      const kind = path.basename(file) === '_index.md' ? 'group' : 'section';
      const node = kind === 'group'
        ? { kind, dir: path.dirname(path.dirname(file)), entryName: path.basename(path.dirname(file)), header: body.expected?.header ?? body.header }
        : { kind, dir: path.dirname(file), entryName: path.basename(file), header: body.expected?.header ?? body.header };
      return { result: saveNode(node, body.header, body.body) };
    },
    'POST /api/title': ({ body }) => {
      const loaded = loadBook(requireBook());
      return { result: saveTitle(loaded, String(body.title ?? '')) };
    },
    'POST /api/create': ({ body }) => {
      const root = requireBook();
      const title = String(body.title || '').trim();
      if (!title) throw new HttpError(400, 'A title is needed.');
      const kind = body.kind === 'group' ? 'group' : 'section';
      const placement = body.placement || { type: 'inParent', id: null };
      let book = loadBook(root);
      if (body.kind === 'index') {
        // An index goes first in the book, so that it lists every piece. It can be dragged elsewhere.
        const first = book.nodes.find((n) => !isTrash(n));
        const id = createNode(book, null, 'section', title, INDEX_BODY);
        if (first) moveNode(loadBook(root), id, first.header.id, 'before');
        return { id };
      }
      if (placement.type === 'below') {
        const found = walkFind(book, placement.id);
        const parent = found?.ancestors[found.ancestors.length - 1]?.header.id ?? null;
        const id = createNode(book, parent, kind, title);
        book = loadBook(root);
        moveNode(book, id, placement.id, 'after');
        return { id };
      }
      return { id: createNode(book, placement.id ?? null, kind, title) };
    },
    'POST /api/move': ({ body }) => {
      const book = loadBook(requireBook());
      return { moved: moveNode(book, body.movingID, body.targetID, body.zone) };
    },
    'POST /api/trash': ({ body }) => {
      const book = loadBook(requireBook());
      return { moved: trashNode(book, body.id) };
    },
    'POST /api/empty-trash': () => {
      const book = loadBook(requireBook());
      return { deleted: emptyTrash(book) };
    },
    'GET /api/comments': () => {
      const root = requireBook();
      try {
        return { comments: loadComments(root) };
      } catch (error) {
        return { error: error.message };
      }
    },
    'PUT /api/comments': ({ body }) => {
      saveComments(requireBook(), Array.isArray(body.comments) ? body.comments : []);
      return { ok: true };
    },
    'GET /api/tags': () => {
      try {
        return { tags: loadTags(requireBook()) };
      } catch (error) {
        return { error: error.message };
      }
    },
    /** Set or clear one tag's color. tags.json is read again first, and never written over when unreadable. */
    'POST /api/tags/color': ({ body }) => {
      const root = requireBook();
      let tags;
      try {
        tags = loadTags(root);
      } catch (error) {
        throw new HttpError(409, `The tag colors in ${TAGS_FILE} cannot be read, so Webwriter leaves the file as it is. ${error.message}`);
      }
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (!name) throw new HttpError(400, 'A tag name is needed.');
      if (body.color) tags[name] = String(body.color);
      else delete tags[name];
      const file = path.join(root, TAGS_FILE);
      if (Object.keys(tags).length === 0) fsu.remove(file);
      else {
        const text = encodeTags(Object.fromEntries(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))));
        decodeTags(text);
        if (fsu.tryReadText(file) !== text) fsu.writeText(file, text);
      }
      return { tags };
    },
    /** Notes and errors from the page, written to the server's output, where they can be looked up. */
    'POST /api/note': ({ body }) => {
      log(`[page] ${String(body.message || '').slice(0, 2000)}`);
      return { ok: true };
    },
    'GET /api/browse': ({ query }) => browse(query.get('path') || state.root || os.homedir(), query.get('files')),
    'POST /api/mkdir': ({ body }) => {
      const dir = path.resolve(String(body.path || ''));
      fsu.makeDirectory(dir);
      return { path: dir };
    },
    'POST /api/picture/place': ({ body }) => ({ path: placePicture(path.resolve(String(body.source || '')), requireBook()) }),
    'POST /api/picture/upload': ({ query, raw }) => ({ path: storeUpload(query.get('name') || 'picture', raw, requireBook()) }),
    /** A free name for a new diagram, `images/<slug>.drawio.svg`. Nothing is written until it is saved. */
    'POST /api/diagram/new': ({ body }) => {
      const root = requireBook();
      const images = path.join(root, PICTURE_DIR);
      const taken = new Set(fsu.isDirectory(images) ? fsu.readDir(images).map((e) => e.name) : []);
      const stem = slugify(String(body.name || 'diagram'));
      let name = `${stem}.drawio.svg`;
      for (let n = 2; taken.has(name); n += 1) name = `${stem}-${n}.drawio.svg`;
      return { path: `${PICTURE_DIR}/${name}` };
    },
    /** Write a diagram saved in draw.io: an SVG under images/, written atomically. */
    'POST /api/diagram/write': ({ query, raw }) => {
      const root = requireBook();
      const relative = String(query.get('path') || '');
      const file = path.resolve(root, relative);
      const images = path.join(root, PICTURE_DIR);
      if (relative.split('/').includes('..') || !fsu.isInside(images, file) || !file.toLowerCase().endsWith('.svg')) {
        throw new HttpError(400, 'A diagram is saved as an .svg file in the images folder.');
      }
      const text = raw.toString('utf8');
      if (!/<svg[\s>]/.test(text)) throw new HttpError(400, 'The diagram did not arrive as an SVG.');
      fsu.makeDirectory(path.dirname(file));
      if (fsu.tryReadText(file) !== text) fsu.writeText(file, text);
      return { path: relative };
    },
    'POST /api/export/manuscript': ({ body }) => {
      const book = loadBook(requireBook());
      const file = path.resolve(String(body.file || ''));
      const exported = exportBook(book.nodes);
      const text = exported.markdown.endsWith('\n') ? exported.markdown : exported.markdown + '\n';
      fsu.writeText(file, text);
      return { file, warnings: exported.warnings };
    },
    'POST /api/export/word': async ({ body }) => {
      const book = loadBook(requireBook());
      const dir = path.resolve(String(body.dir || ''));
      if (!fsu.isDirectory(dir)) throw new HttpError(400, `${dir} is not a folder.`);
      let tags = {};
      try {
        tags = loadTags(book.root);
      } catch {
        // Tags are drawn in their automatic colors.
      }
      return writeChapters(book, dir, new Date(), tags, mermaidPictures(body.mermaid));
    },
    'POST /api/export/word-book': async ({ body }) => {
      const book = loadBook(requireBook());
      const file = path.resolve(String(body.file || ''));
      if (!fsu.isDirectory(path.dirname(file))) throw new HttpError(400, `${path.dirname(file)} is not a folder.`);
      let tags = {};
      try {
        tags = loadTags(book.root);
      } catch {
        // Tags are drawn in their automatic colors.
      }
      return writeBook(book, file, tags, mermaidPictures(body.mermaid));
    },
  };

  /** The PNGs the page made of the book's mermaid diagrams for Word: [{ source, png, width, height }]. */
  function mermaidPictures(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p && typeof p.source === 'string' && typeof p.png === 'string'
      && Number.isFinite(p.width) && p.width > 0 && Number.isFinite(p.height) && p.height > 0);
  }

  function walkFind(book, id) {
    let found = null;
    walk(book.nodes, (node, ancestors) => {
      if (!found && node.header.id === id) found = { node, ancestors };
    });
    return found;
  }

  function browse(folder, files) {
    const dir = path.resolve(String(folder).replace(/^~(?=$|\/)/, os.homedir()));
    if (!fsu.isDirectory(dir)) throw new HttpError(400, `${dir} is not a folder.`);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, isDirectory: fsu.isDirectory(path.join(dir, e.name)) }))
        .filter((e) => e.isDirectory || (files === 'pictures' && isPicture(e.name)) || files === 'all')
        .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDirectory ? -1 : 1));
    } catch (error) {
      throw new HttpError(403, `${dir} cannot be read. ${error.message}`);
    }
    const parent = path.dirname(dir);
    return {
      path: dir, parent: parent === dir ? null : parent, home: os.homedir(), book: state.root,
      isBook: fsu.isDirectory(path.join(dir, 'manuscript')) || fsu.exists(path.join(dir, 'book.json')),
      entries,
    };
  }

  function serveFile(res, file, extraHeaders = {}) {
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        ...extraHeaders,
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  function staticFile(pathname) {
    if (PAGES[pathname]) return PAGES[pathname];
    for (const [prefix, dir] of Object.entries(STATIC)) {
      if (!pathname.startsWith(prefix)) continue;
      const file = path.resolve(dir, '.' + pathname.slice(prefix.length - 1));
      return fsu.isInside(dir, file) ? file : null;
    }
    return null;
  }

  function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    state.clients.add(res);
    res.write(`data: ${JSON.stringify({ type: 'hello', root: state.root, boot: bootID, windows: state.clients.size })}\n\n`);
    state.everConnected = true;
    clearTimeout(state.quitTimer);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      state.clients.delete(res);
      // Closing the last window quits the application. A reload reconnects well within the grace period.
      if (quitWhenClosed && state.clients.size === 0) {
        state.quitTimer = setTimeout(() => {
          if (state.clients.size === 0) {
            log('The last Webwriter window was closed. Quitting.');
            server.close();
            state.watcher?.stop();
            process.exit(0);
          }
        }, 8000);
      }
    });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function sendJSON(res, status, value) {
    const text = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
  }

  /** Only pages served by this server may talk to it: the host must be local, and changes carry a custom header. */
  function trusted(req) {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return false;
    if (req.method !== 'GET' && req.headers['x-webwriter'] !== '1') return false;
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!trusted(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    if (pathname === '/api/events') return events(req, res);
    const handler = api[`${req.method} ${pathname}`];
    if (handler) {
      try {
        const raw = req.method === 'GET' ? Buffer.alloc(0) : await readBody(req);
        let body = {};
        if (raw.length && (req.headers['content-type'] || '').includes('application/json')) body = JSON.parse(raw.toString('utf8'));
        sendJSON(res, 200, await handler({ body, raw, query: url.searchParams }));
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message });
      }
      return;
    }
    if (pathname.startsWith('/book-file/') && req.method === 'GET') {
      // Pictures, with paths counted from the book folder. Nothing outside the book is served.
      if (!state.root) return sendJSON(res, 404, { error: 'No book is open.' });
      const relative = pathname.slice('/book-file/'.length);
      const file = path.resolve(state.root, relative);
      if (relative.split('/').includes('..') || !fsu.isInside(state.root, file)) return sendJSON(res, 403, { error: 'Outside the book.' });
      return serveFile(res, file);
    }
    const file = req.method === 'GET' ? staticFile(pathname) : null;
    if (file) return serveFile(res, file);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  // Closing the server stops watching the book, so nothing keeps the process alive.
  server.on('close', () => {
    state.watcher?.stop();
    clearTimeout(state.quitTimer);
  });

  if (book) open(book);
  else if (prefs.lastBook && fsu.isDirectory(prefs.lastBook)) {
    try {
      open(prefs.lastBook, { rememberIt: false });
    } catch (error) {
      log(`Could not reopen ${prefs.lastBook}: ${error.message}`);
    }
  }

  return { server, open, state };
}
