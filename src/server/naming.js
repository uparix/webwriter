// Slugs, ids, and number prefixes.

/** Lowercase words separated by hyphens, with punctuation removed. */
export function slugify(title) {
  let slug = '';
  let pendingHyphen = false;
  for (const c of title.toLowerCase()) {
    if (c === "'" || c === '’') continue;
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
      if (pendingHyphen && slug !== '') slug += '-';
      pendingHyphen = false;
      slug += c;
    } else {
      pendingHyphen = true;
    }
  }
  return slug === '' ? 'section' : slug;
}

export function uniqueID(title, used) {
  const base = slugify(title);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export const pad = (n, width) => String(n).padStart(width, '0');

/** Sibling prefixes step by 10 with at least three digits. Past 990 the width grows. */
export function assignPrefixes(count) {
  let width = 3;
  while (count * 10 >= 10 ** width) width += 1;
  return Array.from({ length: count }, (_, i) => pad((i + 1) * 10, width));
}

export function nextPrefix(existing) {
  const numbers = existing.filter((p) => /^\d+$/.test(p)).map(Number);
  const n = (numbers.length ? Math.max(...numbers) : 0) + 10;
  return pad(n, Math.max(3, String(n).length));
}
