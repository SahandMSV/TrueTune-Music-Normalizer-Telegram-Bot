import NodeID3, { type Tags } from "node-id3";

export interface TagInput {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  cover: Buffer | null;
}

// Rewrites ID3 frames in place. The audio data is not touched or re-encoded.
export async function writeMp3Tags(
  filePath: string,
  input: TagInput,
): Promise<void> {
  const tags: Tags = {};
  if (input.title) {
    tags.title = input.title;
  }
  if (input.artist) {
    tags.artist = input.artist;
  }
  if (input.album) {
    tags.album = input.album;
  }
  if (input.year) {
    tags.year = String(input.year);
  }
  if (input.cover) {
    tags.image = {
      mime: "image/jpeg",
      type: { id: 3, name: "front cover" },
      description: "Cover",
      imageBuffer: input.cover,
    };
  }

  await NodeID3.Promise.update(tags, filePath);
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : "track";
}
