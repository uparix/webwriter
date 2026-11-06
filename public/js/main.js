// The Webwriter window: menu bar, toolbar, outline and header form, editor and rendered views,
// and the comments panel. Everything the page shows comes from the model.
import { BookModel } from './model.js';
import { EditorController } from './editor.js';
import { RenderedView } from './rendered.js';
import { Outline } from './outline.js';
import { CommentsPanel, MarkerLayer } from './comments-ui.js';
import { renderBook, renderGroup, renderSection } from './render.js';
import {
  h, beep, sheet, alertSheet, confirmSheet, chooseSheet, titleSheet, commentSheet, browseSheet, paletteSheet,
  showReminder, showMenu, closeMenu, showPopover, toast, shortcutLabel, sheetIsOpen,
} from './dialogs.js';
import { api } from './api.js';
import { COMMANDS } from '/shared/markup.js';
import { TABLE_COMMANDS } from '/shared/table.js';
import { COLOR_HEX } from '/shared/comments.js';
import { divisions, isGroup, isTrash, manuscript, effectiveUnit, STATUSES, UNITS } from '/shared/tree.js';

const $ = (id) => document.getElementById(id);
const isMac = navigator.platform.toUpperCase().includes('MAC');

// MARK: The UI the model calls back into

const ui = {
  beep,
  alert: (title, detail) => alertSheet(title, detail),
  confirm: (options) => confirmSheet(options),
  choose: (options) => chooseSheet(options),
  askTitle: (kind) => titleSheet(kind),
  askComment: (draft, defaults) => commentSheet(draft, defaults),
  toast,
  async choosePicture(root) {
    const choice = await browseSheet({
      mode: 'picture', title: 'Insert Picture', message: "The picture is moved into the book's images folder.",
      action: 'Insert Picture', dir: root,
    });
    if (!choice) return null;
    try {
      if (choice.upload) {
        return (await api.upload(`/api/picture/upload?name=${encodeURIComponent(choice.upload.name)}`, choice.upload)).path;
      }
      return (await api.post('/api/picture/place', { source: choice.path })).path;
    } catch (error) {
      alertSheet(error.message);
      return null;
    }
  },
  chooseSaveFile: ({ title, name, dir }) => browseSheet({ mode: 'save', title, action: 'Save', dir, name }),
  chooseFolder: ({ title, message, action, dir }) => browseSheet({ mode: 'folder', title, message, action, dir }),
  printPDF({ chapter = null, name }) {
    const params = new URLSearchParams({ name });
    if (chapter) params.set('chapter', chapter);
    window.open(`/print.html?${params}`, '_blank', 'width=900,height=1000');
  },
  previewFollow(nodeID, line) {
    if (nodeID) rendered.followLine(nodeID, line);
  },
  /** Add Comment when text is selected, and the table commands when the cursor is in a table. */
  editorContextMenu(event) {
    const inTable = model.cursorInTable();
    if (!model.reviewSelection && !inTable) return;
    event.preventDefault();
    const items = [];
    if (model.reviewSelection) items.push({ label: 'Add Comment…', shortcut: '⌃⌘M', action: () => model.requestComment() }, '-');
    if (inTable) items.push(...tableItems((id) => model.apply(id), { insert: false }), '-');
    items.push({ label: 'Copy', enabled: Boolean(model.reviewSelection), action: () => document.execCommand('copy') });
    showMenu(items, event.clientX, event.clientY);
  },
  /** In a rendered table, the commands work on the cell that was right-clicked. */
  renderedContextMenu(event, view) {
    const cell = event.target.closest?.('td, th');
    const table = cell?.closest('table');
    const section = table?.closest('section[data-node]');
    const items = [];
    if (model.reviewSelection) items.push({ label: 'Add Comment…', shortcut: '⌃⌘M', action: () => model.requestComment() }, '-');
    if (cell && section) {
      const nodeID = section.dataset.node;
      const span = table.querySelector('span[data-o]');
      const offset = span ? Number(span.dataset.o) : lineOffset(model.liveBodyOf(nodeID), Number(table.dataset.line));
      const tr = cell.parentElement;
      const at = { row: tr.parentElement.tagName === 'THEAD' ? 0 : tr.sectionRowIndex + 1, column: cell.cellIndex };
      items.push(...tableItems((id) => model.tableCommandAt(id, nodeID, offset, at, view), { insert: false, format: false }), '-');
    }
    if (!items.length) return;
    event.preventDefault();
    items.push({ label: 'Copy', enabled: Boolean(model.reviewSelection), action: () => document.execCommand('copy') });
    showMenu(items, event.clientX, event.clientY);
  },
  markersChanged() {
    editorMarkers?.update();
  },
};

/** Where a body line starts, as an offset. */
function lineOffset(body, line) {
  let offset = 0;
  for (let i = 0; i < line && offset >= 0; i += 1) offset = body.indexOf('\n', offset) + 1;
  return Math.max(0, offset);
}

/** Menu items for the table commands, grouped. `run(id)` runs one. */
function tableItems(run, { insert = true, format = true } = {}) {
  const item = (id, enabled = () => true) => {
    const command = TABLE_COMMANDS.find((c) => c.id === id);
    return { label: command.name, enabled, action: () => run(id) };
  };
  const groups = [
    insert ? [item('insertTable')] : [],
    format ? [item('formatTable')] : [],
    ['rowAbove', 'rowBelow', 'columnLeft', 'columnRight'].map((id) => item(id)),
    ['deleteRow', 'deleteColumn'].map((id) => item(id)),
    ['alignLeft', 'alignCenter', 'alignRight', 'alignNone'].map((id) => item(id)),
  ].filter((g) => g.length);
  return groups.flatMap((g, i) => (i ? ['-', ...g] : g));
}

/** The table commands for the editor: Insert Table needs an open text, the rest a cursor in a table. */
function editorTableItems() {
  return tableItems((id) => model.apply(id)).map((it) => (it === '-' ? it : {
    ...it, enabled: it.label === 'Insert Table' ? has.node() : has.node() && model.cursorInTable(),
  }));
}

const model = new BookModel(ui);
window.webwriter = model;

// MARK: Building the window

const outline = new Outline($('outline'), model);
const editor = new EditorController($('editor'), model);
model.editor = editor;
const rendered = new RenderedView($('render-scroll'), $('rendered'), model, 'rendered');
const commentsPanel = new CommentsPanel($('comments-panel'), model);
const editorMarkers = new MarkerLayer(editor.cm.getScrollerElement(), model, () => editor.commentTops());
const renderedMarkers = new MarkerLayer($('render-scroll'), model, () => rendered.commentTops());
editor.cm.on('update', () => editorMarkers.update());
editor.cm.on('refresh', () => editorMarkers.update());

// MARK: Menus

const has = {
  book: () => Boolean(model.book),
  node: () => model.openNodeID != null && model.editor != null,
  query: () => model.find.query !== '',
};

const MENUS = [
  { label: 'File', items: [
    { label: 'New Text', shortcut: '⌥⌘N', keys: ['mod+alt+KeyN', 'mod+KeyN'], enabled: has.book, action: () => model.requestCreation('section') },
    { label: 'New Folder', shortcut: '⌥⇧⌘N', keys: ['mod+alt+shift+KeyN', 'mod+shift+KeyN'], enabled: has.book, action: () => model.requestCreation('group') },
    '-',
    { label: 'Open Book…', shortcut: '⌘O', keys: ['mod+KeyO'], action: () => openBookPanel() },
    { label: 'Open Recent', submenu: () => recentItems() },
    '-',
    { label: 'Refresh', shortcut: '⌘R', keys: ['mod+KeyR'], enabled: has.book, action: () => model.refresh() },
    { label: 'Empty Trash…', shortcut: '⇧⌘⌫', keys: ['mod+shift+Backspace'], enabled: () => has.book() && !model.trashIsEmpty, action: () => model.emptyTrash() },
    { label: 'Save', shortcut: '⌘S', keys: ['mod+KeyS'], enabled: has.book, action: () => model.save() },
    '-',
    { label: 'Export Manuscript…', shortcut: '⇧⌘E', keys: ['mod+shift+KeyE'], enabled: has.book, action: () => model.exportManuscript() },
    { label: 'Export PDF…', enabled: has.book, action: () => model.exportPDF() },
    { label: 'Export Chapters to Word…', enabled: () => has.book() && !model.exportingWord, action: () => model.exportWord() },
  ] },
  { label: 'Edit', items: [
    { label: 'Undo', shortcut: '⌘Z', enabled: has.node, action: () => editor.cm.undo() },
    { label: 'Redo', shortcut: '⇧⌘Z', enabled: has.node, action: () => editor.cm.redo() },
    '-',
    { label: 'Find…', shortcut: '⌘F', keys: ['mod+KeyF'], enabled: has.book, action: () => showFind() },
    { label: 'Find Next', shortcut: '⌘G', keys: ['mod+KeyG'], enabled: has.query, action: () => model.findNext() },
    { label: 'Find Previous', shortcut: '⇧⌘G', keys: ['mod+shift+KeyG'], enabled: has.query, action: () => model.findNext(true) },
  ] },
  { label: 'Markup', items: [
    ...COMMANDS.map((c) => ({
      label: c.name, shortcut: c.shortcut,
      keys: { emphasis: ['mod+KeyI'], strong: ['mod+KeyB'], inlineCode: ['mod+KeyE'] }[c.id],
      enabled: has.node, action: () => model.apply(c.id), editorOnly: true,
    })),
    '-',
    { label: 'Table', enabled: has.node, submenu: () => editorTableItems() },
    '-',
    { label: 'Command Palette…', shortcut: '⌘K', keys: ['mod+KeyK'], enabled: has.node, action: () => openPalette() },
  ] },
  { label: 'Review', items: [
    { label: 'Add Comment…', shortcut: '⌃⌘M', keys: [isMac ? 'ctrl+mod+KeyM' : 'ctrl+alt+KeyM'], enabled: () => model.reviewSelection != null, action: () => model.requestComment() },
    { label: 'Show Comments', checked: () => model.showsComments, enabled: has.book, action: () => model.setShowsComments(!model.showsComments) },
    { label: 'Comments Panel', shortcut: '⌥⌘0', keys: ['mod+alt+Digit0'], checked: () => model.commentsPanelVisible, enabled: has.book, action: () => model.setCommentsPanel(!model.commentsPanelVisible) },
  ] },
  { label: 'View', items: [
    { label: 'Show Markup', shortcut: '⇧⌘M', keys: ['mod+shift+KeyM'], checked: () => model.showsMarkup, enabled: has.book, action: () => model.setShowsMarkup(!model.showsMarkup) },
  ] },
  { label: 'Help', items: [
    { label: 'Markup Reminder', action: () => showReminder() },
  ] },
];

function recentItems() {
  const items = model.recent.map((path) => ({ label: path, action: () => model.openBook(path) }));
  return [...items, ...(items.length ? ['-'] : []), { label: 'Clear Menu', enabled: model.recent.length > 0, action: () => model.clearRecent() }];
}

function buildMenubar() {
  const bar = $('menubar');
  bar.textContent = '';
  for (const menu of MENUS) {
    const button = h('button', { class: 'menubar-item', text: menu.label });
    const open = () => {
      const rect = button.getBoundingClientRect();
      const items = menu.items.map((item) => (item === '-' ? item : { ...item, submenu: item.submenu?.() }));
      showMenu(items, rect.left, rect.bottom, { anchor: bar });
      bar.dataset.open = menu.label;
    };
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (bar.dataset.open === menu.label && document.querySelector('.menu')) {
        closeMenu();
        delete bar.dataset.open;
      } else open();
    });
    button.addEventListener('mouseenter', () => {
      if (bar.dataset.open && document.querySelector('.menu') && bar.dataset.open !== menu.label) open();
    });
    bar.append(button);
  }
  bar.append(h('span', { class: 'menubar-title', id: 'window-title' }));
}

/** A key event as `mod+shift+KeyN`, with `mod` the Command key on a Mac and Control elsewhere. */
function keyName(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const parts = [];
  if (isMac && e.ctrlKey) parts.push('ctrl');
  if (!isMac && e.ctrlKey && !mod) parts.push('ctrl');
  if (mod) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.code);
  return parts.join('+');
}

document.addEventListener('keydown', (e) => {
  if (sheetIsOpen()) return;
  const name = keyName(e);
  for (const menu of MENUS) {
    for (const item of menu.items) {
      if (item === '-' || !item.keys?.includes(name)) continue;
      e.preventDefault();
      e.stopPropagation();
      if (!item.enabled || item.enabled()) item.action();
      else beep();
      return;
    }
  }
}, true);

// MARK: Toolbar

function buildToolbar() {
  const title = $('book-title');
  title.addEventListener('input', () => model.setBookTitle(title.value));
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      model.commitBookTitle();
      title.blur();
    }
  });
  title.addEventListener('blur', () => model.commitBookTitle());
  $('add-button').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showMenu([
      { label: 'New Text', action: () => model.requestCreation('section') },
      { label: 'New Folder', action: () => model.requestCreation('group') },
      '-',
      { label: 'Add Comment…', enabled: model.reviewSelection != null, action: () => model.requestComment() },
    ], rect.left, rect.bottom + 4);
  });
  $('add-button').addEventListener('mousedown', (e) => e.preventDefault());
  $('markup-toggle').addEventListener('click', () => model.setShowsMarkup(!model.showsMarkup));
  $('comments-toggle').addEventListener('click', () => model.setCommentsPanel(!model.commentsPanelVisible));
  $('warnings-button').addEventListener('click', (e) => {
    showPopover(h('div', { class: 'warnings-popover' },
      h('h3', { text: `${model.book.warnings.length} Warning${model.book.warnings.length === 1 ? '' : 's'}` }),
      h('ul', {}, model.book.warnings.map((w) => h('li', { text: w })))), e.currentTarget);
  });
  $('open-book').addEventListener('click', () => openBookPanel());
}

function updateToolbar() {
  const title = $('book-title');
  if (document.activeElement !== title && title.value !== model.bookTitle) title.value = model.bookTitle;
  $('markup-toggle').classList.toggle('on', model.showsMarkup);
  $('comments-toggle').classList.toggle('on', model.commentsPanelVisible);
  const warnings = model.book?.warnings.length ?? 0;
  $('warnings-button').hidden = warnings === 0;
  $('warnings-count').textContent = `${warnings} Warning${warnings === 1 ? '' : 's'}`;
  $('window-title').textContent = model.book ? model.book.title : 'Webwriter';
  document.body.classList.toggle('no-book', !model.book);
  for (const id of ['book-title', 'add-button', 'markup-toggle', 'comments-toggle']) $(id).disabled = !model.book;
}

async function openBookPanel() {
  const path = await browseSheet({
    mode: 'book', title: 'Open Book',
    message: 'Choose a book folder. A folder with no manuscript becomes an empty book.',
    action: 'Open Book', dir: model.book?.root ?? model.home ?? '/',
  });
  if (path) model.openBook(path);
}

async function openPalette() {
  const command = await paletteSheet();
  if (command) model.apply(command);
}

// MARK: The header form

const form = {
  loadedID: null,
  loadedTitle: '',
  loadedSynopsis: '',
  timer: null,
};

function buildForm() {
  const title = $('form-title');
  const synopsis = $('form-synopsis');
  for (const status of STATUSES) $('form-status').append(h('option', { value: status, text: status[0].toUpperCase() + status.slice(1) }));
  for (const unit of UNITS) $('form-unit').append(h('option', { value: unit, text: unit[0].toUpperCase() + unit.slice(1) }));
  const schedule = () => {
    clearTimeout(form.timer);
    form.timer = setTimeout(commitForm, 500);
  };
  title.addEventListener('input', schedule);
  synopsis.addEventListener('input', schedule);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitForm();
    }
  });
  synopsis.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitForm();
    }
  });
  title.addEventListener('blur', commitForm);
  synopsis.addEventListener('blur', commitForm);
  // Pickers save at once.
  $('form-status').addEventListener('change', (e) => form.loadedID && model.updateHeader(form.loadedID, (hd) => { hd.status = e.target.value; }));
  $('form-role').addEventListener('change', (e) => form.loadedID && model.updateHeader(form.loadedID, (hd) => { hd.role = e.target.value; }));
  $('form-unit').addEventListener('change', (e) => form.loadedID && model.updateHeader(form.loadedID, (hd) => {
    hd.unit = e.target.value;
    hd.pageBreak = null;
  }));
}

/** Only text the writer changed is saved, and always to the node it was typed for. */
function commitForm() {
  clearTimeout(form.timer);
  const title = $('form-title').value;
  const synopsis = $('form-synopsis').value;
  if (!form.loadedID || (title === form.loadedTitle && synopsis === form.loadedSynopsis)) return;
  form.loadedTitle = title;
  form.loadedSynopsis = synopsis;
  model.updateHeader(form.loadedID, (hd) => {
    hd.title = title;
    hd.synopsis = synopsis.replaceAll('\n', ' ');
  });
}

function updateForm() {
  const selected = model.selectedNode;
  const node = selected && !isTrash(selected.node) ? selected.node : null;
  $('form').hidden = !node;
  $('sidebar').classList.toggle('with-form', Boolean(node));
  if (!node) {
    commitForm();
    form.loadedID = null;
    return;
  }
  if (form.loadedID !== node.header.id) commitForm();
  const title = $('form-title');
  const synopsis = $('form-synopsis');
  const typing = form.loadedID === node.header.id
    && (title.value !== form.loadedTitle || synopsis.value !== form.loadedSynopsis);
  if (!typing) {
    form.loadedID = node.header.id;
    form.loadedTitle = node.header.title;
    form.loadedSynopsis = node.header.synopsis;
    if (title.value !== node.header.title) title.value = node.header.title;
    if (synopsis.value !== node.header.synopsis) synopsis.value = node.header.synopsis;
  }
  $('form-status').value = node.header.status;
  $('form-role').value = node.header.role;
  $('form-unit').value = effectiveUnit(node);
}

// MARK: The markup bar

const TABLE_ICON = '<svg class="bar-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 6h13M1.5 9.75h13M6 6v7.5M10.5 6v7.5" stroke="currentColor" stroke-width="1.2"/><rect x="2.1" y="3.1" width="11.8" height="2.9" fill="currentColor" opacity=".35"/></svg>';

const BAR_GROUPS = [
  [['strong', '<b>B</b>'], ['emphasis', '<i>I</i>'], ['inlineCode', '<span class="mono">&lt;/&gt;</span>']],
  [['subsection', 'H1'], ['lowerSubsection', 'H2']],
  [['bullet', '•≡'], ['numbered', '1.'], ['quotation', '❝']],
  [['link', '🔗'], ['picture', '🖼'], ['codeBlock', '<span class="mono">{ }</span>'], ['footnote', 'x¹']],
  [['insertTable', TABLE_ICON], ['tableMenu', '▾']],
];

function buildMarkupBar() {
  const bar = $('markup-bar');
  const groups = BAR_GROUPS.map((group) => {
    const el = h('div', { class: 'bar-group' });
    for (const [id, label] of group) {
      if (id === 'insertTable' || id === 'tableMenu') {
        // A table in one click, and beside it a menu with the commands for the table under the cursor.
        const insert = TABLE_COMMANDS.find((c) => c.id === 'insertTable');
        const button = h('button', {
          class: `bar-button${id === 'tableMenu' ? ' bar-menu' : ''}`, 'data-command': id,
          title: id === 'insertTable' ? `${insert.name}\n${insert.inserts}` : 'Table commands\nRows, columns, and alignment of the table under the cursor',
        });
        button.innerHTML = label;
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => {
          if (id === 'insertTable') return model.apply('insertTable');
          const rect = button.getBoundingClientRect();
          showMenu(editorTableItems(), rect.left, rect.bottom + 2);
        });
        el.append(button);
        continue;
      }
      const command = COMMANDS.find((c) => c.id === id);
      const button = h('button', {
        class: 'bar-button', 'data-command': id,
        title: `${command.name}${command.shortcut ? ` (${shortcutLabel(command.shortcut)})` : ''}\n${command.inserts}`,
      });
      button.innerHTML = label;
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => model.apply(id));
      el.append(button);
    }
    return el;
  });
  const more = h('button', { class: 'bar-button more', title: 'More markup' }, '…');
  more.addEventListener('mousedown', (e) => e.preventDefault());
  more.addEventListener('click', () => {
    const hidden = groups.filter((g) => g.hidden);
    const items = [];
    hidden.forEach((g, index) => {
      if (index) items.push('-');
      for (const b of g.children) {
        const command = COMMANDS.find((c) => c.id === b.dataset.command);
        if (command) items.push({ label: command.name, enabled: has.node, action: () => model.apply(command.id) });
        else if (b.dataset.command === 'insertTable') items.push({ label: 'Insert Table', enabled: has.node, action: () => model.apply('insertTable') });
        else items.push({ label: 'Table', enabled: has.node, submenu: editorTableItems() });
      }
    });
    const rect = more.getBoundingClientRect();
    showMenu(items, rect.left, rect.bottom + 2);
  });
  groups.forEach((g, i) => {
    if (i) bar.append(h('span', { class: 'bar-divider' }));
    bar.append(g);
  });
  bar.append(more);
  // When the editor pane is too narrow for every button, the last groups move into the … menu.
  const fit = () => {
    for (const g of groups) g.hidden = false;
    for (const d of bar.querySelectorAll('.bar-divider')) d.hidden = false;
    more.hidden = true;
    const dividers = [...bar.querySelectorAll('.bar-divider')];
    for (let i = groups.length - 1; i > 0 && bar.scrollWidth > bar.clientWidth; i -= 1) {
      groups[i].hidden = true;
      dividers[i - 1].hidden = true;
      more.hidden = false;
    }
  };
  new ResizeObserver(fit).observe(bar);
}

function updateMarkupBar() {
  for (const b of $('markup-bar').querySelectorAll('.bar-button:not(.more)')) b.disabled = !has.node();
}

// MARK: The find bar

function buildFindBar() {
  const query = $('find-query');
  const replacement = $('find-replace');
  query.addEventListener('input', () => { model.find.query = query.value; });
  replacement.addEventListener('input', () => { model.find.replacement = replacement.value; });
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      model.findNext(e.shiftKey);
    }
    if (e.key === 'Escape') hideFind();
  });
  replacement.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideFind();
  });
  $('find-next').addEventListener('click', () => model.findNext());
  $('find-prev').addEventListener('click', () => model.findNext(true));
  $('find-done').addEventListener('click', hideFind);
  $('replace-one').addEventListener('click', () => model.replaceCurrent());
  $('replace-all').addEventListener('click', () => model.replaceAll());
  for (const [id, key] of [['find-case', 'matchCase'], ['find-regex', 'regex'], ['find-word', 'wholeWord'], ['find-book', 'wholeBook']]) {
    $(id).addEventListener('change', (e) => { model.find.options[key] = e.target.checked; });
  }
}

function showFind() {
  model.findVisible = true;
  $('find-bar').hidden = false;
  const query = $('find-query');
  const selected = editor.cm.getSelection();
  if (selected && !selected.includes('\n') && document.activeElement?.closest('.CodeMirror')) {
    query.value = selected;
    model.find.query = selected;
  }
  query.focus();
  query.select();
}

function hideFind() {
  model.findVisible = false;
  $('find-bar').hidden = true;
  editor.focus();
}

// MARK: The conflict bar and the trash bar

function updateConflictBar() {
  const bar = $('conflict-bar');
  const conflict = model.diskConflict;
  bar.hidden = !conflict;
  bar.textContent = '';
  if (!conflict) return;
  const gone = conflict.onDisk == null;
  const show = h('button', { text: 'Show Disk Version', disabled: gone });
  show.addEventListener('click', () => showPopover(h('pre', { class: 'disk-version', text: model.diskConflict?.onDisk ?? '' }), show));
  bar.append(
    h('span', { class: 'conflict-icon', text: '⚠' }),
    h('div', { class: 'conflict-text' },
      h('strong', { text: `“${conflict.title}” was changed on disk by another program.` }),
      h('div', { text: gone ? 'Its file was deleted or moved out of the book. Your unsaved text is still here.' : 'You have unsaved changes to it. Nothing is saved until you choose a version.' })),
    h('div', { class: 'conflict-buttons' },
      show,
      h('button', { text: gone ? 'Discard My Version' : 'Use Version on Disk', onclick: () => model.useDiskVersion() }),
      h('button', { text: 'Keep My Version', onclick: () => model.keepMyVersion() })),
  );
}

// MARK: The detail area

/** What the detail shows for the selection, as §5.1 of the description says. */
function detailMode() {
  if (!model.book) return null;
  if (model.selection.kind === 'book') return { editor: false, rendered: 'book' };
  const selected = model.selectedNode;
  if (!selected) return { editor: false, rendered: 'book' };
  if (isTrash(selected.node)) return { editor: false, rendered: 'group' };
  if (isGroup(selected.node)) return model.showsMarkup ? { editor: true, rendered: 'group' } : { editor: false, rendered: 'group' };
  return model.showsMarkup ? { editor: true, rendered: 'section' } : { editor: true, rendered: null };
}

function updateLayout() {
  const mode = detailMode();
  $('empty-state').hidden = Boolean(model.book);
  $('panes').hidden = !mode;
  $('detail').classList.toggle('hidden-detail', !model.book);
  if (!mode) return;
  const wasHidden = $('editor-pane').hidden;
  $('editor-pane').hidden = !mode.editor;
  $('render-pane').hidden = !mode.rendered;
  $('pane-split').hidden = !(mode.editor && mode.rendered);
  $('panes').classList.toggle('split', Boolean(mode.editor && mode.rendered));
  const selected = model.selectedNode;
  $('trash-bar').hidden = !(selected && isTrash(selected.node));
  $('empty-trash-bar').disabled = model.trashIsEmpty;
  if (mode.editor && wasHidden) editor.refresh();
}

function renderDetail() {
  const mode = detailMode();
  if (!mode || !mode.rendered) {
    rendered.content.innerHTML = '';
    return;
  }
  const numbers = divisions(model.book.nodes);
  const bodyOf = (node) => model.liveBody(node);
  let html = '';
  if (mode.rendered === 'book') {
    html = renderBook(manuscript(model.book.nodes), numbers, bodyOf);
  } else {
    const { node, ancestors } = model.selectedNode;
    html = mode.rendered === 'section'
      ? renderSection(node, ancestors, numbers[node.header.id], bodyOf)
      : renderGroup(node, ancestors, numbers, bodyOf);
  }
  rendered.content.classList.toggle('reading', mode.rendered !== 'section');
  rendered.render(html || '<p class="empty-reading">Nothing to read yet.</p>');
  renderedMarkers.update();
}

function updateSelectionColor() {
  document.documentElement.style.setProperty('--selection', model.reviewColor ? COLOR_HEX[model.reviewColor] : 'var(--neutral-selection)');
}

// MARK: Reacting to the model

let lastSelectionKey = null;

model.on((flags) => {
  if (flags.has('tree') || flags.has('selection') || flags.has('words')) {
    if (model.selection.kind === 'node' && flags.has('selection')) outline.reveal(model.selection.id);
    outline.render();
    if (flags.has('selection')) outline.scrollToSelection();
  }
  if (flags.has('tree') || flags.has('selection')) updateForm();
  if (flags.has('selection') || flags.has('ui') || flags.has('tree')) {
    updateLayout();
    updateToolbar();
    updateMarkupBar();
  }
  if (flags.has('selection') || flags.has('buffer')) {
    const key = `${model.openNodeID}`;
    editor.sync();
    if (key !== lastSelectionKey) {
      lastSelectionKey = key;
      if (model.openNodeID != null && model.showsMarkup) editor.cm.scrollTo(0, 0);
    }
  }
  if (flags.has('preview') || flags.has('selection') || flags.has('tree')) renderDetail();
  if (flags.has('comments') || flags.has('color')) {
    editor.refreshComments();
    if (!flags.has('preview') && !flags.has('selection') && !flags.has('tree')) renderDetail();
    commentsPanel.render();
    editorMarkers.update();
    renderedMarkers.update();
  }
  if (flags.has('color')) {
    commentsPanel.renderBar();
    updateSelectionColor();
  }
  if (flags.has('conflict') || flags.has('selection')) updateConflictBar();
  if (flags.has('ui')) {
    $('comments-panel').hidden = !model.commentsPanelVisible || !model.book;
    $('comments-split').hidden = $('comments-panel').hidden;
    fitPanels();
    if (!$('comments-panel').hidden) commentsPanel.render();
    renderRecent();
  }
});

// MARK: Splitters and panel widths

const SIZES_KEY = 'webwriter.sizes';
const sizes = (() => {
  try {
    return { sidebar: 280, comments: 300, editor: 0.5, form: 300, ...JSON.parse(localStorage.getItem(SIZES_KEY) || '{}') };
  } catch {
    return { sidebar: 280, comments: 300, editor: 0.5, form: 300 };
  }
})();

function saveSizes() {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Sizes are a convenience.
  }
}

function splitter(el, onMove) {
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev) => onMove(ev);
    const up = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveSizes();
      editor.refresh();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

/** The detail keeps its minimum width; the comments panel narrows first and leaves when not even 240 fits. */
function fitPanels() {
  const sidebar = Math.min(460, Math.max(240, sizes.sidebar));
  $('sidebar').style.width = `${sidebar}px`;
  const panel = $('comments-panel');
  if (!model.commentsPanelVisible || !model.book) return;
  const detailMin = $('panes').classList.contains('split') ? 521 : 400;
  const available = window.innerWidth - sidebar - detailMin - 12;
  const wanted = Math.min(460, Math.max(240, sizes.comments));
  const squeezed = available < 240;
  panel.hidden = squeezed;
  $('comments-split').hidden = squeezed;
  panel.style.width = `${Math.min(wanted, Math.max(240, available))}px`;
}

function applyEditorSplit() {
  $('editor-pane').style.flexBasis = `${sizes.editor * 100}%`;
}

splitter($('sidebar-split'), (e) => {
  sizes.sidebar = Math.min(460, Math.max(240, e.clientX));
  fitPanels();
});
splitter($('comments-split'), (e) => {
  sizes.comments = Math.min(460, Math.max(240, window.innerWidth - e.clientX));
  fitPanels();
});
splitter($('pane-split'), (e) => {
  const rect = $('panes').getBoundingClientRect();
  const x = Math.min(rect.width - 260, Math.max(260, e.clientX - rect.left));
  sizes.editor = x / rect.width;
  applyEditorSplit();
});
splitter($('form-split'), (e) => {
  const rect = $('sidebar').getBoundingClientRect();
  sizes.form = Math.min(rect.height - 120, Math.max(160, rect.bottom - e.clientY));
  $('form').style.height = `${sizes.form}px`;
});
window.addEventListener('resize', () => {
  fitPanels();
  editorMarkers.update();
  renderedMarkers.update();
});

// MARK: The empty state and recent books

function renderRecent() {
  const list = $('recent-list');
  list.textContent = '';
  for (const path of model.recent.slice(0, 6)) {
    list.append(h('li', {}, h('button', { class: 'link-button', text: path, onclick: () => model.openBook(path) })));
  }
}

// MARK: Leaving the window

window.addEventListener('blur', () => {
  if (model.book) model.save();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && model.book) model.save();
});
window.addEventListener('pagehide', () => {
  // The page may be gone before an ordinary request returns, so the last typing goes out with keepalive.
  const node = model.openNode;
  if (!model.dirty || !node || model.diskConflict?.nodeID === node.header.id) return;
  fetch('/api/node/save', {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', 'X-Webwriter': '1' },
    body: JSON.stringify({ file: node.file, expected: { header: node.header, body: node.body }, header: node.header, body: model.buffer }),
  });
});
window.addEventListener('beforeunload', (e) => {
  // An unresolved conflict asks first, like quitting the native app.
  if (model.diskConflict) e.preventDefault();
});

// MARK: Start

buildMenubar();
buildToolbar();
buildForm();
buildMarkupBar();
buildFindBar();
$('empty-trash-bar').addEventListener('click', () => model.emptyTrash());
$('form').style.height = `${sizes.form}px`;
applyEditorSplit();
updateSelectionColor();
model.start().then(() => {
  updateToolbar();
  fitPanels();
});
