import { describe, it, expect } from 'vitest';
import {
  isManagedPath,
  isSafeRelativePath,
  renderPostMarkdown,
} from '../src/lib/publish-format';

describe('publish-format', () => {
  it('rejects unsafe relative paths', () => {
    expect(isSafeRelativePath('网安/信息收集.md')).toBe(true);
    expect(isSafeRelativePath('source/_posts/x.md')).toBe(true);
    expect(isSafeRelativePath('../evil.md')).toBe(false);
    expect(isSafeRelativePath('/abs.md')).toBe(false);
    expect(isSafeRelativePath('a\\b.md')).toBe(false);
    expect(isSafeRelativePath('a/../b.md')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
  });

  it('recognizes managed prefixes', () => {
    expect(isManagedPath('source/_posts/a.md')).toBe(true);
    expect(isManagedPath('source/img/uploads/x.png')).toBe(true);
    expect(isManagedPath('themes/butterfly/_config.yml')).toBe(false);
    expect(isManagedPath('_config.yml')).toBe(false);
  });

  it('renders Hexo frontmatter and body', () => {
    const markdown = renderPostMarkdown(
      {
        title: '信息收集',
        contentMd: '## 域名\n\n内容\n',
        postDate: '2026-11-12 10:00:00',
        updatedAt: '2026-11-12 11:00:00',
        topImg: 'false',
        description: 'desc',
        abbrlink: '312e3d12',
      },
      '网安',
      ['信息收集', '谷歌'],
    );
    expect(markdown).toContain('title: 信息收集');
    expect(markdown).toMatch(/date: ['"]?2026-11-12 10:00:00['"]?/);
    expect(markdown).toMatch(/updated: ['"]?2026-11-12 11:00:00['"]?/);
    expect(markdown).toContain('categories: 网安');
    expect(markdown).toContain('top_img: false');
    expect(markdown).toContain('abbrlink: 312e3d12');
    expect(markdown).toContain('  - 信息收集');
    expect(markdown).toContain('  - 谷歌');
    expect(markdown).toMatch(/---\n\n## 域名/);
  });

  it('omits empty tags and description and quotes all-digit abbrlinks', () => {
    const markdown = renderPostMarkdown(
      {
        title: 'T',
        contentMd: 'body',
        postDate: '2026-11-12 00:00:00',
        updatedAt: '2026-11-12 00:00:00',
        topImg: 'https://example.com/a.png',
        description: null,
        abbrlink: '12345678',
      },
      '未分类',
      [],
    );
    expect(markdown).not.toContain('tags:');
    expect(markdown).not.toContain('description:');
    expect(markdown).toMatch(/top_img: ['"]?https:\/\/example\.com\/a\.png['"]?/);
    expect(markdown).toContain("abbrlink: '12345678'");
  });
});
