import crypto from 'node:crypto';

export interface HashParts {
  title: string;
  contentMd: string;
  categoryId: number | null;
  tags: string[];
  description: string | null;
  topImg: string;
  postDate: string;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function newAbbrlink(existing: Set<string>): string {
  for (;;) {
    const value = crypto.randomBytes(4).toString('hex');
    if (!existing.has(value)) {
      existing.add(value);
      return value;
    }
  }
}

export function contentHash(parts: HashParts): string {
  const canonical = JSON.stringify({
    ...parts,
    tags: [...parts.tags].sort(),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
