// The section preview and the reading view: rendered text that can be typed in. The rendered text
// itself is never edited. Every keystroke becomes a splice into the Markdown body of the node under
// the caret, and the view is drawn again from the bodies.
import { highlight } from '/shared/comments.js';

const textLength = (node) => node.textContent.length;

/** Characters from the start of `span` to the DOM point (container, offset). */
function offsetInSpan(span, container, offset) {
  const range = document.createRange();
  range.setStart(span, 0);
  range.setEnd(container, offset);
  return range.toString().length;
}

export class RenderedView {
  /** `scroller` scrolls; `content` holds the rendered HTML and is editable. */
  constructor(scroller, content, model, name) {
    this.scroller = scroller;
    this.content = content;
    this.model = model;
    this.name = name;
    this.pendingCaret = null;
    this.lastCaret = null;
    this.undoStack = [];
    this.redoStack = [];
    content.contentEditable = 'true';
    content.spellcheck = true;
    content.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    content.addEventListener('keydown', (e) => this.onKeyDown(e));
    content.addEventListener('click', (e) => this.onClick(e));
    content.addEventListener('drop', (e) => e.preventDefault());
    content.addEventListener('error', (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG' || !img.classList.contains('picture')) return;
      const warning = document.createElement('span');
      warning.className = 'warning';
      warning.textContent = `[picture: ${img.dataset.path}]`;
      img.replaceWith(warning);
    }, true);
    document.addEventListener('selectionchange', () => {
      if (!this.hasFocus()) return;
      const selection = this.selectionRange();
      if (selection !== undefined) this.model.selectionDidChange(selection && selection.length > 0 ? selection : null);
    });
    content.addEventListener('contextmenu', (e) => this.model.ui.renderedContextMenu(e, this));
  }

  hasFocus() {
    const selection = window.getSelection();
    return selection.rangeCount > 0 && this.content.contains(selection.anchorNode);
  }

  /** Draw new HTML, keeping the scroll position, then mark comments and restore a pending caret. */
  render(html) {
    const top = this.scroller.scrollTop;
    // A redraw, such as after a save, keeps the writer's caret or selection on the same body text.
    const kept = !this.pendingCaret && this.hasFocus() ? this.selectionRange() : null;
    const remembered = kept && kept.length === 0 && this.lastCaret
      && this.caretPoint(window.getSelection().getRangeAt(0))?.offset === this.lastCaret.offset ? this.lastCaret.offset : null;
    this.content.innerHTML = html;
    this.applyHighlights();
    this.scroller.scrollTop = top;
    if (this.pendingCaret) {
      const caret = this.pendingCaret;
      this.pendingCaret = null;
      this.placeCaret(caret.nodeID, caret.offset);
    } else if (kept) {
      this.placeCaret(kept.nodeID, remembered ?? kept.start);
      if (kept.length > 0) this.extendTo(kept.nodeID, kept.start + kept.length);
    }
  }

  /** Extend the selection from the caret to a body offset. */
  extendTo(nodeID, offset) {
    const section = [...this.content.querySelectorAll('section[data-node]')].find((s) => s.dataset.node === nodeID);
    const spans = section ? [...section.querySelectorAll('span[data-o]')] : [];
    const span = spans.filter((s) => Number(s.dataset.o) < offset).pop();
    if (!span) return;
    const point = this.domPoint(span, Math.min(textLength(span), offset - Number(span.dataset.o)));
    window.getSelection().extend(point.node, point.offset);
  }

  // MARK: Comments

  /** Background highlights on the rendered characters that came from each comment's range. */
  applyHighlights() {
    if (!this.model.showsComments) return;
    for (const section of this.content.querySelectorAll('section[data-node]')) {
      const comments = this.model.commentsOn(section.dataset.node).filter((c) => c.length > 0);
      if (!comments.length) continue;
      for (const span of section.querySelectorAll('span[data-o]')) {
        const start = Number(span.dataset.o);
        const end = start + textLength(span);
        const hits = comments.filter((c) => c.start < end && c.start + c.length > start);
        if (!hits.length) continue;
        const cuts = new Set([start, end]);
        for (const c of hits) {
          cuts.add(Math.max(start, c.start));
          cuts.add(Math.min(end, c.start + c.length));
        }
        const points = [...cuts].sort((a, b) => a - b);
        const text = span.textContent;
        span.textContent = '';
        for (let i = 0; i < points.length - 1; i += 1) {
          const a = points[i];
          const b = points[i + 1];
          const piece = text.slice(a - start, b - start);
          const covering = hits.filter((c) => c.start <= a && c.start + c.length >= b);
          if (!covering.length) {
            span.append(piece);
            continue;
          }
          const mark = document.createElement('mark');
          mark.className = `comment-mark c-${highlight(covering[covering.length - 1])}`;
          mark.dataset.c = covering.map((c) => c.id).join(' ');
          mark.textContent = piece;
          span.append(mark);
        }
      }
    }
  }

  /** Where each comment in this view starts, as a top offset in the scrolling content. */
  commentTops() {
    const base = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    const out = [];
    for (const section of this.content.querySelectorAll('section[data-node]')) {
      for (const comment of this.model.commentsOn(section.dataset.node)) {
        const rect = this.rectAt(section, comment.start);
        if (rect) out.push({ comment, top: rect.top - base });
      }
    }
    return out;
  }

  /** The screen rectangle of the rendered character at a body offset, or the nearest one after it. */
  rectAt(section, offset) {
    const spans = [...section.querySelectorAll('span[data-o]')];
    if (!spans.length) return null;
    let chosen = spans.find((s) => Number(s.dataset.o) + textLength(s) > offset) || spans[spans.length - 1];
    const local = Math.max(0, Math.min(offset - Number(chosen.dataset.o), textLength(chosen)));
    const point = this.domPoint(chosen, local);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.setEnd(point.node, Math.min(point.offset + 1, point.node.length));
    const rects = range.getClientRects();
    return rects.length ? rects[0] : chosen.getBoundingClientRect();
  }

  // MARK: Mapping between the DOM and the bodies

  /** The text node and offset inside `span` at `local` characters from its start. */
  domPoint(span, local) {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let remaining = local;
    let last = null;
    while (walker.nextNode()) {
      last = walker.currentNode;
      if (remaining <= last.length) return { node: last, offset: remaining };
      remaining -= last.length;
    }
    if (!last) {
      last = document.createTextNode('');
      span.append(last);
    }
    return { node: last, offset: last.length };
  }

  /** A DOM point as { nodeID, offset } in a body, or null when it is not in body text. */
  bodyPoint(container, offset) {
    let node = container;
    let off = offset;
    if (node.nodeType === Node.ELEMENT_NODE) {
      // A point between elements: the text right after it, or right before it.
      const child = node.childNodes[off];
      const walker = document.createTreeWalker(this.content, NodeFilter.SHOW_TEXT);
      if (child) {
        walker.currentNode = child;
        const text = child.nodeType === Node.TEXT_NODE ? child : walker.nextNode();
        if (text && text.parentElement?.closest('span[data-o]')) return this.bodyPoint(text, 0);
      }
      const before = off > 0 ? node.childNodes[off - 1] : node;
      walker.currentNode = before;
      let text = before.nodeType === Node.TEXT_NODE ? before : null;
      if (!text) {
        let last = null;
        const inner = document.createTreeWalker(before, NodeFilter.SHOW_TEXT);
        while (inner.nextNode()) last = inner.currentNode;
        text = last;
      }
      if (!text) return null;
      node = text;
      off = text.length;
    }
    const span = node.parentElement?.closest('span[data-o]');
    if (!span || !this.content.contains(span)) return null;
    const section = span.closest('section[data-node]');
    if (!section) return null;
    return { nodeID: section.dataset.node, offset: Number(span.dataset.o) + offsetInSpan(span, node, off), span };
  }

  /**
   * The current selection as { nodeID, start, length } in one body: from its first to its last character
   * that has a body offset. Null when it maps to nothing or spans two nodes; undefined when outside this view.
   */
  selectionRange(range = null) {
    const selection = window.getSelection();
    if (!range) {
      if (!selection.rangeCount) return undefined;
      range = selection.getRangeAt(0);
    }
    if (!this.content.contains(range.commonAncestorContainer)) return undefined;
    if (range.collapsed) {
      const point = this.caretPoint(range);
      return point ? { nodeID: point.nodeID, start: point.offset, length: 0 } : null;
    }
    let first = null;
    let last = null;
    const nodes = new Set();
    for (const span of this.content.querySelectorAll('span[data-o]')) {
      if (!range.intersectsNode(span)) continue;
      const length = textLength(span);
      const s = span.contains(range.startContainer) ? offsetInSpan(span, range.startContainer, range.startOffset) : 0;
      const e = span.contains(range.endContainer) ? offsetInSpan(span, range.endContainer, range.endOffset) : length;
      if (e <= s) continue;
      const nodeID = span.closest('section[data-node]')?.dataset.node;
      if (!nodeID) continue;
      nodes.add(nodeID);
      const o = Number(span.dataset.o);
      if (!first) first = { nodeID, offset: o + s };
      last = { nodeID, offset: o + e };
    }
    if (!first || nodes.size !== 1) return null;
    return { nodeID: first.nodeID, start: first.offset, length: Math.max(0, last.offset - first.offset) };
  }

  /** The body position of a collapsed caret. Right after an edit it is where the writer is typing. */
  caretPoint(range) {
    const last = this.lastCaret;
    // It holds only while the body is still the text it was remembered in, not after an undo, say.
    if (last && range.startContainer === last.node && range.startOffset === last.domOffset
      && this.model.liveBodyOf(last.nodeID) === last.body) {
      return { nodeID: last.nodeID, offset: last.offset };
    }
    return this.bodyPoint(range.startContainer, range.startOffset);
  }

  /** Put the caret at a body offset. When no rendered character is there, it stays nearby and remembers the offset. */
  placeCaret(nodeID, offset) {
    const section = [...this.content.querySelectorAll('section[data-node]')].find((s) => s.dataset.node === nodeID);
    if (!section) return;
    const spans = [...section.querySelectorAll('span[data-o]')];
    let span = spans.find((s) => Number(s.dataset.o) <= offset && offset < Number(s.dataset.o) + textLength(s));
    let local;
    if (span) local = offset - Number(span.dataset.o);
    else {
      span = spans.filter((s) => Number(s.dataset.o) + textLength(s) <= offset).pop() || spans[0];
      if (!span) return;
      local = Math.min(textLength(span), Math.max(0, offset - Number(span.dataset.o)));
    }
    const point = this.domPoint(span, local);
    const selection = window.getSelection();
    selection.collapse(point.node, point.offset);
    this.lastCaret = { nodeID, offset, node: point.node, domOffset: point.offset, body: this.model.liveBodyOf(nodeID) };
  }

  // MARK: Typing

  onBeforeInput(event) {
    event.preventDefault();
    if (event.inputType === 'historyUndo') return this.undo();
    if (event.inputType === 'historyRedo') return this.redo();
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    let text = '';
    const type = event.inputType;
    if (type.startsWith('insert')) {
      if (type === 'insertParagraph') {
        const inCode = selection.anchorNode?.parentElement?.closest('pre[data-code]');
        text = inCode ? '\n' : '\n\n';
      } else if (type === 'insertLineBreak') {
        text = '\n';
      } else {
        text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      }
      text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    } else if (type.startsWith('delete')) {
      if (selection.isCollapsed) {
        const backward = type.includes('Backward');
        const unit = type.includes('Word') ? 'word' : type.includes('Line') ? 'lineboundary' : 'character';
        // A deletion at the remembered typing position deletes before or after it in the body.
        const caret = this.caretPoint(selection.getRangeAt(0));
        if (caret && unit === 'character' && this.lastCaret && caret.offset === this.lastCaret.offset
          && this.model.liveBodyOf(caret.nodeID) === this.lastCaret.body) {
          const body = this.model.liveBodyOf(caret.nodeID);
          const start = backward ? caret.offset - 1 : caret.offset;
          if (start >= 0 && start < body.length) return this.splice({ nodeID: caret.nodeID, start, length: 1 }, '');
        }
        selection.modify('extend', backward ? 'backward' : 'forward', unit);
      }
    } else {
      return;
    }
    const target = this.selectionRange(selection.getRangeAt(0));
    if (!target) {
      this.model.ui.beep();
      return;
    }
    this.splice(target, text);
  }

  async splice(target, text) {
    this.pendingCaret = { nodeID: target.nodeID, offset: target.start + text.length };
    const outcome = await this.model.splice({ nodeID: target.nodeID, start: target.start, length: target.length, text });
    if (outcome.kind === 'refused') {
      this.pendingCaret = null;
      this.model.ui.beep();
      return;
    }
    this.redoStack = [];
    this.undoStack.push({ kind: outcome.kind, nodeID: target.nodeID, start: target.start, length: text.length, text: outcome.previous ?? '', inserted: text });
    if (this.undoStack.length > 500) this.undoStack.shift();
  }

  /** Edits of the open text undo in the editor; edits of other sections undo here. */
  async undo() {
    const edit = this.undoStack.pop();
    if (!edit) return this.model.ui.beep();
    if (edit.kind === 'editor') {
      this.model.editorUndo();
      this.redoStack.push(edit);
      return;
    }
    this.pendingCaret = { nodeID: edit.nodeID, offset: edit.start + edit.text.length };
    const outcome = await this.model.splice({ nodeID: edit.nodeID, start: edit.start, length: edit.length, text: edit.text });
    if (outcome.kind !== 'refused') this.redoStack.push(edit);
  }

  async redo() {
    const edit = this.redoStack.pop();
    if (!edit) return this.model.ui.beep();
    if (edit.kind === 'editor') {
      this.model.editorRedo();
      this.undoStack.push(edit);
      return;
    }
    this.pendingCaret = { nodeID: edit.nodeID, offset: edit.start + edit.inserted.length };
    const outcome = await this.model.splice({ nodeID: edit.nodeID, start: edit.start, length: edit.text.length, text: edit.inserted });
    if (outcome.kind !== 'refused') this.undoStack.push(edit);
  }

  onKeyDown(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    }
  }

  // MARK: Links and scrolling

  onClick(event) {
    const note = event.target.closest('a[data-note]');
    const back = event.target.closest('a[data-ref]');
    const external = event.target.closest('a.external');
    const piece = event.target.closest('a[data-open-node]');
    if (piece) {
      // An index entry opens its piece.
      event.preventDefault();
      this.model.selectRow({ kind: 'node', id: piece.dataset.openNode });
    } else if (note) {
      event.preventDefault();
      this.reveal(`note:${note.dataset.note}`);
      this.model.revealNote(`note:${note.dataset.note}`);
    } else if (back) {
      event.preventDefault();
      this.reveal(`ref:${back.dataset.ref}`);
      this.model.revealNote(`ref:${back.dataset.ref}`);
    } else if (external) {
      // External links open in the system browser.
      event.preventDefault();
      const href = external.getAttribute('href');
      if (/^(https?|mailto):/i.test(href)) window.open(href, '_blank', 'noopener');
    }
  }

  /** Scroll to a note or its reference and briefly highlight it. */
  reveal(id) {
    const target = document.getElementById(id);
    if (!target || !this.content.contains(target)) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  /** Scroll so that the block holding a body line of a node is visible. Nothing scrolls when it already is. */
  followLine(nodeID, line) {
    const section = [...this.content.querySelectorAll('section[data-node]')].find((s) => s.dataset.node === nodeID);
    if (!section) return;
    let block = null;
    for (const el of section.querySelectorAll('[data-line]')) {
      if (Number(el.dataset.line) <= line) block = el;
    }
    if (!block) return;
    const view = this.scroller.getBoundingClientRect();
    const rect = block.getBoundingClientRect();
    if (rect.bottom > view.top && rect.top < view.bottom && rect.top >= view.top - rect.height) return;
    const top = rect.top - view.top + this.scroller.scrollTop - 40;
    this.scroller.scrollTo({ top, behavior: 'smooth' });
  }
}
