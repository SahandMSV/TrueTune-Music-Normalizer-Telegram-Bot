const NOISE_WORDS = new Set(["feat", "ft", "featuring"]);

// Words that make a recording a different version of the same song.
// "mix" is left out on purpose: "Original Mix" is the normal version.
const VERSION_MARKERS: ReadonlyMap<string, string> = new Map([
  ["live", "live"],
  ["remix", "remix"],
  ["remixed", "remix"],
  ["rework", "remix"],
  ["remaster", "remaster"],
  ["remastered", "remaster"],
  ["acoustic", "acoustic"],
  ["instrumental", "instrumental"],
  ["karaoke", "karaoke"],
  ["cover", "cover"],
  ["demo", "demo"],
  ["edit", "edit"],
  ["sped", "sped"],
  ["slowed", "slowed"],
  ["reverb", "reverb"],
  ["unplugged", "unplugged"],
  ["bootleg", "bootleg"],
]);

export function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function stripBrackets(value: string): string {
  return value.replace(/[([{][^()[\]{}]*[)\]}]/g, " ");
}

function isCore(word: string): boolean {
  return !NOISE_WORDS.has(word) && !VERSION_MARKERS.has(word);
}

// The words that identify the song itself, without bracketed or version text.
export function coreTokens(title: string): string[] {
  const stripped = words(stripBrackets(title)).filter(isCore);
  return stripped.length > 0 ? stripped : words(title).filter(isCore);
}

export function versionMarkers(
  ...texts: (string | null | undefined)[]
): Set<string> {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const word of words(text)) {
      const marker = VERSION_MARKERS.get(word);
      if (marker) {
        found.add(marker);
      }
    }
  }
  return found;
}

export function markerMismatches(
  wanted: ReadonlySet<string>,
  offered: ReadonlySet<string>,
): number {
  let mismatches = 0;
  for (const marker of offered) {
    if (!wanted.has(marker)) {
      mismatches += 1;
    }
  }
  for (const marker of wanted) {
    if (!offered.has(marker)) {
      mismatches += 1;
    }
  }
  return mismatches;
}

export function dice(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      shared += 1;
    }
  }
  return (2 * shared) / (setA.size + setB.size);
}

// Share of the needle's words that appear in the haystack.
export function containment(
  needle: readonly string[],
  haystack: readonly string[],
): number {
  const unique = new Set(needle);
  if (unique.size === 0) {
    return 0;
  }
  const pool = new Set(haystack);
  let hits = 0;
  for (const word of unique) {
    if (pool.has(word)) {
      hits += 1;
    }
  }
  return hits / unique.size;
}

export function titleSimilarity(a: string, b: string): number {
  return dice(coreTokens(a), coreTokens(b));
}

// Credits often add featured artists, so containment counts almost as much as an exact match.
export function artistSimilarity(
  hint: string,
  names: readonly string[],
): number {
  const hintTokens = words(hint).filter((word) => !NOISE_WORDS.has(word));
  let best = 0;
  for (const name of names) {
    const nameTokens = words(name).filter((word) => !NOISE_WORDS.has(word));
    best = Math.max(
      best,
      dice(hintTokens, nameTokens),
      0.9 * containment(hintTokens, nameTokens),
    );
  }
  return best;
}
