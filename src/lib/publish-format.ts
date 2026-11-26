import * as yaml from 'js-yaml';

export interface RenderPost {
  title: string;
  contentMd: string;
  postDate: string;
  updatedAt: string;
  topImg: string;
  description: string | null;
  abbrlink: string;
}

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  return value
    .split('/')
    .every((segment) => segment && segment !== '.' && segment !== '..');
}

export function isManagedPath(value: string): boolean {
  return value.startsWith('source/_posts/') || value.startsWith('source/img/uploads/');
}

export function renderPostMarkdown(post: RenderPost, categoryName: string, tags: string[]): string {
  const data: Record<string, unknown> = {
    title: post.title,
    date: post.postDate,
    updated: post.updatedAt,
  };
  if (tags.length > 0) data.tags = tags;
  data.categories = categoryName;
  data.top_img = post.topImg === 'false' ? false : post.topImg;
  if (post.description) data.description = post.description;
  data.abbrlink = post.abbrlink;

  const front = yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false });
  const body = post.contentMd.replace(/\r\n/g, '\n').trimEnd();
  return `---\n${front}---\n\n${body}\n`;
}
