export type CandidateVia = "isrc" | "search" | "search_fallback";

export interface MbArtist {
  mbid: string;
  name: string;
}

export interface MbRelease {
  mbid: string;
  title: string;
  date: string | null;
  country: string | null;
  status: string | null;
  primaryType: string | null;
  secondaryTypes: string[];
}

export interface MbRecording {
  mbid: string;
  title: string;
  artistCredit: string;
  artists: MbArtist[];
  lengthSec: number | null;
  disambiguation: string | null;
  firstReleaseYear: number | null;
  searchScore: number;
  isrcs: string[];
  releases: MbRelease[];
  spotifyUrls: string[];
}

export interface MbCandidate extends MbRecording {
  via: CandidateVia;
  enriched: boolean;
}

export interface MatchQuery {
  kind: CandidateVia;
  query: string;
  resultCount: number;
}

export interface MatchData {
  state: "searched" | "skipped";
  reason: string | null;
  queries: MatchQuery[];
  candidates: MbCandidate[];
  searchedAt: Date;
}
