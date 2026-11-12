import { describe, it, expect } from 'vitest';
import { formatStamp, nowStamp, parseDiaryDate } from '../src/lib/dates';

describe('dates', () => {
  it('formats date-only YAML values without timezone drift', () => {
    expect(formatStamp(new Date('2026-11-12T00:00:00.000Z'))).toBe('2026-11-12 00:00:00');
  });

  it('preserves string timestamps', () => {
    expect(formatStamp('2026-11-12 10:20:30')).toBe('2026-11-12 10:20:30');
    expect(formatStamp('2026-11-12')).toBe('2026-11-12 00:00:00');
  });

  it('parses diary filenames', () => {
    expect(parseDiaryDate('261112.md')).toBe('2026-11-12 00:00:00');
    expect(parseDiaryDate('not-a-date.md')).toBeNull();
  });

  it('rejects invalid values', () => {
    expect(formatStamp('nonsense')).toBeNull();
    expect(formatStamp(undefined)).toBeNull();
  });

  it('formats now as YYYY-MM-DD HH:mm:ss', () => {
    expect(nowStamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
