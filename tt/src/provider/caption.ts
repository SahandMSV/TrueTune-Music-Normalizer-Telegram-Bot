export interface TrackInfo {
  title: string | null;
  artist: string | null;
  album: string | null;
  releaseDate: string | null;
  year: number | null;
}

const LABELS = ["Track title:", "Artist:", "Album:", "Release date:"] as const;

// Each field is followed by an emoji that introduces the next one.
function cleanValue(value: string): string | null {
  const cleaned = value
    .replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

// Parses the provider's cover-photo caption. It slices between the known
// labels, so it doesn't depend on line breaks being preserved.
export function parseInfoCaption(text: string): TrackInfo | null {
  const found = LABELS.map((label) => ({ label, at: text.indexOf(label) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);

  if (!found.some((entry) => entry.label === "Track title:")) {
    return null;
  }

  const values = new Map<string, string | null>();
  found.forEach((entry, i) => {
    const end = found[i + 1]?.at ?? text.length;
    values.set(
      entry.label,
      cleanValue(text.slice(entry.at + entry.label.length, end)),
    );
  });

  const releaseDate = values.get("Release date:") ?? null;
  const yearMatch = releaseDate
    ? /(?:^|\D)(\d{4})(?:\D|$)/.exec(releaseDate)
    : null;

  return {
    title: values.get("Track title:") ?? null,
    artist: values.get("Artist:") ?? null,
    album: values.get("Album:") ?? null,
    releaseDate,
    year: yearMatch?.[1] ? Number(yearMatch[1]) : null,
  };
}
