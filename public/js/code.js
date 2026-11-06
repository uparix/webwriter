// A small tokenizer for code blocks: comments, strings, numbers, keywords, and types.

const words = (list) => new Set(list.split(' '));
const C_FAMILY = ['//'];

function language(name) {
  switch (name.toLowerCase()) {
    case 'java': case 'kotlin': case 'scala':
      return { keywords: words('abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while var val fun object null true false record sealed permits yield'), line: C_FAMILY, block: ['/*', '*/'] };
    case 'swift':
      return { keywords: words('actor as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate final for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws true try typealias var where while any'), line: C_FAMILY, block: ['/*', '*/'] };
    case 'js': case 'javascript': case 'ts': case 'typescript': case 'jsx': case 'tsx':
      return { keywords: words('as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while yield'), line: C_FAMILY, block: ['/*', '*/'] };
    case 'c': case 'cpp': case 'c++': case 'objc': case 'objective-c': case 'cs': case 'csharp': case 'go': case 'rust': case 'rs':
      return { keywords: words('auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace new delete public private protected template this true false nullptr using virtual fn let mut impl trait pub use mod match loop crate self Self func package import type var go chan defer select range map interface string bool'), line: C_FAMILY, block: ['/*', '*/'] };
    case 'python': case 'py':
      return { keywords: words('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self'), line: ['#'], block: null };
    case 'ruby': case 'rb':
      return { keywords: words('alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield'), line: ['#'], block: null };
    case 'bash': case 'sh': case 'shell': case 'zsh':
      return { keywords: words('if then else elif fi case esac for while until do done in function return export local echo exit set unset'), line: ['#'], block: null };
    case 'yaml': case 'yml': case 'toml':
      return { keywords: words('true false null yes no on off'), line: ['#'], block: null };
    case 'json':
      return { keywords: words('true false null'), line: [], block: null };
    case 'clojure': case 'clj': case 'lisp': case 'scheme':
      return { keywords: words('def defn defmacro let fn if do loop recur cond when ns require nil true false'), line: [';'], block: null };
    case 'sql':
      return { keywords: words('select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit and or not null as distinct SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT AND OR NOT NULL AS DISTINCT'), line: ['--'], block: ['/*', '*/'] };
    case 'css': case 'scss':
      return { keywords: new Set(), line: [], block: ['/*', '*/'] };
    case 'html': case 'xml':
      return { keywords: new Set(), line: [], block: ['<!--', '-->'] };
    default:
      return null;
  }
}

const isDigit = (c) => c >= '0' && c <= '9';
const isWordStart = (c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '?';
const isWord = (c) => isWordStart(c) || isDigit(c) || c === '!';

/** Token ranges [start, end, kind] in the code. */
export function codeTokens(code, name) {
  const lang = language(name);
  if (!lang) return [];
  const out = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const lineComment = lang.line.find((t) => code.startsWith(t, i));
    if (lineComment) {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? code.length : end;
      out.push([i, stop, 'comment']);
      i = stop;
      continue;
    }
    if (lang.block && code.startsWith(lang.block[0], i)) {
      const found = code.indexOf(lang.block[1], i + lang.block[0].length);
      const stop = found < 0 ? code.length : found + lang.block[1].length;
      out.push([i, stop, 'comment']);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let end = i + 1;
      while (end < code.length) {
        const d = code[end];
        if (d === '\\') {
          end += 2;
          continue;
        }
        if (d === c || d === '\n') break;
        end += 1;
      }
      const stop = Math.min(code.length, end + 1);
      out.push([i, stop, 'string']);
      i = stop;
      continue;
    }
    if (isDigit(c) && (i === 0 || !isWord(code[i - 1]))) {
      let end = i;
      while (end < code.length && (isWord(code[end]) || code[end] === '.')) end += 1;
      out.push([i, end, 'number']);
      i = end;
      continue;
    }
    if (isWordStart(c)) {
      let end = i;
      while (end < code.length && isWord(code[end])) end += 1;
      const word = code.slice(i, end);
      if (lang.keywords.has(word)) out.push([i, end, 'keyword']);
      else if (word[0] >= 'A' && word[0] <= 'Z') out.push([i, end, 'type']);
      i = end;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Mapped code as HTML, with each token in a span of its kind. */
export function highlightCode(mapped, name, emit) {
  const tokens = codeTokens(mapped.text, name);
  let html = '';
  let at = 0;
  for (const [start, end, kind] of tokens) {
    if (start > at) html += emit(mapped.slice(at, start));
    html += `<span class="tok-${kind}">${emit(mapped.slice(start, end))}</span>`;
    at = end;
  }
  return html + emit(mapped.slice(at));
}
