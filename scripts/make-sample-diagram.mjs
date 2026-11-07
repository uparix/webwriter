// Writes the example book's sample diagram, images/book-folder.drawio.svg: an SVG that draw.io can
// open and edit, because the diagram itself is kept in the SVG's `content` attribute, as draw.io's
// "Editable SVG" export does. Labels are plain SVG text, so Word draws them too.
import fs from 'node:fs';

const out = process.argv[2] || 'examples/mybook/images/book-folder.drawio.svg';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const folder = { fill: '#FFF2CC', stroke: '#D6B656' };
const file = { fill: '#F5F5F5', stroke: '#666666' };
const top = { id: 'book', label: 'my-book/', x: 245, y: 20, w: 140, h: 40, ...folder, bold: true };
const children = [
  ['book-json', 'book.json', file], ['manuscript', 'manuscript/', folder], ['images', 'images/', folder],
  ['comments-json', 'comments.json', file], ['tags-json', 'tags.json', file],
].map(([id, label, look], i) => ({ id, label, x: 20 + i * 120, y: 120, w: 110, h: 40, ...look }));
const notes = ['the title', 'one .md per section', 'pictures, diagrams', 'review comments', 'tag colors'];
const width = 630;
const height = 200;

// The draw.io model.
const cell = (b) => `<mxCell id="${b.id}" value="${esc(b.label)}" style="rounded=1;arcSize=12;whiteSpace=wrap;html=0;fillColor=${b.fill};strokeColor=${b.stroke};fontFamily=Helvetica;fontSize=12;${b.bold ? 'fontStyle=1;' : ''}" vertex="1" parent="1"><mxGeometry x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" as="geometry"/></mxCell>`;
const edge = (c) => `<mxCell id="to-${c.id}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;endArrow=block;endFill=1;strokeColor=#666666;" edge="1" parent="1" source="book" target="${c.id}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const note = (c, i) => `<mxCell id="note-${c.id}" value="${esc(notes[i])}" style="text;html=0;align=center;verticalAlign=top;fontFamily=Helvetica;fontSize=10;fontColor=#666666;" vertex="1" parent="1"><mxGeometry x="${c.x - 5}" y="${c.y + c.h + 4}" width="${c.w + 10}" height="20" as="geometry"/></mxCell>`;
const model = `<mxfile host="Webwriter" type="device"><diagram id="book-folder" name="Book folder"><mxGraphModel dx="800" dy="400" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cell(top)}${children.map(cell).join('')}${children.map(edge).join('')}${children.map(note).join('')}</root></mxGraphModel></diagram></mxfile>`;

// The drawing, from the same coordinates.
const font = 'font-family="Helvetica, Arial, sans-serif"';
const box = (b) => `<rect x="${b.x + 0.5}" y="${b.y + 0.5}" width="${b.w}" height="${b.h}" rx="4.8" fill="${b.fill}" stroke="${b.stroke}"/>`
  + `<text x="${b.x + b.w / 2 + 0.5}" y="${b.y + b.h / 2 + 4.5}" text-anchor="middle" ${font} font-size="12"${b.bold ? ' font-weight="bold"' : ''} fill="#000000">${esc(b.label)}</text>`;
const midX = top.x + top.w / 2 + 0.5;
const line = (c) => {
  const x = c.x + c.w / 2 + 0.5;
  return `<path d="M ${midX} ${top.y + top.h + 0.5} L ${midX} 90.5 L ${x} 90.5 L ${x} ${c.y - 6}" fill="none" stroke="#666666"/>`
    + `<path d="M ${x - 4} ${c.y - 7} L ${x} ${c.y + 0.5} L ${x + 4} ${c.y - 7} Z" fill="#666666" stroke="#666666"/>`;
};
const label = (c, i) => `<text x="${c.x + c.w / 2 + 0.5}" y="${c.y + c.h + 16}" text-anchor="middle" ${font} font-size="10" fill="#666666">${esc(notes[i])}</text>`;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}px" height="${height}px" viewBox="-0.5 -0.5 ${width} ${height}" content="${esc(model)}"><defs/><g>${children.map(line).join('')}${box(top)}${children.map(box).join('')}${children.map(label).join('')}</g></svg>
`;
fs.writeFileSync(out, svg);
console.log(`wrote ${out}`);
