// draw.io's SVG exports, made into the pictures the book keeps.

/**
 * An SVG from draw.io with its light colors only. draw.io writes colors as `light-dark(light, dark)`
 * and marks the SVG `color-scheme: light dark`, so a browser in dark mode would draw it in its dark
 * colors on the book's white paper, and Pandoc's SVG converter for Word does not know `light-dark()`.
 */
export function lightOnly(svg) {
  let out = '';
  let at = 0;
  for (;;) {
    const start = svg.indexOf('light-dark(', at);
    if (start < 0) return (out + svg.slice(at)).replace(/color-scheme:\s*light\s+dark/g, 'color-scheme: light');
    // The first argument ends at the first comma outside nested parentheses, such as rgb(…).
    let depth = 0;
    let i = start + 'light-dark('.length;
    const first = i;
    let comma = -1;
    for (; i < svg.length; i += 1) {
      const c = svg[i];
      if (c === '(') depth += 1;
      else if (c === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (c === ',' && depth === 0 && comma < 0) comma = i;
    }
    if (i >= svg.length || comma < 0) return out + svg.slice(at);
    out += svg.slice(at, start) + svg.slice(first, comma).trim();
    at = i + 1;
  }
}

/**
 * draw.io ends an SVG with formatted labels with a link that says "Text is not SVG - cannot display",
 * for programs that cannot show such labels. Browsers never show it, but Word's picture of the
 * diagram does, over the labels. Each label carries plain text for those programs anyway.
 */
export function withoutTextWarning(svg) {
  return svg.replace(/<switch><g requiredFeatures="[^"]*"\s*\/><a [^>]*svg-export-text-problems[^>]*>[\s\S]*?<\/a><\/switch>/g, '');
}

/** An SVG from draw.io as the book keeps it: in its light colors, without the warning link. */
export const bookSVG = (svg) => withoutTextWarning(lightOnly(svg));
