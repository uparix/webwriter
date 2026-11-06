// The comments panel, its color bar, and the comment icons in the right margin of each view.
import { h, showMenu, showPopover, closePopover } from './dialogs.js';
import { COLORS, COLOR_HEX, highlight } from '/shared/comments.js';

const BUBBLE = '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 3 13.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const PERSON = '<svg viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 14c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "23 Oct 2026 at 18:30" */
export function longDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "23 Oct, 18:30" */
export function shortDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const capitalized = (s) => s[0].toUpperCase() + s.slice(1);

export class CommentsPanel {
  constructor(container, model) {
    this.model = model;
    this.bar = h('div', { class: 'color-bar' });
    this.list = h('div', { class: 'comment-list' });
    container.append(this.bar, this.list);
  }

  render() {
    this.renderBar();
    this.renderList();
  }

  renderBar() {
    const model = this.model;
    const focused = model.comments.find((c) => c.id === model.focusedCommentID);
    const ring = focused ? highlight(focused) : model.reviewColor;
    this.bar.textContent = '';
    this.bar.append(h('span', { class: 'color-bar-label', text: focused ? 'Comment color' : 'New comments' }));
    const swatches = h('div', { class: 'swatches' });
    for (const name of COLORS) {
      swatches.append(h('button', {
        class: `swatch${ring === name ? ' chosen' : ''}`, title: capitalized(name), 'aria-label': capitalized(name),
        style: { background: COLOR_HEX[name] },
        onclick: () => model.chooseColor(ring === name ? null : name),
      }));
    }
    this.bar.append(swatches);
  }

  renderList() {
    const model = this.model;
    const scroll = this.list.scrollTop;
    this.list.textContent = '';
    const groups = model.commentsByNode();
    if (!groups.length) {
      this.list.append(h('div', { class: 'empty-comments' },
        h('p', { class: 'empty-title', text: 'No Comments' }),
        h('p', { text: 'Select some text and choose Add Comment to start a review.' })));
      return;
    }
    for (const { node, comments } of groups) {
      for (const comment of comments) {
        const entry = h('div', {
          class: `comment-entry${comment.id === model.focusedCommentID ? ' chosen' : ''}`,
          'data-c': comment.id,
        },
        h('div', { class: 'entry-node', text: node.header.title || 'Untitled' }),
        h('div', { class: 'entry-head' }, h('strong', { text: comment.author }), h('span', { class: 'entry-date', text: shortDate(comment.date) })),
        h('div', { class: 'entry-quote', style: { borderColor: COLOR_HEX[highlight(comment)] }, text: comment.quote }),
        h('div', { class: 'entry-text', text: comment.text }));
        entry.addEventListener('click', () => model.revealComment(comment.id));
        entry.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showMenu([
            { label: 'Show in Editor', action: () => model.revealComment(comment.id) },
            { label: 'Delete Comment', action: () => model.deleteComment(comment.id) },
          ], e.clientX, e.clientY);
        });
        this.list.append(entry);
      }
    }
    this.list.scrollTop = scroll;
  }
}

/** The comment icons in the right margin of one view, level with the first line of each comment. */
export class MarkerLayer {
  /** `tops()` gives [{ comment, top }] in the scroller's content coordinates. */
  constructor(scroller, model, tops) {
    this.scroller = scroller;
    this.model = model;
    this.tops = tops;
    this.layer = h('div', { class: 'marker-layer' });
    scroller.append(this.layer);
    new ResizeObserver(() => this.update()).observe(scroller);
  }

  update() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  draw() {
    if (!this.layer.isConnected) this.scroller.append(this.layer);
    this.layer.textContent = '';
    if (!this.model.showsComments || !this.scroller.offsetParent) return;
    const groups = [];
    for (const entry of this.tops().sort((a, b) => a.top - b.top)) {
      const last = groups[groups.length - 1];
      // Comments that start on the same visual line share one icon.
      if (last && Math.abs(last.top - entry.top) < 6) last.comments.push(entry.comment);
      else groups.push({ top: entry.top, comments: [entry.comment] });
    }
    for (const group of groups) {
      const many = group.comments.length > 1;
      const icon = h('button', {
        class: `marker${many ? ' many' : ''}`,
        style: { top: `${Math.max(0, group.top - 3)}px` },
        title: many ? `${group.comments.length} comments` : `1 comment by ${group.comments[0].author}`,
      });
      icon.innerHTML = BUBBLE;
      icon.addEventListener('mousedown', (e) => e.preventDefault());
      icon.addEventListener('click', () => this.popover(group.comments, icon));
      this.layer.append(icon);
    }
  }

  /** The comments on one line, to the left of the icon, over the text. */
  popover(comments, icon) {
    const content = h('div', { class: 'comment-popover' }, comments.map((comment) => {
      const person = h('span', { class: 'person' });
      person.innerHTML = PERSON;
      return h('div', { class: 'popover-comment' },
        h('div', { class: 'entry-head' }, person, h('strong', { text: comment.author })),
        h('div', { class: 'entry-date', text: longDate(comment.date) }),
        h('div', { class: 'entry-quote', style: { borderColor: COLOR_HEX[highlight(comment)] }, text: comment.quote }),
        h('div', { class: 'popover-text', text: comment.text }),
        h('button', {
          class: 'link-button destructive-text',
          onclick: () => {
            closePopover();
            this.model.deleteComment(comment.id);
          },
        }, 'Delete Comment'));
    }));
    showPopover(content, icon, 'left');
  }
}
