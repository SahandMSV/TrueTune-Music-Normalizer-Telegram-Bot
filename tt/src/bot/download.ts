import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { Api } from "grammy";
import { config } from "../config.js";

// Telegram's cloud Bot API only serves files up to 20 MB.
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

// The download URL contains the bot token, so every failure is rethrown
// with a generic message and the original error is never logged.
export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  destPath: string,
): Promise<void> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) {
      throw new DownloadError("Telegram returned no file path");
    }

    const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new DownloadError(`Download failed with HTTP ${res.status}`);
    }

    await pipeline(
      Readable.fromWeb(res.body as NodeWebStream),
      createWriteStream(destPath, { mode: 0o600 }),
    );
  } catch (err) {
    if (err instanceof DownloadError) {
      throw err;
    }
    throw new DownloadError("Network or filesystem error during download");
  }
}
