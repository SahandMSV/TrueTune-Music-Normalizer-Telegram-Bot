export function escapePhrase(value: string): string {
  return value.replace(/[\\"]/g, "\\$&");
}

function phrase(value: string): string {
  return `"${escapePhrase(value)}"`;
}

// Removes bracketed groups such as "(feat. X)" or "[Live]" so that a title
// carrying version noise can still match the base recording.
export function stripBracketed(title: string): string {
  const stripped = title
    .replace(/[([{][^()[\]{}]*[)\]}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : title;
}

export function buildIsrcQuery(isrc: string): string {
  return `isrc:${isrc}`;
}

export function buildStrictQuery(title: string, artist: string | null): string {
  const recording = `recording:${phrase(title)}`;
  return artist ? `${recording} AND artist:${phrase(artist)}` : recording;
}

// Used only when the strict query found nothing convincing. It also tries the
// swapped order, because "Title - Artist" filenames are common. Returns null
// when it would only repeat the strict query.
export function buildFallbackQuery(
  title: string,
  artist: string | null,
): string | null {
  const baseTitle = stripBracketed(title);

  if (!artist) {
    return baseTitle === title ? null : `recording:${phrase(baseTitle)}`;
  }

  const normal = `(recording:${phrase(baseTitle)} AND artist:${phrase(artist)})`;
  const swapped = `(recording:${phrase(stripBracketed(artist))} AND artist:${phrase(baseTitle)})`;
  return `${normal} OR ${swapped}`;
}
