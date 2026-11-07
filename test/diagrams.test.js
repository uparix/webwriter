import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightOnly, withoutTextWarning, bookSVG } from '../shared/diagrams.js';

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
