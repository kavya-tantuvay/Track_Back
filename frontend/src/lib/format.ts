export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = secs;
  let unit = "second";
  for (const [size, name] of units) {
    if (Math.abs(value) < size) {
      unit = name;
      break;
    }
    value = Math.floor(value / size);
    unit = name;
  }
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return rtf.format(-value, unit as Intl.RelativeTimeFormatUnit);
}

/** Turn a 0..1 similarity into a friendly percentage + confidence label. */
export function matchConfidence(score: number): { pct: number; label: string; tone: string } {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  if (pct >= 80) return { pct, label: "Strong match", tone: "high" };
  if (pct >= 60) return { pct, label: "Likely match", tone: "mid" };
  if (pct >= 40) return { pct, label: "Possible match", tone: "low" };
  return { pct, label: "Weak match", tone: "faint" };
}
