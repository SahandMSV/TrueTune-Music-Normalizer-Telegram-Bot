import { parseFile } from "music-metadata";
import { cleanTagValue, normalizeIsrc } from "./hints.js";

export interface EmbeddedTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNo: number | null;
  isrc: string[];
  durationSec: number | null;
  codec: string | null;
  container: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  lossless: boolean | null;
}

// Reads tags and format info only. The file is never modified.
export async function readEmbeddedTags(
  filePath: string,
): Promise<EmbeddedTags> {
  const { common, format } = await parseFile(filePath, {
    duration: true,
    skipCovers: true,
  });

  const isrc = [
    ...new Set(
      (common.isrc ?? [])
        .map((value) => normalizeIsrc(value))
        .filter((value): value is string => value !== null),
    ),
  ];

  return {
    title: cleanTagValue(common.title),
    artist:
      cleanTagValue(common.artist) ?? cleanTagValue(common.artists?.join(", ")),
    album: cleanTagValue(common.album),
    albumArtist: cleanTagValue(common.albumartist),
    year: common.year ?? null,
    trackNo: common.track.no ?? null,
    isrc,
    durationSec:
      format.duration !== undefined ? Math.round(format.duration) : null,
    codec: format.codec ?? null,
    container: format.container ?? null,
    bitrateKbps:
      format.bitrate !== undefined ? Math.round(format.bitrate / 1000) : null,
    sampleRate: format.sampleRate ?? null,
    lossless: format.lossless ?? null,
  };
}
