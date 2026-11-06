// Sheets, alerts, menus, and the file browser. The page stands in for the native panels of a
// desktop app, so these all work on the server's folders, not on browser downloads.
import { api } from './api.js';
import { COLORS, COLOR_HEX } from '/shared/comments.js';
import { COMMANDS, matchingCommands } from '/shared/markup.js';
import { TABLE_COMMANDS } from '/shared/table.js';

const PALETTE = [...COMMANDS, ...TABLE_COMMANDS];

export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
};

const overlay = () => document.getElementById('overlay');
const isMac = navigator.platform.toUpperCase().includes('MAC');

/** Shortcut labels in the platform's style: ⌘⇧E on a Mac, Ctrl+Shift+E elsewhere. */
export function shortcutLabel(shortcut) {
  if (!shortcut) return '';
  if (isMac) return shortcut;
  return shortcut.replace('⌃', 'Ctrl+').replace('⌥', 'Alt+').replace('⇧', 'Shift+').replace('⌘', 'Ctrl+')
    .replace('⌫', 'Backspace');
}

// MARK: Sound

let audio = null;
/** A short beep, for refused typing and finds that found nothing. */
export function beep() {
  try {
    audio = audio || new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch {
    // No sound available.
  }
}

// MARK: Modal sheets

let openSheets = 0;
export const sheetIsOpen = () => openSheets > 0;

/**
 * A modal sheet. `build(close)` returns the content; `close(value)` resolves the promise.
 * Escape closes with null.
 */
export function sheet(build, { className = '' } = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const backdrop = h('div', { class: 'backdrop' });
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      openSheets -= 1;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    };
    const box = h('div', { class: `sheet ${className}`, role: 'dialog' }, build(close));
    backdrop.append(box);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(null);
    });
    openSheets += 1;
    overlay().append(backdrop);
    document.addEventListener('keydown', onKey, true);
    const focus = box.querySelector('[autofocus]') || box.querySelector('input, textarea, select, button');
    focus?.focus();
  });
}

function buttons(...list) {
  return h('div', { class: 'sheet-buttons' }, ...list);
}

export function alertSheet(title, detail = '') {
  return sheet((close) => [
    h('h2', { text: 'Webwriter' }),
    h('p', { class: 'sheet-title', text: title }),
    detail ? h('pre', { class: 'sheet-detail', text: detail }) : null,
    buttons(h('button', { class: 'primary', autofocus: true, onclick: () => close(true) }, 'OK')),
  ]);
}

export function confirmSheet({ title, message, action, destructive }) {
  return sheet((close) => [
    h('p', { class: 'sheet-title', text: title }),
    h('p', { class: 'sheet-message', text: message }),
    buttons(
      h('button', { onclick: () => close(false), autofocus: true }, 'Cancel'),
      h('button', { class: destructive ? 'destructive' : 'primary', onclick: () => close(true) }, action),
    ),
  ]).then((v) => v === true);
}

/** Several choices; resolves to the index chosen, or null. None is a default button. */
export function chooseSheet({ title, message, buttons: labels }) {
  return sheet((close) => [
    h('p', { class: 'sheet-title', text: title }),
    h('p', { class: 'sheet-message', text: message }),
    buttons(...labels.map((label, index) => h('button', { onclick: () => close(index) }, label))),
  ]);
}

/** New Text / New Folder: ask for a title. Create is disabled while the title is blank. */
export function titleSheet(kind) {
  return sheet((close) => {
    const input = h('input', { type: 'text', placeholder: 'Title', autofocus: true, 'aria-label': 'Title' });
    const create = h('button', { class: 'primary', disabled: true, onclick: () => close(input.value) }, 'Create');
    input.addEventListener('input', () => { create.disabled = input.value.trim() === ''; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) close(input.value);
    });
    return [
      h('h2', { text: kind === 'group' ? 'New Folder' : 'New Text' }),
      input,
      buttons(h('button', { onclick: () => close(null) }, 'Cancel'), create),
    ];
  });
}

/** The Add Comment sheet: the selected text, an author, a color, and the comment. */
export function commentSheet(draft, { author, color }) {
  return sheet((close) => {
    let chosen = color;
    const text = h('textarea', { rows: 5, placeholder: 'Comment', autofocus: true, 'aria-label': 'Comment' });
    const authorField = h('input', { type: 'text', value: author, 'aria-label': 'Author' });
    const hint = h('span', { class: 'hint-red', text: 'Choose a color' });
    const add = h('button', { class: 'primary' }, 'Add Comment');
    const swatches = h('div', { class: 'swatches' });
    const update = () => {
      add.disabled = !chosen || text.value.trim() === '';
      hint.hidden = Boolean(chosen);
      for (const s of swatches.children) s.classList.toggle('chosen', s.dataset.color === chosen);
    };
    for (const name of COLORS) {
      swatches.append(h('button', {
        class: 'swatch', 'data-color': name, title: name[0].toUpperCase() + name.slice(1),
        style: { background: COLOR_HEX[name] },
        onclick: () => {
          chosen = chosen === name ? null : name;
          update();
        },
      }));
    }
    text.addEventListener('input', update);
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !add.disabled) add.click();
    });
    add.addEventListener('click', () => close({ text: text.value, author: authorField.value, color: chosen }));
    update();
    return [
      h('h2', { text: 'Add Comment' }),
      h('label', { class: 'field-label', text: 'Selected text' }),
      h('blockquote', { class: 'quote-preview', text: draft.quote }),
      h('label', { class: 'field-label', text: 'Author' }), authorField,
      h('div', { class: 'color-row' }, h('label', { class: 'field-label', text: 'Color' }), hint, swatches),
      text,
      buttons(h('button', { onclick: () => close(null) }, 'Cancel'), add),
    ];
  }, { className: 'comment-sheet' });
}

// MARK: The file browser

/**
 * Browse the server's folders. Modes: 'book' (choose a book folder), 'folder' (choose any folder),
 * 'save' (a folder and a file name), 'picture' (a picture file; uploads are offered too).
 * Resolves to an absolute path, or for 'picture' to { path } or { upload: File }.
 */
export function browseSheet({ mode, title, message, action, dir, name = '' }) {
  return sheet((close) => {
    let current = null;
    let chosenFile = null;
    const pathField = h('input', { type: 'text', class: 'path-field', 'aria-label': 'Folder' });
    const list = h('ul', { class: 'browser-list' });
    const nameField = mode === 'save' ? h('input', { type: 'text', value: name, class: 'name-field', 'aria-label': 'File name' }) : null;
    const status = h('p', { class: 'browser-status' });
    const go = async (target) => {
      try {
        const listing = await api.get(`/api/browse?path=${encodeURIComponent(target)}${mode === 'picture' ? '&files=pictures' : ''}`);
        current = listing;
        chosenFile = null;
        pathField.value = listing.path;
        list.textContent = '';
        if (listing.parent) list.append(h('li', { class: 'dir up', ondblclick: () => go(listing.parent), onclick: () => go(listing.parent) }, '↩ ..'));
        for (const entry of listing.entries) {
          const full = `${listing.path.replace(/[\\/]$/, '')}/${entry.name}`;
          const item = h('li', { class: entry.isDirectory ? 'dir' : 'file', title: full }, `${entry.isDirectory ? '📁' : '🖼'} ${entry.name}`);
          if (entry.isDirectory) {
            item.addEventListener('dblclick', () => go(full));
            item.addEventListener('click', () => go(full));
          } else {
            item.addEventListener('click', () => {
              for (const li of list.children) li.classList.remove('selected');
              item.classList.add('selected');
              chosenFile = full;
              primary.disabled = false;
            });
            item.addEventListener('dblclick', () => close({ path: full }));
          }
          list.append(item);
        }
        status.textContent = mode === 'book' && listing.isBook ? 'This folder is a book.' : '';
        primary.disabled = mode === 'picture';
      } catch (error) {
        status.textContent = error.message;
      }
    };
    pathField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go(pathField.value);
    });
    const newFolder = h('button', {
      onclick: async () => {
        const folderName = await titleSheet('group');
        if (!folderName || !current) return;
        try {
          const made = await api.post('/api/mkdir', { path: `${current.path}/${folderName}` });
          go(made.path);
        } catch (error) {
          status.textContent = error.message;
        }
      },
    }, 'New Folder');
    const primary = h('button', {
      class: 'primary',
      onclick: () => {
        if (!current) return;
        if (mode === 'picture') close(chosenFile ? { path: chosenFile } : null);
        else if (mode === 'save') {
          const file = nameField.value.trim();
          if (file) close(`${current.path.replace(/[\\/]$/, '')}/${file}`);
        } else close(current.path);
      },
    }, action);
    const extras = [];
    if (mode === 'picture') {
      const input = h('input', { type: 'file', accept: 'image/*,.pdf,.heic,.tif,.tiff', hidden: true });
      input.addEventListener('change', () => {
        if (input.files[0]) close({ upload: input.files[0] });
      });
      extras.push(input, h('button', { onclick: () => input.click() }, 'Upload from This Computer…'));
    }
    go(dir);
    return [
      h('h2', { text: title }),
      message ? h('p', { class: 'sheet-message', text: message }) : null,
      pathField,
      list,
      nameField ? h('div', { class: 'name-row' }, h('label', { class: 'field-label', text: 'Save as' }), nameField) : null,
      status,
      h('div', { class: 'sheet-buttons spread' },
        h('div', {}, newFolder, ...extras),
        h('div', {}, h('button', { onclick: () => close(null) }, 'Cancel'), primary)),
    ];
  }, { className: 'browser-sheet' });
}

// MARK: Command palette and reminder

/** The command palette: filter by name, ↑/↓ to move, Enter or double-click to run, Esc to close. */
export function paletteSheet() {
  return sheet((close) => {
    let matches = PALETTE;
    let chosen = 0;
    const input = h('input', { type: 'search', placeholder: 'Markup command', autofocus: true, 'aria-label': 'Search' });
    const list = h('ul', { class: 'palette-list' });
    const draw = () => {
      list.textContent = '';
      matches.forEach((command, index) => {
        const item = h('li', { class: index === chosen ? 'chosen' : '' },
          h('div', { class: 'palette-name', text: command.name }),
          h('div', { class: 'palette-inserts', text: command.inserts }));
        item.addEventListener('click', () => {
          chosen = index;
          draw();
        });
        item.addEventListener('dblclick', () => close(command.id));
        list.append(item);
      });
      list.children[chosen]?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      matches = matchingCommands(input.value, PALETTE);
      chosen = 0;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        chosen = Math.min(chosen + 1, matches.length - 1);
        draw();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        chosen = Math.max(chosen - 1, 0);
        draw();
      } else if (e.key === 'Enter' && matches[chosen]) {
        e.preventDefault();
        close(matches[chosen].id);
      }
    });
    draw();
    return [input, list];
  }, { className: 'palette-sheet' });
}

/** Help → Markup Reminder: the twelve commands and what each inserts, in a floating window. */
export function showReminder() {
  const existing = document.getElementById('reminder');
  if (existing) {
    existing.remove();
    return;
  }
  const panel = h('div', { id: 'reminder', class: 'floating' },
    h('div', { class: 'floating-title' }, h('span', { text: 'Markup Reminder' }),
      h('button', { class: 'close', title: 'Close', onclick: () => panel.remove() }, '×')),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Command' }), h('th', { text: 'What it inserts' }))),
      h('tbody', {}, COMMANDS.map((c) => h('tr', {}, h('td', { text: c.name }), h('td', {}, h('code', { text: c.inserts })))))),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'In a table' }), h('th', { text: 'What it does' }))),
      h('tbody', {}, [
        ['Tab', 'Next cell, adding a row after the last; lines the table up'],
        ['Shift+Tab', 'Previous cell'],
        ['Enter', 'Same column in the next row; on an empty last row, leaves the table'],
        ['Shift+Enter', 'A new line'],
        ...TABLE_COMMANDS.map((c) => [c.name, c.inserts]),
      ].map(([name, what]) => h('tr', {}, h('td', { text: name }), h('td', { text: what }))))));
  let drag = null;
  panel.firstChild.addEventListener('mousedown', (e) => {
    const rect = panel.getBoundingClientRect();
    drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    panel.style.left = `${e.clientX - drag.x}px`;
    panel.style.top = `${e.clientY - drag.y}px`;
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { drag = null; });
  overlay().append(panel);
}

// MARK: Menus and popovers

let openMenu = null;

export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

/**
 * A menu at a point. Items: { label, shortcut, action, enabled } or '-' for a separator,
 * or { label, submenu: [...] }.
 */
export function showMenu(items, x, y, { anchor = null } = {}) {
  closeMenu();
  const menu = h('ul', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (item === '-') {
      menu.append(h('li', { class: 'separator', role: 'separator' }));
      continue;
    }
    const enabled = item.enabled === undefined || (typeof item.enabled === 'function' ? item.enabled() : item.enabled);
    const li = h('li', { class: `menu-item${enabled ? '' : ' disabled'}${item.checked?.() ? ' checked' : ''}`, role: 'menuitem' },
      h('span', { class: 'menu-label', text: item.label }),
      h('span', { class: 'menu-shortcut', text: item.submenu ? '▸' : shortcutLabel(item.shortcut) }));
    if (enabled && item.submenu) {
      li.addEventListener('mouseenter', () => {
        menu.querySelector('.submenu')?.remove();
        const sub = showSubmenu(item.submenu);
        li.append(sub);
      });
    } else if (enabled) {
      li.addEventListener('mouseenter', () => menu.querySelector('.submenu')?.remove());
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        item.action();
      });
    }
    menu.append(li);
  }
  overlay().append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;
  openMenu = menu;
  menu.anchor = anchor;
  return menu;
}

function showSubmenu(items) {
  const sub = h('ul', { class: 'menu submenu' });
  for (const item of items) {
    if (item === '-') {
      sub.append(h('li', { class: 'separator' }));
      continue;
    }
    const enabled = item.enabled === undefined || (typeof item.enabled === 'function' ? item.enabled() : item.enabled);
    const li = h('li', { class: `menu-item${enabled ? '' : ' disabled'}` }, h('span', { class: 'menu-label', text: item.label }));
    if (enabled) {
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        item.action();
      });
    }
    sub.append(li);
  }
  return sub;
}

document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.contains(e.target) && !(openMenu.anchor && openMenu.anchor.contains(e.target))) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closePopover();
  }
});
window.addEventListener('blur', closeMenu);

let openPopover = null;

export function closePopover() {
  openPopover?.remove();
  openPopover = null;
}

/** A popover beside `anchor`: to its left (side 'left') or below it. */
export function showPopover(content, anchor, side = 'below') {
  closePopover();
  const pop = h('div', { class: `popover popover-${side}` }, content);
  overlay().append(pop);
  const a = anchor.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  if (side === 'left') {
    pop.style.left = `${Math.max(8, a.left - r.width - 10)}px`;
    pop.style.top = `${Math.max(8, Math.min(a.top + a.height / 2 - 24, window.innerHeight - r.height - 8))}px`;
    pop.style.setProperty('--arrow-top', `${a.top + a.height / 2 - parseFloat(pop.style.top)}px`);
  } else {
    pop.style.left = `${Math.max(8, Math.min(a.left + a.width / 2 - r.width / 2, window.innerWidth - r.width - 8))}px`;
    pop.style.top = `${a.bottom + 8}px`;
  }
  openPopover = pop;
  setTimeout(() => {
    const away = (e) => {
      if (!openPopover) return document.removeEventListener('mousedown', away, true);
      if (!openPopover.contains(e.target) && !anchor.contains(e.target)) {
        closePopover();
        document.removeEventListener('mousedown', away, true);
      }
    };
    document.addEventListener('mousedown', away, true);
  });
  return pop;
}

let toastTimer = null;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    overlay().append(el);
  }
  el.textContent = message;
  el.classList.add('shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('shown'), 3500);
}
