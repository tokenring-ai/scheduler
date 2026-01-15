const INTERVALS: Record<string, number> = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600,
  day: 86400, days: 86400,
};

export function parseInterval(interval: string): number | null {
  const match = interval.match(/^\s*(\d+)\s+(\w+)\s*$/);
  if (!match) return null;
  const [, num, unit] = match;
  const multiplier = INTERVALS[unit.toLowerCase()];
  return multiplier ? parseInt(num) * multiplier : null;
}