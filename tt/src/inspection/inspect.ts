import type { Api } from "grammy";
import { MAX_DOWNLOAD_BYTES, downloadTelegramFile } from "../bot/download.js";
import type { JobDocument } from "../db/models/job.js";
import { logger } from "../logger.js";
import {
  ensureJobDir,
  jobFilePath,
  removeJobDir,
  safeExtension,
} from "../storage/files.js";
import { readEmbeddedTags, type EmbeddedTags } from "./embedded.js";
import { parseFileName } from "./filename.js";
import {
  hintsFromTelegram,
  mergeHints,
  type HintCandidate,
  type SearchHints,
} from "./hints.js";

export type InsufficientReason =
  | "no_title_found"
  | "file_too_large"
  | "unreadable_file";

export interface InspectionData {
  state: "ready" | "insufficient";
  reason: InsufficientReason | null;
  downloaded: boolean;
  embedded: EmbeddedTags | null;
  inspectedAt: Date;
}

export type InspectionOutcome =
  | {
      kind: "done";
      hints: SearchHints;
      inspection: InspectionData;
      localPath: string | null;
    }
  | { kind: "download_failed" };

function insufficient(
  hints: SearchHints,
  reason: InsufficientReason,
  downloaded: boolean,
  localPath: string | null,
  embedded: EmbeddedTags | null,
): InspectionOutcome {
  return {
    kind: "done",
    hints,
    localPath,
    inspection: {
      state: "insufficient",
      reason,
      downloaded,
      embedded,
      inspectedAt: new Date(),
    },
  };
}

// Builds search hints from what Telegram already told us. The file is
// downloaded only when that gives no usable title: an artist alone cannot
// identify a recording.
export async function inspectJob(
  api: Api,
  job: JobDocument,
): Promise<InspectionOutcome> {
  const { source } = job;

  const candidates: HintCandidate[] = [
    hintsFromTelegram(source),
    { source: "filename", ...parseFileName(source.fileName) },
  ];

  const messageHints = mergeHints(candidates);

  if (messageHints.title !== null) {
    return {
      kind: "done",
      hints: messageHints,
      localPath: null,
      inspection: {
        state: "ready",
        reason: null,
        downloaded: false,
        embedded: null,
        inspectedAt: new Date(),
      },
    };
  }

  if (
    source.sizeBytes !== null &&
    source.sizeBytes !== undefined &&
    source.sizeBytes > MAX_DOWNLOAD_BYTES
  ) {
    return insufficient(messageHints, "file_too_large", false, null, null);
  }

  const localPath = jobFilePath(
    job.shortId,
    safeExtension(source.fileName ?? undefined, source.mimeType ?? undefined),
  );

  try {
    await ensureJobDir(job.shortId);
    await downloadTelegramFile(api, source.telegramFileId, localPath);
  } catch (err) {
    logger.warn(
      {
        jobId: job.shortId,
        reason: err instanceof Error ? err.message : "unknown",
      },
      "Download for inspection failed",
    );
    await removeJobDir(job.shortId);
    return { kind: "download_failed" };
  }

  let embedded: EmbeddedTags;
  try {
    embedded = await readEmbeddedTags(localPath);
  } catch (err) {
    logger.warn(
      {
        jobId: job.shortId,
        reason: err instanceof Error ? err.message : "unknown",
      },
      "Could not read embedded tags",
    );
    return insufficient(messageHints, "unreadable_file", true, localPath, null);
  }

  const merged = mergeHints([
    ...candidates,
    {
      source: "embedded_tags",
      title: embedded.title,
      artist: embedded.artist,
      album: embedded.album,
      durationSec: embedded.durationSec,
      isrc: embedded.isrc[0] ?? null,
    },
  ]);

  if (merged.title === null) {
    return insufficient(merged, "no_title_found", true, localPath, embedded);
  }

  return {
    kind: "done",
    hints: merged,
    localPath,
    inspection: {
      state: "ready",
      reason: null,
      downloaded: true,
      embedded,
      inspectedAt: new Date(),
    },
  };
}
