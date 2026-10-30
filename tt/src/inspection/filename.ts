export interface ParsedFileName {
  artist: string | null;
  title: string | null;
}

const KNOWN_EXTENSION =
  /\.(?:mp3|flac|m4a|aac|ogg|opus|wav|wma|aiff?|mp4|mka|webm)$/i;

// Download-site and channel spam that often decorates forwarded filenames.
const SITE =
  /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|net|org|info|biz|ir|ru|ws)\b\S*/gi;
const HANDLE = /(?:^|\s)@\w+/g;

// Only bracketed groups that are clearly junk are removed. Groups such as
// "(feat. X)", "(Remix)" or "(Live)" are kept because they identify the version.
const JUNK_GROUP =
  /[([{][^()[\]{}]*\b(?:official|lyrics?|lyric video|audio|video|music video|visuali[sz]er|hd|hq|4k|\d{2,3}\s?kbps|free download|download|explicit)\b[^()[\]{}]*[)\]}]/gi;

// "01. ", "01 - ", "1) ". A bare "21 Guns" is deliberately left alone.
const LEADING_TRACK_NUMBER = /^\d{1,3}\s*[-.)]\s+/;

const SEPARATOR = /\s+[-–—]\s+/;

const GENERIC_NAME =
  /^(?:audio|track|untitled|unknown|voice(?: message)?|recording|new recording|file|music|song|sound)\b[\s._:-]*[\d\s._:-]*$/i;
const MESSENGER_NAME = /^(?:aud|ptt|vn)[-\s]?\d/i;

function isGeneric(value: string): boolean {
  return (
    !/\p{L}/u.test(value) ||
    GENERIC_NAME.test(value) ||
    MESSENGER_NAME.test(value)
  );
}

// Assumes "Artist - Title". Wrong order is possible and is handled during ranking.
export function parseFileName(
  fileName: string | null | undefined,
): ParsedFileName {
  const empty: ParsedFileName = { artist: null, title: null };
  if (!fileName) {
    return empty;
  }

  let text = fileName
    .normalize("NFC")
    .replace(KNOWN_EXTENSION, "")
    .replace(/_/g, " ")
    .replace(SITE, " ")
    .replace(HANDLE, " ")
    .replace(JUNK_GROUP, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text
    .replace(LEADING_TRACK_NUMBER, "")
    .replace(/^[\s\-–—~]+|[\s\-–—~]+$/g, "");

  if (text.length === 0 || text.length > 200) {
    return empty;
  }

  let artist: string | null = null;
  let title = text;

  const match = SEPARATOR.exec(text);
  if (match) {
    const left = text.slice(0, match.index).trim();
    const right = text.slice(match.index + match[0].length).trim();
    if (left.length > 0 && right.length > 0) {
      artist = left;
      title = right;
    }
  }

  if (isGeneric(title)) {
    return empty;
  }

  return { artist, title };
}
