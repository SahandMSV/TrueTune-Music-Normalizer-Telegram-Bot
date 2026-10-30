import { Composer, type Context } from "grammy";
import { config } from "../../config.js";
import { countActiveJobsForUser, createJob } from "../../jobs/service.js";
import { wakeWorker } from "../../jobs/worker.js";
import { logger } from "../../logger.js";
import { isLikelyAudio } from "../../storage/files.js";
import { requestPanel } from "../panel/panel.js";

interface IncomingFile {
  fileId: string;
  fileUniqueId: string;
  fileName: string | undefined;
  mimeType: string | undefined;
  sizeBytes: number | undefined;
  durationSec: number | undefined;
  title: string | undefined;
  performer: string | undefined;
}

// Metadata only: nothing is downloaded here, so intake stays fast
// even when a user forwards a long batch of files.
async function handleIncoming(
  ctx: Context,
  incoming: IncomingFile,
): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (userId === undefined || chatId === undefined) {
    return;
  }

  if (!isLikelyAudio(incoming.fileName, incoming.mimeType)) {
    await ctx.reply("That doesn't look like an audio file. Send a music file.");
    requestPanel(ctx.api, chatId, "bump");
    return;
  }

  const activeCount = await countActiveJobsForUser(userId);
  if (activeCount >= config.maxActiveJobsPerUser) {
    void ctx.react("👎").catch(() => undefined);
    requestPanel(ctx.api, chatId, "edit");
    return;
  }

  const job = await createJob({
    userId,
    chatId,
    source: {
      telegramFileId: incoming.fileId,
      telegramFileUniqueId: incoming.fileUniqueId,
      fileName: incoming.fileName,
      mimeType: incoming.mimeType,
      sizeBytes: incoming.sizeBytes,
      durationSec: incoming.durationSec,
      title: incoming.title,
      performer: incoming.performer,
    },
  });

  requestPanel(ctx.api, chatId, "bump");
  wakeWorker();
  // Instant acknowledgement while the debounced panel catches up.
  void ctx.react("👍").catch(() => undefined);

  logger.info({ jobId: job.shortId, userId }, "Job created");
}

export const intake = new Composer<Context>();

intake.on("message:audio", (ctx) => {
  const audio = ctx.message.audio;
  return handleIncoming(ctx, {
    fileId: audio.file_id,
    fileUniqueId: audio.file_unique_id,
    fileName: audio.file_name,
    mimeType: audio.mime_type,
    sizeBytes: audio.file_size,
    durationSec: audio.duration,
    title: audio.title,
    performer: audio.performer,
  });
});

intake.on("message:document", (ctx) => {
  const doc = ctx.message.document;
  return handleIncoming(ctx, {
    fileId: doc.file_id,
    fileUniqueId: doc.file_unique_id,
    fileName: doc.file_name,
    mimeType: doc.mime_type,
    sizeBytes: doc.file_size,
    durationSec: undefined,
    title: undefined,
    performer: undefined,
  });
});
