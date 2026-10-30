import type { SearchHints } from "../inspection/hints.js";
import { logger } from "../logger.js";
import { lookupRecordingExtras, searchRecordings } from "./client.js";
import {
  buildFallbackQuery,
  buildIsrcQuery,
  buildStrictQuery,
} from "./queries.js";
import type {
  CandidateVia,
  MatchQuery,
  MbCandidate,
  MbRecording,
} from "./types.js";

const MAX_CANDIDATES = 25;

// MusicBrainz scores each query's best hit near 100. Below this, the strict
// query found nothing convincing and the fallback query is tried too.
const STRONG_SCORE = 90;

export interface SearchOutcome {
  queries: MatchQuery[];
  candidates: MbCandidate[];
}

function toCandidates(
  recordings: MbRecording[],
  via: CandidateVia,
): MbCandidate[] {
  return recordings.map((recording) => ({
    ...recording,
    via,
    enriched: false,
  }));
}

function mergeCandidates(groups: MbCandidate[][]): MbCandidate[] {
  const byId = new Map<string, MbCandidate>();
  for (const candidate of groups.flat()) {
    const existing = byId.get(candidate.mbid);
    if (!existing || candidate.searchScore > existing.searchScore) {
      byId.set(candidate.mbid, candidate);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, MAX_CANDIDATES);
}

// An exact ISRC hit is used on its own. Otherwise title and artist are searched.
// Ranking and the final choice happen later: this only gathers candidates.
export async function findCandidates(
  hints: SearchHints,
): Promise<SearchOutcome> {
  const queries: MatchQuery[] = [];
  const groups: MbCandidate[][] = [];

  async function run(
    kind: CandidateVia,
    query: string,
  ): Promise<MbCandidate[]> {
    const found = toCandidates(await searchRecordings(query), kind);
    queries.push({ kind, query, resultCount: found.length });
    groups.push(found);
    return found;
  }

  if (hints.isrc) {
    const byIsrc = await run("isrc", buildIsrcQuery(hints.isrc));
    if (byIsrc.length > 0) {
      return { queries, candidates: mergeCandidates(groups) };
    }
  }

  if (hints.title === null) {
    return { queries, candidates: [] };
  }

  const strict = await run(
    "search",
    buildStrictQuery(hints.title, hints.artist),
  );

  if (!strict.some((candidate) => candidate.searchScore >= STRONG_SCORE)) {
    const fallback = buildFallbackQuery(hints.title, hints.artist);
    if (fallback) {
      await run("search_fallback", fallback);
    }
  }

  return { queries, candidates: mergeCandidates(groups) };
}

// Adds ISRCs and Spotify relationships to the first `count` candidates.
// A failed lookup leaves that candidate unenriched instead of failing the job.
export async function enrichCandidates(
  candidates: MbCandidate[],
  count: number,
): Promise<MbCandidate[]> {
  const result = candidates.map((candidate) => ({ ...candidate }));

  for (const candidate of result.slice(0, count)) {
    try {
      const extras = await lookupRecordingExtras(candidate.mbid);
      if (!extras) {
        continue;
      }
      candidate.isrcs = [...new Set([...candidate.isrcs, ...extras.isrcs])];
      candidate.spotifyUrls = extras.spotifyUrls;
      candidate.enriched = true;
    } catch (err) {
      logger.warn(
        {
          mbid: candidate.mbid,
          reason: err instanceof Error ? err.message : "unknown",
        },
        "Could not enrich candidate",
      );
    }
  }

  return result;
}
