export type HintSource = "telegram_tags" | "filename" | "embedded_tags";

export interface SearchHints {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
  isrc: string | null;
  titleSource: HintSource | null;
  artistSource: HintSource | null;
}

export interface HintCandidate {
  source: HintSource;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  durationSec?: number | null;
  isrc?: string | null;
}

interface TelegramSource {
  title?: string | null;
  performer?: string | null;
  durationSec?: number | null;
}

const PLACEHOLDERS = new Set([
  "unknown",
  "unknown artist",
  "unknown title",
  "<unknown>",
  "untitled",
  "various artists",
]);

export function cleanTagValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0 || cleaned.length > 200) {
    return null;
  }
  if (PLACEHOLDERS.has(cleaned.toLowerCase())) {
    return null;
  }
  return cleaned;
}

export function normalizeIsrc(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(compact) ? compact : null;
}

function cleanDuration(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export function hintsFromTelegram(source: TelegramSource): HintCandidate {
  return {
    source: "telegram_tags",
    title: source.title,
    artist: source.performer,
    durationSec: source.durationSec,
  };
}

// Candidates are given in priority order; each field takes the first usable value.
export function mergeHints(candidates: readonly HintCandidate[]): SearchHints {
  const hints: SearchHints = {
    title: null,
    artist: null,
    album: null,
    durationSec: null,
    isrc: null,
    titleSource: null,
    artistSource: null,
  };

  for (const candidate of candidates) {
    const title = cleanTagValue(candidate.title);
    if (hints.title === null && title !== null) {
      hints.title = title;
      hints.titleSource = candidate.source;
    }

    const artist = cleanTagValue(candidate.artist);
    if (hints.artist === null && artist !== null) {
      hints.artist = artist;
      hints.artistSource = candidate.source;
    }

    if (hints.album === null) {
      hints.album = cleanTagValue(candidate.album);
    }
    if (hints.durationSec === null) {
      hints.durationSec = cleanDuration(candidate.durationSec);
    }
    if (hints.isrc === null) {
      hints.isrc = normalizeIsrc(candidate.isrc);
    }
  }

  return hints;
}
