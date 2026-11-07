// The open book and everything the window shows about it. A port of Bookwriter's BookModel.
// The server reads and writes the folder; this model holds the editor buffer and decides what to save.
import { api, report } from './api.js';
import {
  find, walk, isTrash, isGroup, manuscript, manuscriptInOrder, countWords, wordCount, TRASH_ID,
} from '/shared/tree.js';
import { planMove } from '/shared/moves.js';
import { applyMarkup, latestLanguage, changedSpan, Finder, expandTemplate } from '/shared/markup.js';
import {
  shiftRange, trimRange, reanchor, reanchorLoose, mergeComments, placedOutside, repaired, sameComments, highlight,
  newCommentID, wholeSeconds,
} from '/shared/comments.js';
import { exportChapter, fileTitle, timestamped } from '/shared/export.js';
import { TABLE_COMMANDS, editTable, findTable, leaveTable } from '/shared/table.js';
import { tagsIn, tagColor, normalizeTag, tagMarkup, cleanTagName, colorValue } from '/shared/tags.js';
import { diagramInSVG } from './diagram.js';

/** Windows open on one server before saving may stall: each holds one of the browser's six connections. */
const TOO_MANY_WINDOWS = 4;

const clone = (value) => structuredClone(value);

function sameHeader(a, b) {
  return a.id === b.id && a.title === b.title && a.synopsis === b.synopsis && a.status === b.status
    && a.role === b.role && (a.unit ?? null) === (b.unit ?? null) && (a.pageBreak ?? null) === (b.pageBreak ?? null);
}

/** Whether two loads of the book have the same title, pieces, places on disk, headers, and bodies. */
function sameContent(a, b) {
  const same = (x, y) => x.length === y.length && x.every((n, i) => {
    const m = y[i];
    return n.kind === m.kind && n.dir === m.dir && n.entryName === m.entryName && sameHeader(n.header, m.header)
      && n.body === m.body && same(n.children, m.children);
  });
  return a.title === b.title && same(a.nodes, b.nodes);
}

const effectiveUnitOf = (node) => {
  const { unit, pageBreak } = node.header;
  if (unit) return unit;
  if (pageBreak === false) return 'text';
  if (pageBreak === true) return 'section';
  return node.kind === 'group' ? 'section' : 'text';
};

export class BookModel {
  constructor(ui) {
    this.ui = ui;
    this.listeners = new Set();
    this.queue = Promise.resolve();

    this.book = null;
    this.selection = { kind: 'book' };
    this.openNodeID = null;
    this.buffer = '';
    this.dirty = false;
    this.showsMarkup = true;
    this.bookTitle = '';
    this.diskConflict = null;
    this.recent = [];

    this.comments = [];
    this.diskComments = [];
    this.commentsDirty = false;
    this.commentsWritable = true;
    this.commentsRetry = null;
    this.showsComments = true;
    this.reviewColor = null;
    this.reviewAuthor = '';
    this.commentsPanelVisible = false;
    this.focusedCommentID = null;
    this.reviewSelection = null;
    this.pendingSelection = null;

    /** Bumped when a picture changes on disk, so the views load it again. */
    this.pictureVersion = 0;
    this.drawioURL = 'https://embed.diagrams.net/';
    /** Tag colors from tags.json, by tag name. */
    this.tags = {};

    this.findVisible = false;
    this.find = { query: '', replacement: '', options: { matchCase: false, regex: false, wholeWord: false, wholeBook: false } };
    this.exportingWord = false;
    this.editor = null;
    this.saveTimer = null;
    this.previewTimer = null;
  }

  // MARK: Plumbing

  on(listener) {
    this.listeners.add(listener);
  }

  /** Tell the views what changed: tree, selection, buffer, preview, comments, conflict, ui. */
  emit(...flags) {
    const set = new Set(flags);
    for (const listener of this.listeners) listener(set, this);
  }

  /** Disk work runs one piece at a time, in order, like the main thread of a native app. */
  serial(work) {
    const run = this.queue.then(work).catch((error) => this.ui.alert(error.message || String(error)));
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  // MARK: Opening

  async start() {
    const state = await api.get('/api/state');
    this.recent = state.recent;
    this.reviewAuthor = state.author;
    this.reviewColor = state.color;
    this.home = state.home;
    this.drawioURL = state.drawioURL || this.drawioURL;
    if (state.book) await this.serial(() => this.loadOpened());
    this.emit('tree', 'selection', 'ui', 'comments');
    this.listen();
  }

  /** Follow changes other programs make in the book folder. */
  listen() {
    const source = new EventSource('/api/events');
    let connectedBefore = false;
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === 'hello') {
        // Webwriter was started again, perhaps with new code: save what is typed and load the page again.
        if (this.boot && event.boot !== this.boot) {
          report('page: Webwriter was started again, reloading');
          this.reloadForNewServer();
          return;
        }
        this.boot = event.boot;
        // Each window holds a connection, and a browser opens at most six to one server. At six, saving and moving stall.
        if (event.windows >= TOO_MANY_WINDOWS) {
          this.ui.toast(`${event.windows} Webwriter windows are open. Close all but one, or saving and moving pieces may stop working.`);
        }
        // After a lost connection, changes may have been missed.
        if (connectedBefore && this.book) this.diskDidChange({ manuscript: true, comments: true, tags: true, pictures: true });
        connectedBefore = true;
      } else if (event.type === 'changed') {
        this.diskDidChange(event);
      } else if (event.type === 'opened' && this.book?.root !== event.root) {
        this.serial(() => this.loadOpened());
      }
    };
  }

  /** Save the typing and reload, unless a conflict waits for the writer, who then reloads by hand. */
  async reloadForNewServer() {
    if (this.diskConflict) {
      this.ui.toast('Webwriter was started again. Choose a version in the bar above, then reload this window.');
      return;
    }
    await this.save();
    location.reload();
  }

  async openBook(path) {
    if (!(await this.resolveConflictFirst())) return;
    await this.serial(async () => {
      await this.flush();
      await this.commitBookTitleNow();
      await api.post('/api/open', { path });
      await this.loadOpened();
    });
  }

  async loadOpened() {
    const loaded = await api.get('/api/book');
    this.book = loaded;
    this.bookTitle = loaded.title;
    clearTimeout(this.commentsRetry);
    this.commentsRetry = null;
    this.diskConflict = null;
    this.dirty = false;
    this.editor?.forgetAll();
    await this.loadComments();
    await this.loadTags();
    this.selection = { kind: 'book' };
    this.openNodeID = null;
    this.buffer = '';
    const state = await api.get('/api/state');
    this.recent = state.recent;
    document.title = loaded.title;
    this.emit('tree', 'selection', 'buffer', 'preview', 'comments', 'conflict', 'ui');
    await this.saveComments();
  }

  /** Read the book from disk again. Unsaved typing is thrown away. */
  refresh() {
    return this.serial(async () => {
      if (!this.book) return;
      clearTimeout(this.saveTimer);
      this.dirty = false;
      this.diskConflict = null;
      const keep = this.selection;
      this.book = await api.get('/api/book');
      this.bookTitle = this.book.title;
      this.commentsDirty = false;
      this.editor?.forgetAll();
      await this.loadComments();
      await this.loadTags();
      if (keep.kind === 'node' && this.findNode(keep.id)) this.select(keep, false);
      else this.select({ kind: 'book' }, false);
      this.emit('tree', 'conflict', 'comments');
    });
  }

  async clearRecent() {
    await api.post('/api/recent/clear');
    this.recent = [];
    this.emit('ui');
  }

  // MARK: Selection

  findNode(id) {
    return this.book ? find(this.book.nodes, id)?.node ?? null : null;
  }

  findWithAncestors(id) {
    return this.book ? find(this.book.nodes, id) : null;
  }

  get selectedNode() {
    return this.selection.kind === 'node' ? this.findWithAncestors(this.selection.id) : null;
  }

  get openNode() {
    return this.openNodeID ? this.findNode(this.openNodeID) : null;
  }

  /** Select a row. Unsaved typing and a changed book title are saved first. */
  selectRow(next) {
    return this.serial(async () => {
      await this.flush();
      await this.commitBookTitleNow();
      this.select(next, false);
    });
  }

  select(next, _saving) {
    this.selection = next;
    this.reviewSelection = null;
    const node = next.kind === 'node' ? this.findNode(next.id) : null;
    if (node) {
      this.openNodeID = next.id;
      // A text in conflict opens with the writer's version, still unsaved.
      const mine = this.diskConflict?.nodeID === next.id ? this.diskConflict.mine : null;
      this.buffer = mine ?? node.body;
      this.dirty = mine != null;
    } else {
      this.openNodeID = null;
      this.buffer = '';
    }
    this.emit('selection', 'buffer', 'preview', 'comments', 'conflict');
  }

  // MARK: Editing

  bufferDidChange(text, { shifted = false } = {}) {
    const id = this.openNodeID;
    if (id == null || text === this.buffer) return;
    if (!shifted && this.comments.some((c) => c.nodeID === id)) {
      const span = changedSpan(this.buffer, text);
      this.shiftComments(id, span.start, span.length, span.insert.length);
    }
    this.buffer = text;
    this.dirty = true;
    if (this.diskConflict?.nodeID === id) this.diskConflict.mine = text;
    this.schedulePreview();
    this.scheduleSave();
    this.emit('words');
  }

  /** Redraw the preview shortly after typing pauses. */
  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.emit('preview', 'comments'), 120);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.serial(() => this.flush()), 600);
  }

  /** Save now: File → Save, leaving the window, quitting. */
  save() {
    return this.serial(async () => {
      await this.flush();
      await this.commitBookTitleNow();
    });
  }

  /** Write the open buffer if it changed. Runs inside the queue. */
  async flush() {
    clearTimeout(this.saveTimer);
    await this.saveComments();
    let node = this.openNode;
    if (!this.dirty || !node || this.diskConflict?.nodeID === node.header.id) return;
    let result = await this.writeNode(node, node.header, this.buffer);
    if (result.conflict) {
      // Another program changed the file and the watcher has not said so yet. Its change is read first.
      await this.reloadIfChangedOutside();
      if (this.diskConflict?.nodeID === node.header.id) return;
      node = this.openNode;
      if (!node) return;
      result = await this.writeNode(node, node.header, this.buffer);
      if (result.conflict) return;
    }
    this.dirty = false;
    if (result.result === 'saved') this.emit('tree');
  }

  /** Write a node's file, provided it still holds what was last read or written. */
  async writeNode(node, header, body) {
    const kept = { ...header, id: node.header.id };
    const result = await api.post('/api/node/save', {
      file: node.file, expected: { header: node.header, body: node.body }, header: kept, body,
    });
    if (!result.conflict) {
      node.header = kept;
      node.body = body;
    }
    return result;
  }

  /** The body a node has right now, counting unsaved text in the editor. */
  liveBody(node) {
    return node.header.id === this.openNodeID ? this.buffer : node.body;
  }

  liveBodyOf(id) {
    const node = this.findNode(id);
    return node ? this.liveBody(node) : '';
  }

  liveWordCount(node) {
    return wordCount(node, (n) => this.liveBody(n));
  }

  bookWordCount() {
    return this.book ? manuscript(this.book.nodes).reduce((sum, n) => sum + this.liveWordCount(n), 0) : 0;
  }

  /**
   * Save a change made in the header form. Like every form save, it writes `unit` and drops a
   * legacy `break`. Nothing is written when the form changed nothing.
   */
  updateHeader(id, change) {
    return this.serial(async () => {
      const node = this.findNode(id);
      if (!node) return;
      const header = { ...node.header };
      change(header);
      if (sameHeader(header, node.header)) return;
      if (this.diskConflict?.nodeID === id) {
        this.ui.alert('This text was changed on disk. Choose which version to keep before changing its details.');
        return;
      }
      if (!header.unit) header.unit = effectiveUnitOf(node);
      header.pageBreak = null;
      const result = await this.writeNode(node, header, this.liveBody(node));
      if (result.conflict) {
        await this.reloadIfChangedOutside();
        const fresh = this.findNode(id);
        if (!fresh || this.diskConflict?.nodeID === id) return;
        const again = { ...fresh.header };
        change(again);
        if (!again.unit) again.unit = effectiveUnitOf(fresh);
        again.pageBreak = null;
        if ((await this.writeNode(fresh, again, this.liveBody(fresh))).conflict) return;
      }
      if (id === this.openNodeID) this.dirty = false;
      this.emit('tree', 'preview', 'comments');
    });
  }

  setBookTitle(title) {
    this.bookTitle = title;
  }

  commitBookTitle() {
    return this.serial(() => this.commitBookTitleNow());
  }

  async commitBookTitleNow() {
    if (!this.book || this.bookTitle === this.book.title) return;
    await api.post('/api/title', { title: this.bookTitle });
    this.book.title = this.bookTitle;
    document.title = this.bookTitle || 'Webwriter';
    this.emit('tree');
  }

  // MARK: Tree changes

  /** Where a new piece goes: inside the selected folder, beside the selected text, or at the top level. */
  requestCreation(kind, placement = null) {
    if (!this.book) return;
    if (!placement) {
      let parent = null;
      const selected = this.selectedNode;
      if (selected && !isTrash(selected.node) && !selected.ancestors.some(isTrash)) {
        parent = isGroup(selected.node) ? selected.node.header.id : selected.ancestors[selected.ancestors.length - 1]?.header.id ?? null;
      }
      placement = { type: 'inParent', id: parent };
    }
    this.ui.askTitle(kind).then((title) => {
      if (title != null) this.create(kind, placement, title);
    });
  }

  create(kind, placement, title) {
    const trimmed = title.trim();
    if (!trimmed) return Promise.resolve();
    return this.serial(async () => {
      await this.flush();
      const { id } = await api.post('/api/create', { kind, title: trimmed, placement });
      await this.reload(id);
    });
  }

  canMove(movingID, targetID, zone) {
    return Boolean(this.book) && planMove(this.book.nodes, movingID, targetID, zone).length > 0;
  }

  move(movingID, targetID, zone) {
    return this.serial(async () => {
      await this.flush();
      await api.post('/api/move', { movingID, targetID, zone });
      await this.reload(movingID);
    });
  }

  moveToTrash(id) {
    return this.serial(async () => {
      await this.flush();
      await api.post('/api/trash', { id });
      await this.reload(null);
    });
  }

  get trashIsEmpty() {
    const trash = this.book?.nodes.find(isTrash);
    return !trash || trash.children.length === 0;
  }

  /** Asks first, since emptying the trash deletes files. */
  async emptyTrash() {
    if (!this.book || this.trashIsEmpty) return;
    const ok = await this.ui.confirm({
      title: 'Empty the trash?',
      message: 'The pieces in the trash are deleted from the book folder. This cannot be undone.',
      action: 'Empty Trash',
      destructive: true,
    });
    if (!ok) return;
    await this.serial(async () => {
      await this.flush();
      await api.post('/api/empty-trash');
      await this.reload(TRASH_ID);
    });
  }

  /** Read the book again after a tree change, and select `id`. */
  async reload(id) {
    if (!this.book) return;
    this.book = await api.get('/api/book');
    // Emptying the trash deletes pieces. Their comments go with them.
    if (this.comments.some((c) => !this.findNode(c.nodeID))) {
      this.comments = this.comments.filter((c) => this.findNode(c.nodeID));
      this.commentsDirty = true;
      await this.saveComments();
    }
    this.emit('tree');
    if (id && this.findNode(id)) this.select({ kind: 'node', id }, false);
    else this.select({ kind: 'book' }, false);
  }

  // MARK: Markup commands

  async apply(command) {
    if (!this.editor || !this.book || this.openNodeID == null) return;
    if (command === 'tag') return this.requestTag();
    if (command === 'diagram') return this.insertDiagram();
    if (command === 'tagColors') return this.ui.showTagColors();
    if (TABLE_COMMANDS.some((c) => c.id === command)) {
      if (!this.tableCommand(command) && command !== 'insertTable' && !this.cursorInTable()) this.ui.beep();
      return;
    }
    let picturePath = '';
    if (command === 'picture') {
      picturePath = await this.ui.choosePicture(this.book.root);
      if (!picturePath) return;
    }
    let language = '';
    if (command === 'codeBlock') {
      // The most recent fenced block anywhere in the book, the trash included.
      const bodies = [];
      walk(this.book.nodes, (node) => bodies.push(this.liveBody(node)));
      language = latestLanguage(bodies);
    }
    if (!this.showsMarkup) this.setShowsMarkup(true);
    const { anchor, head } = this.editor.selection;
    this.editor.replace(applyMarkup(command, this.buffer, anchor, head, { language, picturePath }));
  }

  // MARK: Diagrams

  /** Pictures changed on disk: the views load them again. */
  picturesChanged() {
    this.pictureVersion += 1;
    this.emit('pictures');
  }

  /** Draw a new diagram in draw.io. Its first save writes images/<name>.drawio.svg and puts it at the cursor. */
  async insertDiagram() {
    if (!this.editor || this.openNodeID == null || !this.book) return;
    const name = await this.ui.askDiagramName();
    report(`diagram: name ${JSON.stringify(name)}`);
    if (!name || !name.trim()) return;
    let path;
    try {
      ({ path } = await api.post('/api/diagram/new', { name: name.trim() }));
    } catch (error) {
      // Such as a window loaded before Webwriter was updated and started again.
      this.ui.alert('The new diagram could not be started.', `${error.message}\n\nIf Webwriter was just started again, reload this window and try again.`);
      return;
    }
    const nodeID = this.openNodeID;
    const { anchor, head } = this.editor.selection;
    let inserted = false;
    await this.ui.editDiagram({
      xml: null,
      title: name.trim(),
      save: async (svg) => {
        await this.writeDiagram(path, svg);
        if (inserted || this.openNodeID !== nodeID) return;
        inserted = true;
        if (!this.showsMarkup) this.setShowsMarkup(true);
        this.editor.replace(applyMarkup('picture', this.editor.cm.getValue(), anchor, head, { picturePath: path }));
      },
    });
  }

  /** Edit the diagram at a book-relative path in draw.io, saving back to the same file. */
  async editDiagramAt(path) {
    const url = `/book-file/${path.split('/').map(encodeURIComponent).join('/')}?v=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' }).catch((error) => ({ ok: false, statusText: error.message }));
    if (!response.ok) return this.ui.alert(`${path} could not be read.`, response.statusText || '');
    const xml = diagramInSVG(await response.text());
    if (!xml) {
      return this.ui.alert(`${path} has no draw.io diagram inside it.`, 'Diagrams saved from draw.io as an editable SVG (.drawio.svg) can be edited here.');
    }
    await this.ui.editDiagram({ xml, title: path.split('/').pop(), save: (svg) => this.writeDiagram(path, svg) });
  }

  async writeDiagram(path, svg) {
    await api.upload(`/api/diagram/write?path=${encodeURIComponent(path)}`, new Blob([svg], { type: 'image/svg+xml' }));
    this.picturesChanged();
  }

  // MARK: Tags

  /** Read the tag colors. A tags.json that cannot be read leaves every tag in its automatic color. */
  async loadTags() {
    const response = await api.get('/api/tags');
    if (response.error != null) {
      if (!this.tagsUnreadable) this.ui.alert(`The tag colors in tags.json could not be read, so tags are shown in their automatic colors and the file is left as it is. ${response.error}`);
      this.tagsUnreadable = true;
      this.tags = {};
    } else {
      this.tagsUnreadable = false;
      this.tags = response.tags;
    }
    this.emit('tags');
  }

  /** The color a tag is drawn in now, as #RRGGBB. */
  tagColorOf(name) {
    return tagColor(name, this.tags);
  }

  /** Every tag in the book, the trash included, with how often it is used: [{ key, name, count, color }]. */
  allTags() {
    const found = new Map();
    if (!this.book) return [];
    walk(this.book.nodes, (node) => {
      for (const tag of tagsIn(this.liveBody(node))) {
        const key = normalizeTag(tag.name);
        const entry = found.get(key) || { key, name: tag.name.trim(), count: 0 };
        entry.count += 1;
        found.set(key, entry);
      }
    });
    for (const key of Object.keys(this.tags)) if (!found.has(key)) found.set(key, { key, name: key, count: 0 });
    return [...found.values()]
      .map((t) => ({ ...t, color: this.tags[t.key] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Give a tag a color in tags.json, or with null its automatic one again. */
  setTagColor(name, color) {
    return this.serial(async () => {
      try {
        const { tags } = await api.post('/api/tags/color', { name, color });
        this.tags = tags;
        this.emit('tags');
      } catch (error) {
        this.ui.alert(error.message);
      }
    });
  }

  /** Ask for a tag and put it at the cursor. Selected text becomes the tag's name. */
  async requestTag() {
    if (!this.editor || this.openNodeID == null) return;
    const { start, end } = this.editor.selection;
    const selected = cleanTagName(this.buffer.slice(start, end));
    const answer = await this.ui.askTag({ name: selected, tags: this.allTags(), colorOf: (n) => this.tagColorOf(n) });
    if (!answer) return;
    this.insertTag(answer.name, answer.color);
  }

  /** `[name]{.tag}` in place of the selection. The chosen color is recorded in tags.json when it is not there yet. */
  insertTag(name, color) {
    const clean = cleanTagName(name);
    if (!clean || !this.editor) return;
    if (!this.showsMarkup) this.setShowsMarkup(true);
    const { start, end } = this.editor.selection;
    const markup = tagMarkup(clean);
    this.editor.replace({
      text: this.buffer.slice(0, start) + markup + this.buffer.slice(end),
      anchor: start + markup.length, head: start + markup.length,
    });
    if (color && colorValue(this.tags[normalizeTag(clean)]) !== colorValue(color)) this.setTagColor(clean, color);
  }

  // MARK: Tables

  /** Whether the editor's cursor is in a pipe table of the open text. */
  cursorInTable() {
    if (!this.editor || this.openNodeID == null) return false;
    return findTable(this.buffer, this.editor.selection.head) != null;
  }

  /**
   * A table command at the editor's cursor: Tab, Shift+Tab, and Enter in a table, and the table
   * commands. Returns false when the cursor is not in a table, so the key can do what it usually does.
   */
  tableCommand(command) {
    if (!this.editor || this.openNodeID == null) return false;
    const text = this.editor.cm.getValue();
    const { head } = this.editor.selection;
    const result = command === 'nextRow'
      ? leaveTable(text, head) ?? editTable('nextRow', text, head)
      : editTable(command, text, head);
    if (!result) {
      if (command === 'insertTable' || findTable(text, head)) this.ui.beep();
      return false;
    }
    if (!this.showsMarkup) this.setShowsMarkup(true);
    const table = result.start != null ? findTable(text, head) : null;
    const kept = table ? this.commentsIn(this.openNodeID, text, table.start, table.end) : [];
    this.editor.replace(result);
    // Inside a key handler the buffer catches up only after it returns, so the editor's text is used.
    this.reanchorComments(kept, this.openNodeID, this.editor.cm.getValue());
    return true;
  }

  /**
   * A table command on a cell of a rendered table: `offset` is any body offset inside the table and
   * `at` names the cell. The edit goes through the view, so the view can undo it.
   */
  async tableCommandAt(command, nodeID, offset, at, view) {
    const body = this.liveBodyOf(nodeID);
    const result = editTable(command, body, offset, at);
    if (!result) return this.ui.beep();
    const kept = this.commentsIn(nodeID, body, result.start, result.end);
    await view.splice({ nodeID, start: result.start, length: result.end - result.start },
      result.text.slice(result.start, result.start + result.length));
    this.reanchorComments(kept, nodeID);
  }

  /** Comments inside [start, end) of a body, each with the text it covers there. */
  commentsIn(nodeID, body, start, end) {
    return this.comments.filter((c) => c.nodeID === nodeID && c.start >= start && c.start + c.length <= end)
      .map((c) => ({ comment: c, quote: c.length > 0 ? body.substr(c.start, c.length) : c.quote }));
  }

  /** Lining up a table moves every cell, so the comments in it find their words again. */
  reanchorComments(kept, nodeID, body = this.liveBodyOf(nodeID)) {
    if (!kept.length) return;
    for (const { comment, quote } of kept) {
      comment.quote = quote;
      const found = reanchorLoose(comment, body);
      Object.assign(comment, trimRange(found, body));
      comment.quote = body.substr(comment.start, comment.length) || found.quote;
    }
    this.commentsDirty = true;
    this.emit('comments');
    this.serial(() => this.saveComments());
  }

  // MARK: Typing in the rendered views

  /**
   * Write an edit made in the preview or a reading view into the body it belongs to.
   * Returns { kind: 'refused' | 'editor' | 'saved', previous }.
   */
  async splice(edit) {
    const node = this.findNode(edit.nodeID);
    if (!node) return { kind: 'refused' };
    const body = this.liveBody(node);
    if (edit.start < 0 || edit.start + edit.length > body.length) return { kind: 'refused' };
    const previous = body.slice(edit.start, edit.start + edit.length);
    if (edit.nodeID === this.openNodeID) {
      // The open text takes the edit through the editor, which keeps its undo history.
      this.editor.replaceRange(edit.start, edit.length, edit.text);
      this.emit('preview', 'comments');
      return { kind: 'editor', previous };
    }
    if (this.diskConflict?.nodeID === edit.nodeID) return { kind: 'refused' };
    return this.serial(async () => {
      const next = body.slice(0, edit.start) + edit.text + body.slice(edit.start + edit.length);
      const result = await this.writeNode(node, node.header, next);
      if (result.conflict) {
        await this.reloadIfChangedOutside();
        return { kind: 'refused' };
      }
      this.shiftComments(edit.nodeID, edit.start, edit.length, edit.text.length);
      await this.saveComments();
      this.emit('tree', 'preview', 'comments');
      return { kind: 'saved', previous };
    }).then((r) => r ?? { kind: 'refused' });
  }

  editorUndo() {
    this.editor?.cm.undo();
  }

  editorRedo() {
    this.editor?.cm.redo();
  }

  // MARK: Review comments

  commentsOn(nodeID) {
    return nodeID == null ? [] : this.comments.filter((c) => c.nodeID === nodeID);
  }

  /** The comments grouped by the piece they are on, in outline order, each group in text order. */
  commentsByNode() {
    if (!this.book) return [];
    const out = [];
    walk(this.book.nodes, (node) => {
      const mine = this.comments.filter((c) => c.nodeID === node.header.id).sort((a, b) => a.start - b.start);
      if (mine.length) out.push({ node, comments: mine });
    });
    return out;
  }

  /** Open the commented piece in the editor and select the commented text. */
  async revealComment(id) {
    const comment = this.comments.find((c) => c.id === id);
    if (!comment || !this.findNode(comment.nodeID)) return;
    this.focusedCommentID = id;
    // The color bar shows the chosen comment's color, and the selection below shows in it.
    this.setReviewColor(highlight(comment), false);
    if (!this.showsMarkup) this.setShowsMarkup(true);
    if (this.selection.kind !== 'node' || this.selection.id !== comment.nodeID) await this.selectRow({ kind: 'node', id: comment.nodeID });
    const length = this.buffer.length;
    const start = Math.min(comment.start, length);
    this.pendingSelection = { start, length: Math.min(comment.length, length - start) };
    this.editor?.sync();
    this.previewFollow(this.lineNumber(start, this.buffer));
    this.emit('comments');
  }

  /** The editor and the rendered views report their selection here. An empty one is null. */
  selectionDidChange(selection) {
    const next = selection && selection.length > 0 ? selection : null;
    this.reviewSelection = next;
    // Selecting other text ends the choice of a comment, so the color bar is for new comments again.
    if (next && this.focusedCommentID) {
      const comment = this.comments.find((c) => c.id === this.focusedCommentID);
      if (comment && !(next.nodeID === comment.nodeID && next.start === comment.start && next.length === comment.length)) {
        this.focusedCommentID = null;
        this.emit('comments');
      }
    }
    this.emit('reviewSelection');
  }

  setReviewColor(color, remember = true) {
    this.reviewColor = color;
    if (remember) api.post('/api/prefs', { color }).catch(() => {});
    this.emit('color');
  }

  /**
   * A color chosen in the color bar: the chosen comment takes it, and so do new comments.
   * Null, the chosen color clicked again, clears it for new comments and leaves the chosen comment's.
   */
  chooseColor(color) {
    this.setReviewColor(color);
    const comment = this.comments.find((c) => c.id === this.focusedCommentID);
    if (!color || !comment || highlight(comment) === color) return;
    comment.color = color;
    this.commentsDirty = true;
    this.emit('comments');
    this.serial(() => this.saveComments());
  }

  /** Ask for a comment on the selected text. */
  async requestComment() {
    // A new comment is not a change to the chosen one.
    this.focusedCommentID = null;
    const selected = this.reviewSelection;
    const node = selected ? this.findNode(selected.nodeID) : null;
    if (!selected || !node) {
      this.ui.beep();
      return;
    }
    const body = this.liveBody(node);
    if (selected.start + selected.length > body.length) return;
    const range = trimRange({ start: selected.start, length: selected.length }, body);
    const draft = { nodeID: selected.nodeID, start: range.start, length: range.length, quote: body.substr(range.start, range.length) };
    this.emit('comments');
    const answer = await this.ui.askComment(draft, { author: this.reviewAuthor, color: this.reviewColor });
    if (answer) this.addComment(draft, answer);
  }

  addComment(draft, { text, author, color }) {
    text = text.trim();
    author = author.trim();
    if (!text) return;
    if (author) this.reviewAuthor = author;
    api.post('/api/prefs', { author: author || undefined, color }).catch(() => {});
    this.reviewColor = color;
    this.comments.push({
      id: newCommentID(), nodeID: draft.nodeID, start: draft.start, length: draft.length, quote: draft.quote,
      author: author || this.reviewAuthor,
      // Whole seconds, as the file stores them, so a comment read back is equal to this one.
      date: wholeSeconds(new Date()),
      text, color,
    });
    this.commentsDirty = true;
    this.emit('comments', 'color');
    this.serial(() => this.saveComments());
  }

  deleteComment(id) {
    if (!this.comments.some((c) => c.id === id)) return;
    this.comments = this.comments.filter((c) => c.id !== id);
    if (this.focusedCommentID === id) this.focusedCommentID = null;
    this.commentsDirty = true;
    this.emit('comments');
    this.serial(() => this.saveComments());
  }

  setShowsComments(value) {
    this.showsComments = value;
    this.emit('comments', 'preview', 'ui');
  }

  setCommentsPanel(value) {
    this.commentsPanelVisible = value;
    this.emit('ui');
  }

  setShowsMarkup(value) {
    this.showsMarkup = value;
    this.emit('selection', 'preview', 'comments', 'ui');
  }

  /** Read the book's comments and put each back on its text. */
  async loadComments() {
    let trimmed = false;
    const response = await api.get('/api/comments');
    if (response.error != null) {
      this.comments = [];
      this.diskComments = [];
      this.commentsWritable = false;
      this.ui.alert(`The review comments in comments.json could not be read, so they are not shown and the file is left as it is. ${response.error}`);
      this.commentsDirty = false;
      return;
    }
    const stored = response.comments;
    this.diskComments = clone(stored);
    const fixed = repaired(stored);
    if (!sameComments(fixed, stored)) trimmed = true;
    this.comments = fixed.map((comment) => {
      const placed = { ...comment };
      const node = this.findNode(comment.nodeID);
      if (node) {
        Object.assign(placed, reanchor(comment, node.body));
        // Comments made before marks were trimmed from the edges are trimmed now.
        const range = trimRange(placed, node.body);
        if (range.start !== placed.start || range.length !== placed.length) {
          Object.assign(placed, range);
          placed.quote = node.body.substr(range.start, range.length);
          trimmed = true;
        }
        if (placed.start !== comment.start || placed.length !== comment.length) trimmed = true;
      }
      return placed;
    });
    this.commentsWritable = true;
    this.commentsDirty = trimmed;
  }

  /** Keep a section's comments on their text through one edit of its body. */
  shiftComments(nodeID, start, length, inserted) {
    for (const comment of this.comments) {
      if (comment.nodeID !== nodeID) continue;
      Object.assign(comment, shiftRange(comment, start, length, inserted));
      this.commentsDirty = true;
    }
  }

  /** Write the comments if they changed, each with the text it now covers as its quote. Runs inside the queue. */
  async saveComments() {
    if (!this.commentsDirty || !this.commentsWritable || !this.book) return;
    // Another program may have written the file since it was read. Its changes are kept.
    // A file that is there but cannot be read may be halfway through being written: writing
    // over it would lose what the other program writes, so the changes here wait.
    const theirs = await api.get('/api/comments');
    if (theirs.error != null) {
      this.waitForReadableComments();
      return;
    }
    this.commentsDirty = false;
    if (!sameComments(theirs.comments, this.diskComments)) this.takeOutsideComments(theirs.comments);
    for (const comment of this.comments) {
      const node = this.findNode(comment.nodeID);
      if (comment.length <= 0 || !node) continue;
      const body = this.liveBody(node);
      if (comment.start + comment.length <= body.length) comment.quote = body.substr(comment.start, comment.length);
    }
    try {
      await api.put('/api/comments', { comments: this.comments });
      this.diskComments = clone(this.comments);
    } catch (error) {
      this.ui.alert(error.message);
    }
  }

  // MARK: Changes made by other programs

  /** Files changed in the book folder: Webwriter's own saves, or another program such as an agent. */
  diskDidChange(event) {
    if (!this.book) return;
    this.serial(async () => {
      if (event.manuscript) await this.reloadIfChangedOutside();
      if (event.comments) await this.mergeCommentsFromDisk();
      if (event.tags) await this.loadTags();
      if (event.pictures) this.picturesChanged();
    });
  }

  /**
   * Read the manuscript again when another program changed it. The open text with unsaved typing
   * is never replaced: when its file changed too, a conflict is recorded and the writer chooses.
   */
  async reloadIfChangedOutside() {
    if (!this.book) return;
    const fresh = await api.get('/api/book');
    if (fresh.root !== this.book.root || sameContent(fresh, this.book)) return;
    const old = this.book;
    const changed = new Set();
    walk(fresh.nodes, (node) => {
      if (find(old.nodes, node.header.id)?.node.body !== node.body) changed.add(node.header.id);
    });
    const typing = this.dirty ? this.openNodeID : null;
    if (typing && this.diskConflict?.nodeID !== typing) {
      const saved = find(old.nodes, typing)?.node;
      const onDisk = find(fresh.nodes, typing)?.node;
      if (saved && (!onDisk || onDisk.body !== saved.body)) {
        clearTimeout(this.saveTimer);
        this.diskConflict = {
          nodeID: typing, title: saved.header.title, mine: this.buffer, onDisk: onDisk?.body ?? null,
          file: saved.file, header: saved.header,
        };
      }
    }
    if (this.diskConflict) this.diskConflict.onDisk = find(fresh.nodes, this.diskConflict.nodeID)?.node.body ?? null;
    // An undo history would undo into text that is no longer there. The text being typed keeps its own.
    for (const id of changed) if (id !== typing) this.editor?.forget(id);
    const keep = this.selection;
    this.book = fresh;
    this.bookTitle = fresh.title;
    document.title = fresh.title;
    this.emit('tree', 'conflict');
    if (typing && this.findNode(typing)) {
      // The editor keeps the typed text. The other views draw again.
      this.emit('preview', 'comments');
    } else if (keep.kind === 'node' && this.findNode(keep.id)) {
      this.select(keep, false);
    } else {
      this.select({ kind: 'book' }, false);
    }
    // Comments on changed text find it again. Those on the text being typed stay on it.
    for (const comment of this.comments) {
      if (!changed.has(comment.nodeID) || comment.nodeID === typing) continue;
      const node = this.findNode(comment.nodeID);
      if (!node) continue;
      const range = reanchor(comment, node.body);
      if (range.start !== comment.start || range.length !== comment.length) {
        Object.assign(comment, range);
        this.commentsDirty = true;
      }
    }
    this.emit('comments');
    await this.saveComments();
  }

  /** Write the writer's version over the one on disk. A deleted text is written again where it was. */
  keepMyVersion() {
    return this.serial(async () => {
      const conflict = this.diskConflict;
      if (!conflict || !this.book) return;
      this.diskConflict = null;
      const node = this.findNode(conflict.nodeID);
      if (node) {
        await api.post('/api/node/save', { file: node.file, force: true, header: node.header, body: conflict.mine });
        node.body = conflict.mine;
        if (this.openNodeID === conflict.nodeID) this.dirty = false;
        this.emit('tree', 'preview', 'conflict');
      } else {
        await api.post('/api/node/save', { file: conflict.file, force: true, header: conflict.header, body: conflict.mine });
        this.dirty = false;
        await this.reload(conflict.nodeID);
        this.emit('conflict');
      }
      await this.saveComments();
    });
  }

  /** Drop the writer's version and take the one on disk. */
  useDiskVersion() {
    return this.serial(async () => {
      const conflict = this.diskConflict;
      if (!conflict || !this.book) return;
      this.diskConflict = null;
      const node = this.findNode(conflict.nodeID);
      if (!node) {
        this.editor?.forget(conflict.nodeID);
        if (this.openNodeID === conflict.nodeID) {
          this.dirty = false;
          this.select({ kind: 'book' }, false);
        }
        this.emit('conflict');
        return;
      }
      // The comments were on the writer's version. Each finds its text again in the one on disk.
      const mine = conflict.mine;
      for (const comment of this.comments) {
        if (comment.nodeID !== conflict.nodeID) continue;
        if (comment.length > 0 && comment.start + comment.length <= mine.length) comment.quote = mine.substr(comment.start, comment.length);
        Object.assign(comment, trimRange(reanchor(comment, node.body), node.body));
        this.commentsDirty = true;
      }
      if (this.openNodeID === conflict.nodeID) {
        this.dirty = false;
        this.buffer = node.body;
        this.editor?.sync();
        this.editor?.forget(conflict.nodeID);
      }
      this.emit('buffer', 'preview', 'comments', 'conflict');
      await this.saveComments();
    });
  }

  /** Before quitting or opening another book with a conflict: keep a version, or stay. */
  async resolveConflictFirst() {
    const conflict = this.diskConflict;
    if (!conflict) return true;
    const choice = await this.ui.choose({
      title: `“${conflict.title}” was changed on disk by another program.`,
      message: 'You also have unsaved changes to it. Which version should be kept?',
      buttons: ['Keep My Version', 'Use Version on Disk', 'Cancel'],
    });
    if (choice === 0) await this.keepMyVersion();
    else if (choice === 1) await this.useDiskVersion();
    else return false;
    return true;
  }

  /** Take in what another program changed in comments.json. Runs inside the queue. */
  async mergeCommentsFromDisk() {
    if (!this.book) return;
    const theirs = await api.get('/api/comments');
    if (theirs.error != null) {
      this.waitForReadableComments();
      return;
    }
    // Readable again, such as after the writer fixed a file that could not be read.
    this.commentsWritable = true;
    if (sameComments(theirs.comments, this.diskComments)) {
      await this.saveComments();
      return;
    }
    this.takeOutsideComments(theirs.comments);
    // Changes made here and not yet saved go into the file with the other program's.
    if (!sameComments(this.comments, theirs.comments)) this.commentsDirty = true;
    await this.saveComments();
  }

  /** Try comments.json again for a few seconds. When it stays unreadable, leave it alone. */
  waitForReadableComments() {
    if (this.commentsRetry || !this.book) return;
    const root = this.book.root;
    let tries = 0;
    const attempt = async () => {
      if (this.book?.root !== root) {
        this.commentsRetry = null;
        return;
      }
      tries += 1;
      const response = await api.get('/api/comments').catch(() => ({ error: 'unreachable' }));
      if (response.error == null) {
        this.commentsRetry = null;
        this.serial(() => this.mergeCommentsFromDisk());
        return;
      }
      if (tries < 20) {
        this.commentsRetry = setTimeout(attempt, 250);
        return;
      }
      this.commentsRetry = null;
      if (this.commentsWritable) {
        this.commentsWritable = false;
        this.ui.alert('The review comments in comments.json cannot be read, so Webwriter leaves the file as it is. Comment changes are kept and saved once the file can be read again.');
      }
    };
    this.commentsRetry = setTimeout(attempt, 250);
  }

  takeOutsideComments(theirs) {
    const placed = placedOutside(this.diskComments, theirs);
    this.comments = mergeComments(this.diskComments, this.comments, repaired(theirs)).map((comment) => {
      // A comment placed outside may give only its quote. It goes on that text in the body.
      const node = this.findNode(comment.nodeID);
      if (!placed.has(comment.id) || !node) return comment;
      const body = this.liveBody(node);
      return { ...comment, ...trimRange(reanchor(comment, body), body) };
    });
    this.diskComments = clone(theirs);
    if (this.focusedCommentID && !this.comments.some((c) => c.id === this.focusedCommentID)) this.focusedCommentID = null;
    this.emit('comments');
  }

  // MARK: Preview

  /** The preview scrolls to the block that holds this body line. */
  previewFollow(line) {
    this.ui.previewFollow?.(this.openNodeID, line);
  }

  /** Clicking a note link in the preview moves the editor caret to the matching Markdown. */
  revealNote(anchor) {
    if (!this.editor) return;
    const parts = anchor.split(':');
    if (parts.length < 3) return;
    const [kind, nodeID] = parts;
    const label = parts.slice(2).join(':');
    if (nodeID !== this.openNodeID || label.startsWith('__inline_')) return;
    const needle = kind === 'note' ? `[^${label}]:` : `[^${label}]`;
    const text = this.buffer;
    let at = text.indexOf(needle);
    if (kind === 'ref') {
      // Skip a definition line that happens to come first.
      while (at >= 0 && text[at + needle.length] === ':') at = text.indexOf(needle, at + needle.length);
    }
    if (at < 0) return;
    this.editor.select(at + needle.length, 0, true);
  }

  // MARK: Find

  findNext(backward = false) {
    return this.serial(async () => {
      const finder = this.book ? Finder.make(this.find.query, this.find.options) : null;
      if (!finder) return this.ui.beep();
      let parts;
      if (this.find.options.wholeBook) {
        parts = manuscriptInOrder(this.book.nodes).map((n) => ({ id: n.header.id, text: this.liveBody(n) }));
      } else if (this.openNode) {
        parts = [{ id: this.openNodeID, text: this.buffer }];
      } else {
        return this.ui.beep();
      }
      const range = this.editor && this.openNodeID ? this.editor.selection : { start: 0, end: 0 };
      const current = this.openNodeID ?? parts[0]?.id ?? '';
      const hit = backward ? finder.previous(parts, current, range.start) : finder.next(parts, current, range.end);
      if (!hit) return this.ui.beep();
      if (hit.id !== this.openNodeID) {
        if (!this.showsMarkup) this.showsMarkup = true;
        await this.flush();
        await this.commitBookTitleNow();
        this.select({ kind: 'node', id: hit.id }, false);
        this.emit('ui');
      }
      // The editor may not show the new text yet. It takes this selection when it does.
      this.pendingSelection = { start: hit.start, length: hit.length };
      this.editor?.sync();
      this.previewFollow(this.lineNumber(hit.start, this.buffer));
    });
  }

  takePendingSelection() {
    const pending = this.pendingSelection;
    this.pendingSelection = null;
    return pending;
  }

  replaceCurrent() {
    const finder = Finder.make(this.find.query, this.find.options);
    if (!this.editor || !finder || this.openNodeID == null) return;
    const { start, end } = this.editor.selection;
    if (finder.matches(this.buffer).some((m) => m.start === start && m.length === end - start)) {
      let replacement = this.find.replacement;
      if (this.find.options.regex) {
        // With Regexp the replacement may use capture groups such as `$1`.
        const re = new RegExp(finder.expression.source, finder.expression.flags.replace('g', '') + 'y');
        re.lastIndex = start;
        const m = re.exec(this.buffer);
        if (m) replacement = expandTemplate(this.find.replacement, m.groups ? [...m, m.index, this.buffer, m.groups] : [...m, m.index, this.buffer]);
      }
      this.editor.replaceRange(start, end - start, replacement);
    }
    this.findNext();
  }

  replaceAll() {
    const finder = Finder.make(this.find.query, this.find.options);
    if (!this.editor || !finder || this.openNodeID == null) return;
    const result = finder.replaceAll(this.buffer, this.find.replacement, this.find.options.regex);
    if (result.count === 0) this.ui.beep();
    else this.editor.replace({ text: result.text, anchor: 0, head: 0 });
  }

  lineNumber(offset, text) {
    let line = 0;
    const end = Math.min(Math.max(0, offset), text.length);
    for (let i = 0; i < end; i += 1) if (text.charCodeAt(i) === 10) line += 1;
    return line;
  }

  // MARK: Export

  exportName(title, ext, date = new Date()) {
    return timestamped(`${fileTitle(title)}.${ext}`, date);
  }

  async exportManuscript() {
    if (!this.book) return;
    const file = await this.ui.chooseSaveFile({ title: 'Export Manuscript', name: this.exportName(this.book.title, 'md'), dir: this.book.root });
    if (!file) return;
    await this.serial(async () => {
      await this.flush();
      const result = await api.post('/api/export/manuscript', { file });
      this.report(result.warnings, result.file);
    });
  }

  /** The whole book as PDF: the print view lays out the exported manuscript on Letter pages. */
  async exportPDF() {
    if (!this.book) return;
    await this.save();
    this.ui.printPDF({ name: this.exportName(this.book.title, 'pdf') });
  }

  async exportChapterPDF(id) {
    if (!this.book) return;
    const chapter = exportChapter(this.book.nodes, id);
    if (!chapter) return;
    await this.save();
    this.ui.printPDF({ chapter: id, name: timestamped(chapter.filename, new Date()) });
  }

  /** The whole book as one Word file. */
  async exportBookWord() {
    if (!this.book || this.exportingWord) return;
    const file = await this.ui.chooseSaveFile({ title: 'Export Word', name: this.exportName(this.book.title, 'docx'), dir: this.book.root });
    if (!file) return;
    await this.save();
    this.exportingWord = true;
    this.emit('ui');
    try {
      const result = await api.post('/api/export/word-book', { file });
      this.report(result.warnings, result.file);
    } catch (error) {
      this.ui.alert(`Word export failed: ${error.message}`);
    } finally {
      this.exportingWord = false;
      this.emit('ui');
    }
  }

  /** One Word file for each front-matter piece and each chapter, in a folder the writer chooses. */
  async exportWord() {
    if (!this.book || this.exportingWord) return;
    const dir = await this.ui.chooseFolder({
      title: 'Export Chapters to Word',
      message: 'Choose a folder for the Word files: one for each front-matter piece and each chapter.',
      action: 'Export',
      dir: this.book.root,
    });
    if (!dir) return;
    await this.save();
    this.exportingWord = true;
    this.emit('ui');
    try {
      const result = await api.post('/api/export/word', { dir });
      this.report(result.warnings, dir);
      if (result.files.length === 0) this.ui.alert('The book has no front matter and no chapters, so there is nothing to export to Word.');
      else this.ui.toast(`Wrote ${result.files.length} Word file${result.files.length === 1 ? '' : 's'} to ${dir}`);
    } catch (error) {
      this.ui.alert(`Word export failed: ${error.message}`);
    } finally {
      this.exportingWord = false;
      this.emit('ui');
    }
  }

  report(warnings, file) {
    const name = file.split(/[\\/]/).pop();
    if (!warnings.length) {
      this.ui.toast(`Wrote ${name}`);
      return;
    }
    this.ui.alert(`Wrote ${name} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`, warnings.slice(0, 12).join('\n'));
  }

  // MARK: Word counts and labels for the outline

  countWords(text) {
    return countWords(text);
  }
}
