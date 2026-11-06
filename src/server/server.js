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
import { loadComments, saveComments } from './commentfile.js';
import { placePicture, storeUpload, isPicture } from './pictures.js';
import { writeChapters } from './pandoc.js';
import { Preferences } from './prefs.js';
import { FolderWatcher, relevantChange } from './watcher.js';
import { exportBook } from '../../shared/export.js';
import { walk } from '../../shared/tree.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const STATIC = {
  '/js/': path.join(appRoot, 'public', 'js'),
  '/shared/': path.join(appRoot, 'shared'),
  '/vendor/codemirror/': path.join(appRoot, 'node_modules', 'codemirror'),
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

export function createServer({ book = null, prefs = new Preferences(), remember = true, quitWhenClosed = true, log = () => {} } = {}) {
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
        if (manuscript || comments) broadcast({ type: 'changed', manuscript, comments });
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
      home: os.homedir(), platform: process.platform, sep: path.sep,
    }),
    'POST /api/open': ({ body }) => ({ root: open(body.path) }),
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
    'GET /api/browse': ({ query }) => browse(query.get('path') || state.root || os.homedir(), query.get('files')),
    'POST /api/mkdir': ({ body }) => {
      const dir = path.resolve(String(body.path || ''));
      fsu.makeDirectory(dir);
      return { path: dir };
    },
    'POST /api/picture/place': ({ body }) => ({ path: placePicture(path.resolve(String(body.source || '')), requireBook()) }),
    'POST /api/picture/upload': ({ query, raw }) => ({ path: storeUpload(query.get('name') || 'picture', raw, requireBook()) }),
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
      return writeChapters(book, dir, new Date());
    },
  };

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
    res.write(`data: ${JSON.stringify({ type: 'hello', root: state.root })}\n\n`);
    state.clients.add(res);
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
