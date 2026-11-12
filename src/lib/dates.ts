function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function nowStamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatStamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0) {
      return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} 00:00:00`;
    }
    return nowStamp(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
    );
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]} ${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return nowStamp(parsed);
  }

  return null;
}

export function parseDiaryDate(filename: string): string | null {
  const match = filename.match(/^(\d{2})(\d{2})(\d{2})\.md$/);
  if (!match) return null;
  return `20${match[1]}-${match[2]}-${match[3]} 00:00:00`;
}
