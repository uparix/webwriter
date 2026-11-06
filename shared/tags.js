// Tags: colored labels in the text, written as Pandoc spans with the `tag` class:
// `[draft]{.tag}`, or `[urgent]{.tag color=red}` with a color of its own.
// The book's tag colors live in `tags.json` beside `book.json`:
//
//   {
//     "tags" : {
//       "draft" : "yellow"
//     },
//     "version" : 1
//   }
//
// A tag without a color there gets one picked from its name, so it is always the same.
import { stableStringify } from './comments.js';
import { codeSpans, insideSpans } from './fences.js';

export const TAGS_FILE = 'tags.json';

/** Light enough for dark text on them, like the comment colors. */
export const TAG_COLORS = {
  yellow: '#FFE86B', orange: '#FFD09E', red: '#FFB3B3', pink: '#FFC2D6', purple: '#D6C2FF',
  blue: '#ADD9FF', teal: '#A8E6DF', green: '#B8EB9E', gray: '#DCDCE0',
};
export const TAG_COLOR_NAMES = Object.keys(TAG_COLORS);

/** A named color or `#RRGGBB` as `#RRGGBB`, or null when it is neither. */
export function colorValue(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  if (TAG_COLORS[value.toLowerCase()]) return TAG_COLORS[value.toLowerCase()];
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : null;
}

/** The color a tag gets when `tags.json` names none: the same one for the same name, every time. */
export function autoColor(name) {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return TAG_COLOR_NAMES[hash % TAG_COLOR_NAMES.length];
}

/** The color to draw a tag in: its own `color=` first, then `tags.json`, then the automatic one. */
export function tagColor(name, definitions = {}, own = null) {
  return colorValue(own) || colorValue(definitions[normalizeTag(name)]) || TAG_COLORS[autoColor(name)];
}

/** Tags are matched without regard to case or surrounding spaces. */
export function normalizeTag(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** What a tag's name may hold: no brackets, braces, or line breaks. */
export function cleanTagName(name) {
  return name.replace(/[[\]{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pandoc attributes `{.tag color=red}`: whether they make a tag, and its own color. */
export function tagAttributes(attributes) {
  const classes = [...attributes.matchAll(/(?:^|\s)\.([\w-]+)/g)].map((m) => m[1]);
  const color = /(?:^|\s)color=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(attributes);
  return { isTag: classes.includes('tag'), color: color ? (color[1] ?? color[2] ?? color[3]) : null };
}

/** `[name]{.tag}`: the markup for a tag, with its own color when one is given. */
export function tagMarkup(name, color = null) {
  return `[${cleanTagName(name)}]{.tag${color ? ` color=${color}` : ''}}`;
}

const TAG = /\[([^\]\n]+)\]\{([^}\n]*)\}/g;

/** Every tag in a text outside code: { name, color, start, end, nameStart }. */
export function tagsIn(text) {
  const found = [];
  let fenced = false;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced) {
      const spans = codeSpans(line);
      for (const m of line.matchAll(TAG)) {
        const attributes = tagAttributes(m[2]);
        if (!attributes.isTag || insideSpans(m.index, spans) || line[m.index - 1] === '!') continue;
        found.push({
          name: m[1], color: attributes.color, start: offset + m.index, end: offset + m.index + m[0].length, nameStart: offset + m.index + 1,
        });
      }
    }
    offset += line.length + 1;
  }
  return found;
}

// MARK: tags.json

/** The colors in a `tags.json`, by normalized tag name. Throws when the file is not valid, with the reason. */
export function decodeTags(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The JSON is not valid. ${error.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('The top level is not an object.');
  if (data.version !== 1) throw new Error('"version" is missing or is not 1.');
  if (data.tags === null || typeof data.tags !== 'object' || Array.isArray(data.tags)) throw new Error('"tags" is missing or is not an object.');
  const tags = {};
  for (const [name, color] of Object.entries(data.tags)) {
    if (!colorValue(color)) throw new Error(`The color of "${name}" is not one of ${TAG_COLOR_NAMES.join(', ')}, or #RRGGBB.`);
    tags[normalizeTag(name)] = color;
  }
  return tags;
}

/** The text of `tags.json`, in the layout of the other book files, with a newline at the end. */
export function encodeTags(tags) {
  return stableStringify({ tags, version: 1 }) + '\n';
}

/**
 * Markdown with every tag's color written into it as `#RRGGBB`, from its own color, `tags.json`, or
 * its name. For Pandoc's Word export, which draws tags with the color it is given.
 */
export function resolveTagColors(markdown, definitions = {}) {
  let out = '';
  let at = 0;
  for (const tag of tagsIn(markdown)) {
    out += `${markdown.slice(at, tag.start)}[${tag.name}]{.tag color=${tagColor(tag.name, definitions, tag.color)}}`;
    at = tag.end;
  }
  return out + markdown.slice(at);
}

/** The tag commands, for the menu, the palette, and the reminder. */
export const TAG_COMMANDS = [
  { id: 'tag', name: 'Tag', shortcut: '⌥⌘T', inserts: '[name]{.tag}, a colored tag, at the cursor' },
  { id: 'tagColors', name: 'Tag Colors', inserts: 'The color of every tag in the book, kept in tags.json' },
];
