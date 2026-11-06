// The Markdown editor. The marks stay on screen: a heading line looks like a heading and a fenced
// block looks like code, with the `#` and the backticks still visible. Only the look changes.
// Each node keeps its own CodeMirror document, so its undo history survives switching nodes.
import { fenceStep, fenceMark, codeSpans } from '/shared/fences.js';
import { changedSpan } from '/shared/markup.js';
import { highlight } from '/shared/comments.js';

const CodeMirror = window.CodeMirror;

const STRONG = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;
const EMPHASIS = /(?<![*_\w])([*_])(?=[^\s*_])(.+?)(?<=[^\s*_])\1(?![*_\w])/g;
const NOTE = /\[\^[^\]]+\]:?|\^\[[^\]]*\]/g;
const LINK = /!?\[([^\]]*)\]\(([^)]*)\)(\{[^}]*\})?/g;
const LIST_MARK = /^\s*([-*+]|\d+[.)])\s/;
const HEADING = /^(#{1,6})[ \t]/;

/** The classes of every character of one line, and the fence state after it. */
function lineStyles(line, fence) {
  const classes = Array.from({ length: line.length }, () => new Set());
  const add = (start, end, name) => {
    for (let i = start; i < end && i < line.length; i += 1) classes[i].add(name);
  };
  const stepped = fenceStep(line, fence);
  let lineClass = null;
  if (stepped.fenced) {
    add(0, line.length, 'code');
    if (fenceMark(line)) add(0, line.length, 'mark');
    lineClass = 'line-background-cm-codeline';
  } else if (line.length) {
    const heading = HEADING.exec(line);
    if (heading) {
      add(0, line.length, `heading heading-${heading[1].length}`);
      add(0, heading[1].length, 'mark');
    } else if (line.startsWith('>')) {
      add(0, line.length, 'quote');
      add(0, 1, 'mark');
    } else {
      const list = LIST_MARK.exec(line);
      if (list) {
        const start = list[0].indexOf(list[1]);
        add(start, start + list[1].length, 'listmark');
      }
    }
    const spans = codeSpans(line);
    const outside = (s, e) => !spans.some(([a, b]) => s < b && a < e);
    for (const m of line.matchAll(STRONG)) {
      if (!outside(m.index, m.index + m[0].length)) continue;
      add(m.index, m.index + m[0].length, 'strong');
      add(m.index, m.index + m[1].length, 'mark');
      add(m.index + m[0].length - m[1].length, m.index + m[0].length, 'mark');
    }
    for (const m of line.matchAll(EMPHASIS)) {
      if (!outside(m.index, m.index + m[0].length)) continue;
      add(m.index, m.index + m[0].length, 'em');
      add(m.index, m.index + 1, 'mark');
      add(m.index + m[0].length - 1, m.index + m[0].length, 'mark');
    }
    for (const m of line.matchAll(LINK)) {
      if (!outside(m.index, m.index + m[0].length)) continue;
      add(m.index, m.index + m[0].length, 'mark');
      const text = m.index + m[0].indexOf('[') + 1;
      add(text, text + m[1].length, 'link');
    }
    for (const m of line.matchAll(NOTE)) {
      if (outside(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'note');
    }
    for (const [s, e] of spans) add(s, e, 'code');
  }
  return { styles: classes.map((set) => (set.size ? [...set].join(' ') : null)), fence: stepped.fence, lineClass };
}

CodeMirror.defineMode('bookmd', () => ({
  startState: () => ({ fence: null, styles: null, lineClass: null }),
  copyState: (s) => ({ fence: s.fence, styles: s.styles, lineClass: s.lineClass }),
  blankLine: (s) => (s.fence ? 'line-background-cm-codeline' : null),
  token(stream, state) {
    if (stream.sol()) {
      const result = lineStyles(stream.string, state.fence);
      state.fence = result.fence;
      state.styles = result.styles;
      state.lineClass = result.lineClass;
    }
    const start = stream.pos;
    const style = state.styles[start];
    let end = start + 1;
    while (end < stream.string.length && state.styles[end] === style) end += 1;
    stream.pos = end;
    const line = start === 0 ? state.lineClass : null;
    return [style, line].filter(Boolean).join(' ') || null;
  },
}));

export class EditorController {
  constructor(container, model) {
    this.model = model;
    this.docs = new Map();
    this.nodeID = null;
    this.suppress = false;
    this.marks = [];
    this.cm = CodeMirror(container, {
      value: '',
      mode: 'bookmd',
      lineWrapping: true,
      inputStyle: 'contenteditable',
      spellcheck: true,
      autocorrect: false,
      autocapitalize: false,
      indentWithTabs: true,
      tabSize: 4,
      undoDepth: 2000,
      viewportMargin: Infinity,
      configureMouse: () => ({ addNew: false }),
      extraKeys: { Tab: (cm) => cm.replaceSelection('\t'), Enter: 'newlineAndIndent' },
    });
    this.cm.setOption('extraKeys', { Tab: (cm) => cm.replaceSelection('\t'), Enter: (cm) => cm.replaceSelection('\n') });
    // Comments shift with each change as it happens, so two separate insertions, such as a
    // footnote mark and its definition, never stretch a comment over the text between them.
    // `beforeChange` fires against the text as it is right before each change, undo and redo included.
    this.cm.on('beforeChange', (cm, change) => {
      if (this.suppress || this.nodeID == null) return;
      const doc = cm.getDoc();
      const start = doc.indexFromPos(change.from);
      this.model.shiftComments(this.nodeID, start, doc.indexFromPos(change.to) - start, change.text.join('\n').length);
    });
    this.cm.on('changes', () => {
      if (this.suppress || this.nodeID == null) return;
      this.model.bufferDidChange(this.cm.getValue(), { shifted: true });
    });
    this.cm.on('cursorActivity', () => {
      if (this.suppress || this.nodeID == null) return;
      const { start, end } = this.selection;
      this.model.selectionDidChange(end > start ? { nodeID: this.nodeID, start, length: end - start } : null);
      this.model.previewFollow(this.cm.getCursor('head').line);
    });
    this.cm.on('contextmenu', (_cm, event) => this.model.ui.editorContextMenu(event));
  }

  get isShowing() {
    return this.cm.getWrapperElement().offsetParent !== null;
  }

  /** The selection as UTF-16 offsets into the body. */
  get selection() {
    const doc = this.cm.getDoc();
    const anchor = doc.indexFromPos(doc.getCursor('anchor'));
    const head = doc.indexFromPos(doc.getCursor('head'));
    return { anchor, head, start: Math.min(anchor, head), end: Math.max(anchor, head) };
  }

  /** Show a node's text. Its document, with its undo history, is reused while it still holds that text. */
  show(nodeID, text) {
    this.suppress = true;
    try {
      if (nodeID == null) {
        this.nodeID = null;
        this.cm.swapDoc(new CodeMirror.Doc('', 'bookmd'));
        return;
      }
      let doc = this.docs.get(nodeID);
      if (!doc) {
        doc = new CodeMirror.Doc(text, 'bookmd');
        this.docs.set(nodeID, doc);
      } else if (doc.getValue() !== text) {
        // Replaced from outside the editor, such as a version chosen from disk. The smallest edit keeps the view calm.
        const span = changedSpan(doc.getValue(), text);
        doc.replaceRange(span.insert, doc.posFromIndex(span.start), doc.posFromIndex(span.start + span.length), 'outside');
      }
      this.nodeID = nodeID;
      if (this.cm.getDoc() !== doc) this.cm.swapDoc(doc);
    } finally {
      this.suppress = false;
    }
    this.refreshComments();
    const pending = this.model.takePendingSelection();
    if (pending) this.select(pending.start, pending.length, true);
  }

  /** An undo history would undo into text that is no longer there. */
  forget(nodeID) {
    if (nodeID === this.nodeID) this.cm.getDoc().clearHistory();
    else this.docs.delete(nodeID);
  }

  forgetAll() {
    this.docs.clear();
  }

  /** The editor shows the open node's buffer, even when it changed outside the editor. */
  sync() {
    if (this.model.openNodeID == null) {
      this.show(null, '');
      return;
    }
    this.show(this.model.openNodeID, this.model.buffer);
    this.cm.refresh();
  }

  /** Apply a command result as the smallest edit, then select as it says. */
  replace(result) {
    const doc = this.cm.getDoc();
    const old = doc.getValue();
    const span = changedSpan(old, result.text);
    const kept = old.slice(span.start, span.start + span.length);
    const at = kept ? span.insert.indexOf(kept) : -1;
    this.cm.operation(() => {
      if (at >= 0) {
        // Text inserted around text that stays, such as a wrapped selection: two insertions.
        const after = span.insert.slice(at + kept.length);
        if (after) doc.replaceRange(after, doc.posFromIndex(span.start + span.length), undefined, '+markup');
        if (at > 0) doc.replaceRange(span.insert.slice(0, at), doc.posFromIndex(span.start), undefined, '+markup');
      } else if (span.length || span.insert) {
        doc.replaceRange(span.insert, doc.posFromIndex(span.start), doc.posFromIndex(span.start + span.length), '+markup');
      }
      doc.setSelection(doc.posFromIndex(result.anchor), doc.posFromIndex(result.head));
    });
    this.cm.focus();
  }

  replaceRange(start, length, text) {
    const doc = this.cm.getDoc();
    doc.replaceRange(text, doc.posFromIndex(start), doc.posFromIndex(start + length), '+input');
  }

  select(start, length, reveal = false) {
    const doc = this.cm.getDoc();
    const from = doc.posFromIndex(start);
    const to = doc.posFromIndex(start + length);
    doc.setSelection(from, to);
    if (reveal) {
      this.cm.scrollIntoView({ from, to }, 80);
      this.flash(from, to);
    }
    this.cm.focus();
  }

  /** Briefly highlight a range, such as a match found. */
  flash(from, to) {
    if (from.line === to.line && from.ch === to.ch) return;
    const mark = this.cm.markText(from, to, { className: 'cm-flash' });
    setTimeout(() => mark.clear(), 900);
  }

  focus() {
    this.cm.focus();
  }

  refresh() {
    this.cm.refresh();
    this.refreshComments();
  }

  /** Comment highlights on the Markdown characters. */
  refreshComments() {
    this.cm.operation(() => {
      for (const mark of this.marks) mark.clear();
      this.marks = [];
      if (this.nodeID == null || !this.model.showsComments) return;
      const doc = this.cm.getDoc();
      const length = doc.getValue().length;
      for (const comment of this.model.commentsOn(this.nodeID)) {
        if (comment.length <= 0 || comment.start + comment.length > length) continue;
        this.marks.push(doc.markText(doc.posFromIndex(comment.start), doc.posFromIndex(comment.start + comment.length), {
          className: `comment-mark c-${highlight(comment)}`,
          attributes: { 'data-c': comment.id },
        }));
      }
    });
    this.model.ui.markersChanged?.('editor');
  }

  /** Where each comment starts, as a top offset in the scrolling content, for the margin icons. */
  commentTops() {
    if (this.nodeID == null || !this.isShowing) return [];
    const doc = this.cm.getDoc();
    const scroller = this.cm.getScrollerElement();
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const length = doc.getValue().length;
    return this.model.commentsOn(this.nodeID).map((comment) => {
      const pos = doc.posFromIndex(Math.min(comment.start, length));
      return { comment, top: this.cm.charCoords(pos, 'page').top - window.scrollY - base };
    });
  }
}
