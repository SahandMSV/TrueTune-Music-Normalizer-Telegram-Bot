import type { SearchHints } from "../inspection/hints.js";
import type { MbCandidate } from "../musicbrainz/types.js";
import {
  artistSimilarity,
  coreTokens,
  markerMismatches,
  titleSimilarity,
  versionMarkers,
  words,
} from "./text.js";

export type Confidence = "high" | "ambiguous" | "low";

export interface RankedCandidate {
  mbid: string;
  title: string;
  artist: string;
  lengthSec: number | null;
  year: number | null;
  disambiguation: string | null;
  score: number;
  titleSim: number;
  artistSim: number;
  swapped: boolean;
  durationDiffSec: number | null;
}

export interface Decision {
  confidence: Confidence;
  reason: string;
  ranked: RankedCandidate[];
  chosenMbid: string | null;
}

const MAX_RANKED = 5;
const TITLE_POINTS = 50;
const ARTIST_POINTS = 35;
const VERSION_PENALTY = 12;
const MAX_VERSION_PENALTIES = 2;

// A candidate whose title doesn't resemble the hint at all is "no match".
const MIN_TITLE_SIM = 0.5;

// All of these must hold for an automatic choice.
const HIGH_TITLE_SIM = 0.8;
const HIGH_ARTIST_SIM = 0.8;
const HIGH_SCORE = 80;
const HIGH_MARGIN = 10;
const MAX_DURATION_DIFF_SEC = 10;

interface Orientation {
  titleText: string;
  titleSim: number;
  artistSim: number;
  swapped: boolean;
}

function orient(
  titleText: string,
  artistText: string | null,
  candidate: MbCandidate,
  names: readonly string[],
  swapped: boolean,
): Orientation {
  return {
    titleText,
    titleSim: titleSimilarity(titleText, candidate.title),
    artistSim: artistText ? artistSimilarity(artistText, names) : 0,
    swapped,
  };
}

function basePoints(o: Orientation): number {
  return TITLE_POINTS * o.titleSim + ARTIST_POINTS * o.artistSim;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function scoreCandidate(
  hints: SearchHints,
  title: string,
  candidate: MbCandidate,
): RankedCandidate {
  const names = [
    candidate.artistCredit,
    ...candidate.artists.map((artist) => artist.name),
  ].filter((name) => name.length > 0);

  let best = orient(title, hints.artist, candidate, names, false);

  // "Title - Artist" filenames are common. Only filename-derived pairs are
  // swapped, because tags from the file itself have a defined order.
  if (
    hints.artist !== null &&
    hints.titleSource === "filename" &&
    hints.artistSource === "filename"
  ) {
    const swapped = orient(hints.artist, title, candidate, names, true);
    if (basePoints(swapped) > basePoints(best)) {
      best = swapped;
    }
  }

  let score = basePoints(best);

  const durationDiffSec =
    hints.durationSec !== null && candidate.lengthSec !== null
      ? Math.abs(hints.durationSec - candidate.lengthSec)
      : null;
  if (durationDiffSec !== null) {
    if (durationDiffSec <= 3) {
      score += 15;
    } else if (durationDiffSec <= 8) {
      score += 8;
    } else if (durationDiffSec > 20) {
      score -= 10;
    }
  }

  const mismatches = markerMismatches(
    versionMarkers(best.titleText),
    versionMarkers(candidate.title, candidate.disambiguation),
  );
  score -= Math.min(mismatches, MAX_VERSION_PENALTIES) * VERSION_PENALTY;

  return {
    mbid: candidate.mbid,
    title: candidate.title,
    artist: candidate.artistCredit,
    lengthSec: candidate.lengthSec,
    year: candidate.firstReleaseYear,
    disambiguation: candidate.disambiguation,
    score: round(Math.min(100, Math.max(0, score)), 1),
    titleSim: round(best.titleSim, 2),
    artistSim: round(best.artistSim, 2),
    swapped: best.swapped,
    durationDiffSec,
  };
}

// MusicBrainz lists the same recording many times (one per release), so
// candidates that are the same song by the same artist count only once.
function distinct(ranked: readonly RankedCandidate[]): RankedCandidate[] {
  const seen = new Set<string>();
  const unique: RankedCandidate[] = [];
  for (const entry of ranked) {
    const key = [
      coreTokens(entry.title).join(" "),
      words(entry.artist).join(" "),
      [...versionMarkers(entry.title, entry.disambiguation)].sort().join(","),
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }
  return unique;
}

function outcome(
  confidence: Confidence,
  reason: string,
  ranked: RankedCandidate[],
  chosen: RankedCandidate | null,
): Decision {
  return { confidence, reason, ranked, chosenMbid: chosen?.mbid ?? null };
}

// Deterministic: the same hints and candidates always give the same decision.
export function decide(
  hints: SearchHints,
  candidates: readonly MbCandidate[],
): Decision {
  const title = hints.title;
  if (title === null) {
    return outcome("low", "no_title", [], null);
  }

  const ranked = distinct(
    candidates
      .map((candidate) => scoreCandidate(hints, title, candidate))
      .sort((a, b) => b.score - a.score),
  ).slice(0, MAX_RANKED);

  const top = ranked[0];
  if (!top) {
    return outcome("low", "no_candidates", ranked, null);
  }
  if (top.titleSim < MIN_TITLE_SIM) {
    return outcome("low", "weak_match", ranked, null);
  }

  if (hints.artist === null) {
    return outcome("ambiguous", "no_artist_hint", ranked, null);
  }
  if (
    top.durationDiffSec !== null &&
    top.durationDiffSec > MAX_DURATION_DIFF_SEC
  ) {
    return outcome("ambiguous", "duration_mismatch", ranked, null);
  }

  const runnerUp = ranked[1];
  const margin = runnerUp ? top.score - runnerUp.score : Infinity;

  if (
    top.titleSim >= HIGH_TITLE_SIM &&
    top.artistSim >= HIGH_ARTIST_SIM &&
    top.score >= HIGH_SCORE &&
    margin >= HIGH_MARGIN
  ) {
    return outcome("high", "high_confidence", ranked, top);
  }

  return outcome(
    "ambiguous",
    margin < HIGH_MARGIN ? "close_candidates" : "partial_match",
    ranked,
    null,
  );
}
