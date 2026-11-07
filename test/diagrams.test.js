import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightOnly, withoutTextWarning, bookSVG } from '../shared/diagrams.js';
import { mermaidBlocks, mermaidSources, replaceMermaid } from '../shared/mermaid.js';

test('draw.io colors become their light ones, for the white page and for Word', () => {
  assert.equal(lightOnly('fill: light-dark(rgb(1, 2, 3), rgb(4, 5, 6)); stroke: light-dark(#000, var(--x, #fff))'), 'fill: rgb(1, 2, 3); stroke: #000');
  assert.equal(lightOnly('<svg style="color-scheme: light dark;">'), '<svg style="color-scheme: light;">');
  assert.equal(lightOnly('no colors'), 'no colors');
});

test("draw.io's text warning goes, and the diagram inside stays", () => {
  const svg = '<svg content="&lt;mxfile/&gt;"><g/><switch><g requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"/><a transform="translate(0,-5)" xlink:href="https://www.drawio.com/doc/faq/svg-export-text-problems" target="_blank"><text>Text is not SVG - cannot display</text></a></switch></svg>';
  assert.equal(withoutTextWarning(svg), '<svg content="&lt;mxfile/&gt;"><g/></svg>');
  assert.equal(bookSVG('<svg style="color-scheme: light dark"><switch><g/></switch></svg>'), '<svg style="color-scheme: light"><switch><g/></switch></svg>');
});

test('mermaid fences are found with their text, and other fences are left alone', () => {
  const markdown = 'Text\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```js\nx\n```\n\n  ~~~~ mermaid title\n  graph TD\n   C\n  ~~~~\n';
  assert.deepEqual(mermaidBlocks(markdown), [
    { start: 2, end: 6, source: 'flowchart LR\n  A --> B' },
    { start: 11, end: 15, source: 'graph TD\n C' },
  ]);
  assert.deepEqual(mermaidSources('```mermaid\na\n```\n```mermaid\na\n```\n'), ['a']);
  assert.deepEqual(mermaidBlocks('```mermaid\nnever closed'), [{ start: 0, end: 2, source: 'never closed' }]);
});

test('mermaid fences become pictures for Word, and a fence without one stays', () => {
  const markdown = 'A\n\n```mermaid\none\n```\n\nB\n\n```mermaid\ntwo\n```\n';
  assert.equal(replaceMermaid(markdown, (source) => (source === 'one' ? '![](one.png)' : null)),
    'A\n\n![](one.png)\n\nB\n\n```mermaid\ntwo\n```\n');
  assert.equal(replaceMermaid('no diagrams', () => 'x'), 'no diagrams');
});
