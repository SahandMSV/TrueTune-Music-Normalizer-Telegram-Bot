import {
  artistSimilarity,
  markerMismatches,
  titleSimilarity,
  versionMarkers,
} from "./text.js";

// Provider results are labelled "Artist - Title".
const LABEL = /^(.*?)\s+-\s+(.*)$/s;

const MIN_TITLE_SIM = 0.8;
const MIN_ARTIST_SIM = 0.6;
const MIN_SCORE = 0.75;
const MISMATCH_PENALTY = 0.35;

// Returns every provider result that plausibly is the target recording, best
// first. On equal scores the provider's own order wins.
export function rankProviderResults<T extends { label: string }>(
  items: readonly T[],
  target: { title: string; artist: string },
): T[] {
  const wanted = versionMarkers(target.title);
  const scored: { item: T; score: number; index: number }[] = [];

  for (const [index, item] of items.entries()) {
    const parts = LABEL.exec(item.label);
    const artistPart = parts?.[1];
    const titlePart = parts?.[2];
    if (!artistPart || !titlePart) {
      continue;
    }

    const titleSim = titleSimilarity(target.title, titlePart);
    const artistSim = artistSimilarity(target.artist, [artistPart]);
    if (titleSim < MIN_TITLE_SIM || artistSim < MIN_ARTIST_SIM) {
      continue;
    }

    const mismatches = markerMismatches(wanted, versionMarkers(titlePart));
    const score =
      0.6 * titleSim + 0.4 * artistSim - MISMATCH_PENALTY * mismatches;
    if (score < MIN_SCORE) {
      continue;
    }

    scored.push({ item, score, index });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
