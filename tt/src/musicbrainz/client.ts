import { MusicBrainzError, mbGet } from "./http.js";
import { normalizeRecording, normalizeSearchResponse } from "./normalize.js";
import type { MbRecording } from "./types.js";

const SEARCH_LIMIT = 25;
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function searchRecordings(
  query: string,
  limit: number = SEARCH_LIMIT,
): Promise<MbRecording[]> {
  const raw = await mbGet(
    "recording",
    { query, limit: String(limit) },
    SEARCH_TTL_MS,
  );
  const recordings = normalizeSearchResponse(raw);
  if (recordings === null) {
    throw new MusicBrainzError("Unexpected search response shape");
  }
  return recordings;
}

export interface RecordingExtras {
  isrcs: string[];
  spotifyUrls: string[];
}

// Search results don't carry URL relationships, so they need a lookup per recording.
export async function lookupRecordingExtras(
  mbid: string,
): Promise<RecordingExtras | null> {
  if (!MBID.test(mbid)) {
    return null;
  }

  let raw: unknown;
  try {
    // A space is encoded as "+", which is how MusicBrainz separates "inc" values.
    raw = await mbGet(
      `recording/${mbid}`,
      { inc: "isrcs url-rels" },
      LOOKUP_TTL_MS,
    );
  } catch (err) {
    if (err instanceof MusicBrainzError && err.status === 404) {
      return null;
    }
    throw err;
  }

  const recording = normalizeRecording(raw);
  if (!recording) {
    return null;
  }
  return { isrcs: recording.isrcs, spotifyUrls: recording.spotifyUrls };
}
