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

/**
 * Turn a match into a percentage + confidence label for display.
 *
 * Takes the backend's *calibrated* confidence, not the raw cosine similarity.
 * Raw CLIP cosines can't be read as absolute scores: the text tower is
 * anisotropic (two unrelated captions score ~0.86) and the image/text modality
 * gap pushes genuine cross-modal matches down to ~0.6, so the same percentage
 * means opposite things depending on whether the items had photos. The backend
 * calibrates each hit against the other candidates for the same query and
 * returns a 0..1 confidence; the raw cosine is still shown next to it for
 * transparency. See backend/src/services/matching.ts.
 *
 * `confidence` is null when the candidate pool was too small to calibrate
 * against — in that case we fall back to ranking alone.
 */
export function matchConfidence(confidence: number | null): {
  pct: number | null;
  label: string;
  tone: string;
} {
  if (confidence === null || Number.isNaN(confidence)) {
    return { pct: null, label: "Ranked by similarity", tone: "faint" };
  }
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  if (pct >= 80) return { pct, label: "Strong match", tone: "high" };
  if (pct >= 60) return { pct, label: "Likely match", tone: "mid" };
  if (pct >= 40) return { pct, label: "Possible match", tone: "low" };
  return { pct, label: "Weak match", tone: "faint" };
}
