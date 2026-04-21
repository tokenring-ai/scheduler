export interface ParsedLoopCommand {
  prompt: string;
  repeat: string;
  displayInterval: string;
  note?: string | undefined;
}

const DEFAULT_INTERVAL = "10 minutes";
const LOOP_INTERVAL_PATTERN = "(\\d+)\\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)";

function formatInterval(value: number, unit: "minute" | "hour" | "day"): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function normalizeLoopInterval(rawInterval: string): Omit<ParsedLoopCommand, "prompt"> | null {
  const match = rawInterval.trim().match(new RegExp(`^${LOOP_INTERVAL_PATTERN}$`, "i"));
  if (!match) return null;

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) return null;

  if (["s", "sec", "secs", "second", "seconds"].includes(unit)) {
    const roundedMinutes = Math.ceil(value / 60);
    return {
      repeat: formatInterval(roundedMinutes, "minute"),
      displayInterval: formatInterval(roundedMinutes, "minute"),
      note: `Rounded ${value} second${value === 1 ? "" : "s"} up to ${formatInterval(roundedMinutes, "minute")} to match minute-based scheduling.`,
    };
  }

  if (["m", "min", "mins", "minute", "minutes"].includes(unit)) {
    return {
      repeat: formatInterval(value, "minute"),
      displayInterval: formatInterval(value, "minute"),
    };
  }

  if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) {
    return {
      repeat: formatInterval(value, "hour"),
      displayInterval: formatInterval(value, "hour"),
    };
  }

  if (["d", "day", "days"].includes(unit)) {
    return {
      repeat: formatInterval(value, "day"),
      displayInterval: formatInterval(value, "day"),
    };
  }

  return null;
}

export function parseLoopCommand(input: string): ParsedLoopCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (normalizeLoopInterval(trimmed)) return null;

  const leadingMatch = trimmed.match(new RegExp(`^${LOOP_INTERVAL_PATTERN}\\s+([\\s\\S]+)$`, "i"));
  if (leadingMatch) {
    const parsedInterval = normalizeLoopInterval(`${leadingMatch[1]} ${leadingMatch[2]}`);
    const prompt = leadingMatch[3].trim();
    if (!parsedInterval || !prompt) return null;

    return {
      prompt,
      ...parsedInterval,
    };
  }

  const trailingMatch = trimmed.match(new RegExp(`^([\\s\\S]+?)\\s+every\\s+${LOOP_INTERVAL_PATTERN}$`, "i"));
  if (trailingMatch) {
    const prompt = trailingMatch[1].trim();
    const parsedInterval = normalizeLoopInterval(`${trailingMatch[2]} ${trailingMatch[3]}`);
    if (!parsedInterval || !prompt) return null;

    return {
      prompt,
      ...parsedInterval,
    };
  }

  return {
    prompt: trimmed,
    repeat: DEFAULT_INTERVAL,
    displayInterval: DEFAULT_INTERVAL,
  };
}
