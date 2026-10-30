import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
  ".aiff",
]);

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

function extensionOf(fileName: string | undefined): string {
  return path.extname(fileName ?? "").toLowerCase();
}

export function isLikelyAudio(
  fileName: string | undefined,
  mimeType: string | undefined,
): boolean {
  return (
    (mimeType?.startsWith("audio/") ?? false) ||
    AUDIO_EXTENSIONS.has(extensionOf(fileName))
  );
}

// Only the extension is derived from user input, and only if it is plain
// alphanumerics, so a hostile filename can never influence the stored path.
export function safeExtension(
  fileName: string | undefined,
  mimeType: string | undefined,
): string {
  const ext = extensionOf(fileName);
  if (/^\.[a-z0-9]{1,5}$/.test(ext)) {
    return ext;
  }
  return MIME_EXTENSIONS[mimeType ?? ""] ?? ".bin";
}

export function jobDirPath(shortId: string): string {
  return path.join(config.tempDir, shortId);
}

export function jobFilePath(shortId: string, ext: string): string {
  return path.join(jobDirPath(shortId), `original${ext}`);
}

export async function ensureJobDir(shortId: string): Promise<void> {
  await mkdir(jobDirPath(shortId), { recursive: true, mode: 0o700 });
}

export async function removeJobDir(shortId: string): Promise<void> {
  await rm(jobDirPath(shortId), { recursive: true, force: true });
}
