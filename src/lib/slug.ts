const UNSAFE = /[^\p{L}\p{N}._-]+/gu;

export function slugify(input: string): string {
  const value = input
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(UNSAFE, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return value || 'post';
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  const value = `${base}-${index}`;
  taken.add(value);
  return value;
}
