// Mermaid diagrams in the views. Mermaid is loaded the first time a view shows one. The views are
// drawn again on every keystroke, so each source is drawn once and kept, and the renderer puts the
// kept SVG straight into its HTML. A source not drawn yet shows the last drawing in its place, or
// its text, until Mermaid is done; then every view showing it gets the drawing.

const SCRIPT = '/vendor/mermaid/mermaid.min.js';

/** source → { key, svg } or { key, error }, once drawn. Typing in a fence draws each version of it. */
const drawn = new Map();
const KEPT = 200;
/** source → its drawing, while Mermaid works on it. */
const drawing = new Map();
/** The last SVG shown in each place, such as a section's second diagram, while its text changes. */
const lastInPlace = new Map();
let keys = 0;
let loading = null;
/** Mermaid draws one diagram at a time. */
let queue = Promise.resolve();

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function load() {
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.onload = () => {
      // Labels as SVG text, not HTML, so a diagram makes a picture for Word just as it shows here.
      // Gantt charts are as wide as the page, not Mermaid's 1100 pixels shrunk to tiny text.
      window.mermaid.initialize({
        startOnLoad: false, theme: 'default', securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false },
        gantt: { useWidth: 620 },
      });
      resolve(window.mermaid);
    };
    script.onerror = () => reject(new Error(`Mermaid could not be loaded from ${SCRIPT}. Run npm install in the Webwriter folder.`));
    document.head.append(script);
  });
  return loading;
}

/** Draw `source` as SVG text. Mermaid's own error message is thrown for a diagram it cannot read. */
function render(source) {
  const id = `mermaid-${(keys += 1)}`;
  const run = queue.then(async () => {
    const mermaid = await load();
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      // A failed render can leave its scratch element in the page.
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** Start drawing `source`, once. Gives the key that marks the places waiting for it. */
function draw(source) {
  if (drawing.has(source)) return drawing.get(source).key;
  const key = String((keys += 1));
  const done = render(source)
    .then((svg) => ({ key, svg }), (error) => ({ key, error: String(error?.message || error).trim() }))
    .then((result) => {
      drawn.set(source, result);
      // The oldest drawings go first.
      for (const old of drawn.keys()) {
        if (drawn.size <= KEPT) break;
        drawn.delete(old);
      }
      drawing.delete(source);
      for (const el of document.querySelectorAll(`.mermaid-diagram[data-mermaid="${key}"]`)) fill(el, result);
    });
  drawing.set(source, { key, done });
  return key;
}

function fill(el, result) {
  if (result.svg) {
    el.innerHTML = result.svg;
    el.setAttribute('contenteditable', 'false');
    if (el.dataset.place) lastInPlace.set(el.dataset.place, result.svg);
  } else {
    el.querySelector('.mermaid-stale')?.remove();
    el.insertAdjacentHTML('beforeend', `<p class="warning">Mermaid: ${esc(result.error)}</p>`);
  }
}

/**
 * A mermaid fence as HTML. `place` names where it is, such as a section and which of its diagrams,
 * so that while its text is being changed the last drawing stays. `codeHTML` is the fence's text as
 * a code block, shown until the diagram is drawn, and with Mermaid's message when it cannot be.
 */
export function mermaidHTML(source, place, codeHTML, lineAttr) {
  const result = drawn.get(source);
  if (result?.svg) {
    lastInPlace.set(place, result.svg);
    return `<div class="mermaid-diagram"${lineAttr} contenteditable="false">${result.svg}</div>`;
  }
  if (result) return `<div class="mermaid-diagram"${lineAttr}>${codeHTML}<p class="warning">Mermaid: ${esc(result.error)}</p></div>`;
  const key = draw(source);
  const last = lastInPlace.get(place);
  // The last drawing stays while the new one is made, so the page does not jump at each keystroke.
  if (last) return `<div class="mermaid-diagram"${lineAttr} data-mermaid="${key}" data-place="${esc(place)}" contenteditable="false"><div class="mermaid-stale">${last}</div></div>`;
  return `<div class="mermaid-diagram"${lineAttr} data-mermaid="${key}" data-place="${esc(place)}">${codeHTML}</div>`;
}

/** Resolves once every diagram asked for so far is drawn, for the print view. */
export const mermaidSettled = () => Promise.all([...drawing.values()].map((d) => d.done));

/** An image's load, as a promise. */
const loaded = (img) => new Promise((resolve, reject) => {
  img.onload = resolve;
  img.onerror = () => reject(new Error('The diagram could not be made into a picture.'));
});

/**
 * `source` as a PNG for Word, at twice its size for sharpness: { png (base64), width, height }, the
 * size in CSS pixels. Throws Mermaid's message for a diagram it cannot read.
 */
export async function mermaidPNG(source) {
  const svgText = await render(source);
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const width = Math.ceil(box[2] || 600);
  const height = Math.ceil(box[3] || 400);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.removeAttribute('style');
  const img = new Image();
  const done = loaded(img);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await done;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { png: canvas.toDataURL('image/png').split(',')[1], width, height };
}
