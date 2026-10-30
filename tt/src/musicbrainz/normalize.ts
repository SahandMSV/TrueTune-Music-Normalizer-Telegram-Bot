import { z } from "zod";
import { normalizeIsrc } from "../inspection/hints.js";
import type { MbRecording, MbRelease } from "./types.js";

const MAX_RELEASES = 20;

// Matches track links only, including localized "intl-xx" URLs.
const SPOTIFY_TRACK =
  /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})(?:[/?#]|$)/;

const releaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().nullish(),
  date: z.string().nullish(),
  country: z.string().nullish(),
  "release-group": z
    .object({
      "primary-type": z.string().nullish(),
      "secondary-types": z.array(z.string()).nullish(),
    })
    .nullish(),
});

// Search results list isrcs as objects, lookups list them as plain strings.
const recordingSchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().optional(),
  length: z.number().nullish(),
  disambiguation: z.string().nullish(),
  "first-release-date": z.string().nullish(),
  "artist-credit": z
    .array(
      z.object({
        name: z.string().nullish(),
        joinphrase: z.string().nullish(),
        artist: z.object({ id: z.string(), name: z.string() }).nullish(),
      }),
    )
    .nullish(),
  isrcs: z.array(z.union([z.string(), z.object({ id: z.string() })])).nullish(),
  releases: z.array(z.unknown()).nullish(),
  relations: z
    .array(z.object({ url: z.object({ resource: z.string() }).nullish() }))
    .nullish(),
});

const searchResponseSchema = z.object({
  recordings: z.array(z.unknown()),
});

function toRelease(data: z.infer<typeof releaseSchema>): MbRelease {
  return {
    mbid: data.id,
    title: data.title,
    date: data.date ?? null,
    country: data.country ?? null,
    status: data.status ?? null,
    primaryType: data["release-group"]?.["primary-type"] ?? null,
    secondaryTypes: data["release-group"]?.["secondary-types"] ?? [],
  };
}

// Returns null for an entry that doesn't have the minimum shape,
// so one malformed recording never discards the rest.
export function normalizeRecording(raw: unknown): MbRecording | null {
  const parsed = recordingSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const r = parsed.data;

  const credit = r["artist-credit"] ?? [];
  const artistCredit = credit
    .map((c) => `${c.name ?? c.artist?.name ?? ""}${c.joinphrase ?? ""}`)
    .join("")
    .trim();
  const artists = credit.flatMap((c) =>
    c.artist ? [{ mbid: c.artist.id, name: c.artist.name }] : [],
  );

  const isrcs = [
    ...new Set(
      (r.isrcs ?? [])
        .map((value) =>
          normalizeIsrc(typeof value === "string" ? value : value.id),
        )
        .filter((value): value is string => value !== null),
    ),
  ];

  const releases = (r.releases ?? [])
    .flatMap((item) => {
      const release = releaseSchema.safeParse(item);
      return release.success ? [toRelease(release.data)] : [];
    })
    .slice(0, MAX_RELEASES);

  const spotify = new Set<string>();
  for (const relation of r.relations ?? []) {
    const match = relation.url
      ? SPOTIFY_TRACK.exec(relation.url.resource)
      : null;
    if (match?.[1]) {
      spotify.add(`https://open.spotify.com/track/${match[1]}`);
    }
  }

  const yearMatch = /^(\d{4})/.exec(r["first-release-date"] ?? "");

  return {
    mbid: r.id,
    title: r.title,
    artistCredit,
    artists,
    lengthSec: r.length && r.length > 0 ? Math.round(r.length / 1000) : null,
    disambiguation: r.disambiguation ? r.disambiguation : null,
    firstReleaseYear: yearMatch?.[1] ? Number(yearMatch[1]) : null,
    searchScore: r.score ?? 0,
    isrcs,
    releases,
    spotifyUrls: [...spotify],
  };
}

// Returns null if the response doesn't look like a search result at all.
export function normalizeSearchResponse(raw: unknown): MbRecording[] | null {
  const parsed = searchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.recordings.flatMap((item) => {
    const recording = normalizeRecording(item);
    return recording ? [recording] : [];
  });
}
