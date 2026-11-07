// draw.io diagrams. A diagram is an SVG in images/ that keeps the draw.io diagram in its `content`
// attribute ("Editable SVG"), so it shows like any picture and draw.io can still open it.
// Editing runs draw.io in embed mode in a full-window frame and talks to it with its JSON messages.
import { h } from './dialogs.js';
import { report } from './api.js';
import { bookSVG } from '/shared/diagrams.js';

const EMPTY = '<mxfile host="Webwriter"><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

/** The draw.io diagram kept in an editable SVG, or null when the SVG has none. */
export function diagramInSVG(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName !== 'svg') return null;
  const content = svg.getAttribute('content');
  return content && content.includes('<mxfile') ? content : null;
}

/** Whether a picture path is a draw.io diagram Webwriter can edit. */
export const isDiagramPath = (path) => /\.drawio\.svg$/i.test(path || '');

/** A `data:image/svg+xml;base64,…` URI as text, read as UTF-8. */
function dataURIText(uri) {
  const comma = uri.indexOf(',');
  const meta = uri.slice(0, comma);
  const data = uri.slice(comma + 1);
  if (!meta.includes(';base64')) return decodeURIComponent(data);
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Edit a diagram in draw.io. `xml` is the diagram (null for a new one). Each save asks draw.io for an
 * editable SVG and hands its text to `save(svgText)`. Resolves to true when anything was saved.
 */
export function editDiagram({ drawioURL, xml, title, save }) {
  return new Promise((resolve) => {
    const base = new URL(drawioURL, location.href);
    const origin = base.origin;
    const url = new URL(base);
    for (const [key, value] of Object.entries({ embed: '1', proto: 'json', spin: '1', saveAndExit: '1', noExitBtn: '0', libraries: '1', ui: 'kennedy' })) {
      url.searchParams.set(key, value);
    }
    // draw.io served by Webwriter itself works without the internet: no features that need draw.io's
    // servers. (Its `offline` setting is not used: in embed mode it hides the Save and Exit buttons.)
    if (origin === location.origin) url.searchParams.set('stealth', '1');
    const frame = h('iframe', { class: 'diagram-frame', src: url.href, title: 'draw.io' });
    const status = h('div', { class: 'diagram-status', text: `Loading draw.io from ${origin}…` });
    const overlay = h('div', { class: 'diagram-overlay' }, status, frame);
    document.getElementById('overlay').append(overlay);
    report(`diagram: opening ${url.href} (${navigator.userAgent})`);
    frame.addEventListener('load', () => report('diagram: frame loaded'));
    let saved = false;
    let exitAfterSave = false;
    let loaded = false;
    const post = (message) => frame.contentWindow.postMessage(JSON.stringify(message), origin);
    const close = (why) => {
      report(`diagram: closed (${why})`);
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      overlay.remove();
      resolve(saved);
    };
    // Without a connection draw.io never says it is ready. The frame can still be closed.
    const timer = setTimeout(() => {
      if (loaded) return;
      status.textContent = origin === location.origin
        ? 'draw.io did not load. Run npm run fetch-drawio in the Webwriter folder, then start Webwriter again.'
        : `draw.io did not load from ${origin}. Check the internet connection, or run npm run fetch-drawio in the Webwriter folder to use draw.io without it.`;
      report('diagram: draw.io sent no init within 15 s');
      status.append(h('button', { onclick: () => close('Close button') }, 'Close'));
    }, 15000);
    const onMessage = async (event) => {
      if (event.source === frame.contentWindow && event.origin !== origin) report(`diagram: message from unexpected origin ${event.origin}`);
      if (event.origin !== origin || event.source !== frame.contentWindow || typeof event.data !== 'string') return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      report(`diagram: draw.io sent ${message.event}${message.exit ? ' (exit)' : ''}`);
      if (message.event === 'init') {
        loaded = true;
        status.remove();
        post({ action: 'load', xml: xml || EMPTY, title, autosave: 0, saveAndExit: '1', modified: 'unsavedChanges' });
      } else if (message.event === 'save') {
        exitAfterSave = Boolean(message.exit);
        post({ action: 'export', format: 'xmlsvg', spinKey: 'saving' });
      } else if (message.event === 'export') {
        try {
          await save(bookSVG(dataURIText(message.data)));
          saved = true;
          post({ action: 'status', modified: false, messageKey: 'allChangesSaved' });
          if (exitAfterSave) close('saved, exit');
        } catch (error) {
          report(`diagram: save failed: ${error.message}`);
          post({ action: 'spinner', show: false });
          post({ action: 'dialog', title: 'Not saved', message: error.message, button: 'OK' });
        }
      } else if (message.event === 'exit') {
        close('draw.io exit');
      }
    };
    window.addEventListener('message', onMessage);
  });
}
