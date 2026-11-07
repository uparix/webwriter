// The outline: the book row, then the tree of nodes, with the trash last.
// Rows are selected, expanded, dragged to reorder or nest, and right-clicked for commands.
import { h, showMenu } from './dialogs.js';
import { isTrash, isGroup, isChapter, divisions, divisionLabel, manuscript } from '/shared/tree.js';

const EXPANDED_KEY = 'webwriter.expanded';
const ICONS = {
  book: '<svg viewBox="0 0 16 16"><path d="M2 2.5h4.5A1.5 1.5 0 0 1 8 4v10a1.5 1.5 0 0 0-1.5-1.5H2zM14 2.5H9.5A1.5 1.5 0 0 0 8 4v10a1.5 1.5 0 0 1 1.5-1.5H14z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  group: '<svg viewBox="0 0 16 16"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  section: '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M5.5 8h5 M5.5 10.5h5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11 M6 4V2.5h4V4 M4 4l.7 9.5h6.6L12 4 M6.5 6.5v5 M9.5 6.5v5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
};

function loadExpanded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '["__book"]'));
  } catch {
    return new Set(['__book']);
  }
}

export class Outline {
  constructor(container, model) {
    this.container = container;
    this.model = model;
    this.expanded = loadExpanded();
    this.dragging = null;
    container.tabIndex = 0;
    container.addEventListener('keydown', (e) => this.onKey(e));
    container.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.row')) e.preventDefault();
    });
  }

  saveExpanded() {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded]));
    } catch {
      // The expansion state is a convenience.
    }
  }

  render() {
    const model = this.model;
    this.container.textContent = '';
    if (!model.book) return;
    const numbers = divisions(model.book.nodes);
    const list = h('ul', { class: 'tree', role: 'tree' });
    const bookRow = this.row({
      id: '__book', icon: 'book', title: model.book.title, emphasized: true,
      detail: `${model.bookWordCount().toLocaleString()} words`, depth: 0,
      hasChildren: model.book.nodes.length > 0, selected: model.selection.kind === 'book',
    });
    list.append(bookRow.li);
    if (this.expanded.has('__book')) {
      for (const node of model.book.nodes) this.addNode(bookRow.children, node, 1, numbers, false);
    }
    this.container.append(list);
  }

  addNode(parentList, node, depth, numbers, inTrash) {
    const model = this.model;
    const trash = isTrash(node);
    let detail;
    if (trash) {
      detail = node.children.length === 0 ? 'Empty' : `${node.children.length} piece${node.children.length === 1 ? '' : 's'}`;
    } else {
      const status = node.header.status[0].toUpperCase() + node.header.status.slice(1);
      const words = `${model.liveWordCount(node).toLocaleString()} words`;
      const division = numbers[node.header.id];
      detail = [division ? divisionLabel(division) : null, status, words].filter(Boolean).join(' · ');
    }
    const row = this.row({
      id: node.header.id, icon: trash ? 'trash' : isGroup(node) ? 'group' : 'section',
      title: trash ? 'Trash' : node.header.title || 'Untitled', detail,
      synopsis: trash ? '' : node.header.synopsis, depth, hasChildren: node.children.length > 0,
      selected: model.selection.kind === 'node' && model.selection.id === node.header.id, node, inTrash,
    });
    parentList.append(row.li);
    if (this.expanded.has(node.header.id)) {
      for (const child of node.children) this.addNode(row.children, child, depth + 1, numbers, inTrash || trash);
    }
  }

  row({ id, icon, title, detail, synopsis = '', depth, hasChildren, selected, emphasized = false, node = null, inTrash = false }) {
    const expanded = this.expanded.has(id);
    const disclosure = h('span', { class: `disclosure${hasChildren ? '' : ' leaf'}${expanded ? ' open' : ''}` });
    disclosure.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle(id);
    });
    const iconEl = h('span', { class: 'row-icon' });
    iconEl.innerHTML = ICONS[icon];
    const row = h('div', {
      class: `row${selected ? ' selected' : ''}${emphasized ? ' book-row' : ''}`,
      style: { paddingLeft: `${6 + depth * 14}px` },
      draggable: node && !isTrash(node) ? 'true' : 'false',
      'data-id': id,
    }, disclosure, iconEl, h('div', { class: 'row-text' },
      h('div', { class: 'row-title', text: title }),
      h('div', { class: 'row-detail', text: detail }),
      synopsis ? h('div', { class: 'row-synopsis', text: synopsis }) : null));
    row.addEventListener('click', () => {
      this.container.focus();
      this.model.selectRow(id === '__book' ? { kind: 'book' } : { kind: 'node', id });
    });
    row.addEventListener('dblclick', () => hasChildren && this.toggle(id));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.contextMenu(id, node, inTrash, e.clientX, e.clientY);
    });
    this.dragEvents(row, id, node);
    const children = h('ul', { role: 'group' });
    const li = h('li', { role: 'treeitem', 'aria-selected': selected ? 'true' : 'false' }, row, children);
    return { li, children };
  }

  toggle(id) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
    this.saveExpanded();
    this.render();
  }

  /** Expand the rows above a node, so that it can be seen. */
  reveal(id) {
    const found = this.model.findWithAncestors(id);
    if (!found) return;
    let changed = !this.expanded.has('__book');
    this.expanded.add('__book');
    for (const a of found.ancestors) {
      if (!this.expanded.has(a.header.id)) changed = true;
      this.expanded.add(a.header.id);
    }
    if (changed) this.saveExpanded();
  }

  scrollToSelection() {
    this.container.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  contextMenu(id, node, inTrash, x, y) {
    const model = this.model;
    let items = [];
    if (id === '__book') {
      items = [
        { label: 'New Text', action: () => model.requestCreation('section', { type: 'inParent', id: null }) },
        { label: 'New Folder', action: () => model.requestCreation('group', { type: 'inParent', id: null }) },
        { label: 'New Index', action: () => model.requestCreation('index', { type: 'top', id: null }) },
      ];
    } else if (isTrash(node)) {
      items = [{ label: 'Empty Trash…', enabled: !model.trashIsEmpty, action: () => model.emptyTrash() }];
    } else if (inTrash) {
      return;
    } else if (isGroup(node)) {
      items = [
        { label: 'New Text Inside', action: () => model.requestCreation('section', { type: 'inside', id }) },
        { label: 'New Folder Inside', action: () => model.requestCreation('group', { type: 'inside', id }) },
        '-',
        ...(isChapter(node) ? [{ label: 'Export to PDF…', action: () => model.exportChapterPDF(id) }, '-'] : []),
        { label: 'Move to Trash', action: () => model.moveToTrash(id) },
      ];
    } else {
      items = [
        { label: 'New Text Below', action: () => model.requestCreation('section', { type: 'below', id }) },
        '-',
        ...(isChapter(node) ? [{ label: 'Export to PDF…', action: () => model.exportChapterPDF(id) }, '-'] : []),
        { label: 'Move to Trash', action: () => model.moveToTrash(id) },
      ];
    }
    showMenu(items, x, y);
  }

  // MARK: Dragging

  /** Where a drop on `row` would go: { target, zone }, or null when it is refused. */
  dropFor(row, event, node) {
    const model = this.model;
    const moving = this.dragging;
    if (!moving) return null;
    const id = row.dataset.id;
    const rect = row.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    if (id === '__book') {
      // Onto the book row: to the end of the manuscript.
      const last = [...manuscript(model.book.nodes)].reverse().find((n) => n.header.id !== moving);
      return last ? { target: last.header.id, zone: 'after', indicator: 'inside' } : null;
    }
    let zone;
    if (isTrash(node)) zone = 'inside';
    else if (isGroup(node)) zone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    else zone = y < 0.5 ? 'before' : 'after';
    if (!model.canMove(moving, id, zone)) return null;
    return { target: id, zone, indicator: zone };
  }

  dragEvents(row, id, node) {
    row.addEventListener('dragstart', (e) => {
      if (!node || isTrash(node)) {
        e.preventDefault();
        return;
      }
      this.dragging = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      this.dragging = null;
      row.classList.remove('dragging');
      this.clearIndicators();
    });
    row.addEventListener('dragover', (e) => {
      const drop = this.dropFor(row, e, node);
      this.clearIndicators();
      if (!drop) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add(`drop-${drop.indicator}`);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    row.addEventListener('drop', (e) => {
      const drop = this.dropFor(row, e, node);
      this.clearIndicators();
      if (!drop) return;
      e.preventDefault();
      const moving = this.dragging;
      this.dragging = null;
      if (drop.zone === 'inside') {
        this.expanded.add(drop.target);
        this.saveExpanded();
      }
      this.model.move(moving, drop.target, drop.zone);
    });
  }

  clearIndicators() {
    for (const el of this.container.querySelectorAll('.drop-before, .drop-after, .drop-inside')) {
      el.classList.remove('drop-before', 'drop-after', 'drop-inside');
    }
  }

  // MARK: Keyboard

  visibleRows() {
    return [...this.container.querySelectorAll('.row')];
  }

  onKey(event) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const rows = this.visibleRows();
    const index = rows.findIndex((r) => r.classList.contains('selected'));
    const current = rows[index];
    if (!current) return;
    const id = current.dataset.id;
    if (event.key === 'ArrowDown' && rows[index + 1]) rows[index + 1].click();
    if (event.key === 'ArrowUp' && index > 0) rows[index - 1].click();
    if (event.key === 'ArrowRight' && !this.expanded.has(id)) this.toggle(id);
    if (event.key === 'ArrowLeft' && this.expanded.has(id)) this.toggle(id);
  }
}
