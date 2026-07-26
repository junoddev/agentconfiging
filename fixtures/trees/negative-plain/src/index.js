export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
