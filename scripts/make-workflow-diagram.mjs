// Writes the example book's second diagram, images/writing-workflow.drawio.svg: the way from a draft to
// the exports, with a loop back for another pass. Like make-sample-diagram.mjs, the draw.io model is
// kept in the SVG's `content` attribute, so draw.io can open and edit it, and the labels are plain SVG text.
import fs from 'node:fs';

const out = process.argv[2] || 'examples/mybook/images/writing-workflow.drawio.svg';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const blue = { fill: '#DAE8FC', stroke: '#6C8EBF' };
const green = { fill: '#D5E8D4', stroke: '#82B366' };
const orange = { fill: '#FFE6CC', stroke: '#D79B00' };
const grey = { fill: '#F5F5F5', stroke: '#666666' };
const steps = [
  { id: 'write', label: 'Write', x: 20, y: 80, w: 110, h: 40, ...blue },
  { id: 'comment', label: 'Comment', x: 165, y: 80, w: 110, h: 40, ...green },
  { id: 'revise', label: 'Revise', x: 310, y: 80, w: 110, h: 40, ...orange },
];
const outputs = [
  { id: 'pdf', label: 'PDF', x: 490, y: 20, w: 120, h: 40, ...grey },
  { id: 'word', label: 'Word', x: 490, y: 80, w: 120, h: 40, ...grey },
  { id: 'web', label: 'Web page', x: 490, y: 140, w: 120, h: 40, ...grey },
];
const [write, comment, revise] = steps;
const width = 630;
const height = 230;
const loopY = 190;
const forkX = 455;

// The draw.io model.
const cell = (b) => `<mxCell id="${b.id}" value="${esc(b.label)}" style="rounded=1;arcSize=12;whiteSpace=wrap;html=0;fillColor=${b.fill};strokeColor=${b.stroke};fontFamily=Helvetica;fontSize=12;" vertex="1" parent="1"><mxGeometry x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" as="geometry"/></mxCell>`;
const edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;endArrow=block;endFill=1;strokeColor=#666666;fontFamily=Helvetica;fontSize=10;fontColor=#666666;';
const edge = (id, source, target, extra = '', points = '') => `<mxCell id="${id}" style="${edgeStyle}${extra}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`;
const loopPoints = `<Array as="points"><mxPoint x="${revise.x + revise.w / 2}" y="${loopY}"/><mxPoint x="${write.x + write.w / 2}" y="${loopY}"/></Array>`;
const loopLabel = `<mxCell id="loop-label" value="another pass" style="text;html=0;align=center;verticalAlign=top;fontFamily=Helvetica;fontSize=10;fontColor=#666666;" vertex="1" parent="1"><mxGeometry x="${(write.x + revise.x + revise.w) / 2 - 50}" y="${loopY + 4}" width="100" height="20" as="geometry"/></mxCell>`;
const edges = [
  edge('write-comment', 'write', 'comment'),
  edge('comment-revise', 'comment', 'revise'),
  edge('revise-write', 'revise', 'write', 'exitX=0.5;exitY=1;entryX=0.5;entryY=1;', loopPoints),
  ...outputs.map((o) => edge(`revise-${o.id}`, 'revise', o.id, 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;')),
];
const model = `<mxfile host="Webwriter" type="device"><diagram id="writing-workflow" name="Writing workflow"><mxGraphModel dx="800" dy="400" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${[...steps, ...outputs].map(cell).join('')}${edges.join('')}${loopLabel}</root></mxGraphModel></diagram></mxfile>`;

// The drawing, from the same coordinates.
const font = 'font-family="Helvetica, Arial, sans-serif"';
const box = (b) => `<rect x="${b.x + 0.5}" y="${b.y + 0.5}" width="${b.w}" height="${b.h}" rx="4.8" fill="${b.fill}" stroke="${b.stroke}"/>`
  + `<text x="${b.x + b.w / 2 + 0.5}" y="${b.y + b.h / 2 + 4.5}" text-anchor="middle" ${font} font-size="12" fill="#000000">${esc(b.label)}</text>`;
const line = (points) => `<path d="M ${points.map(([x, y]) => `${x + 0.5} ${y + 0.5}`).join(' L ')}" fill="none" stroke="#666666"/>`;
// An arrowhead ending at (x, y), pointing right, or up.
const headRight = (x, y) => `<path d="M ${x - 7.5} ${y - 3.5} L ${x + 0.5} ${y + 0.5} L ${x - 7.5} ${y + 4.5} Z" fill="#666666" stroke="#666666"/>`;
const headUp = (x, y) => `<path d="M ${x - 3.5} ${y + 8.5} L ${x + 0.5} ${y + 0.5} L ${x + 4.5} ${y + 8.5} Z" fill="#666666" stroke="#666666"/>`;
const midY = write.y + write.h / 2;
const arrow = (from, to) => line([[from.x + from.w, midY], [to.x - 7, midY]]) + headRight(to.x, midY);
const reviseX = revise.x + revise.w / 2;
const writeX = write.x + write.w / 2;
const loop = line([[reviseX, revise.y + revise.h], [reviseX, loopY], [writeX, loopY], [writeX, write.y + write.h + 8]])
  + headUp(writeX, write.y + write.h)
  + `<text x="${(write.x + revise.x + revise.w) / 2 + 0.5}" y="${loopY + 16}" text-anchor="middle" ${font} font-size="10" fill="#666666">another pass</text>`;
const fork = outputs.map((o) => {
  const y = o.y + o.h / 2;
  return line([[revise.x + revise.w, midY], [forkX, midY], [forkX, y], [o.x - 7, y]]) + headRight(o.x, y);
}).join('');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}px" height="${height}px" viewBox="-0.5 -0.5 ${width} ${height}" content="${esc(model)}"><defs/><g>${arrow(write, comment)}${arrow(comment, revise)}${loop}${fork}${[...steps, ...outputs].map(box).join('')}</g></svg>
`;
fs.writeFileSync(out, svg);
console.log(`wrote ${out}`);
