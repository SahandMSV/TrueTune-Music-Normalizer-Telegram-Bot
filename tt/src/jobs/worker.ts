import type { Api } from "grammy";
import { requestPanel } from "../bot/panel/panel.js";
import type { JobDocument } from "../db/models/job.js";
import type { HintSource, SearchHints } from "../inspection/hints.js";
import { inspectJob } from "../inspection/inspect.js";
import { logger } from "../logger.js";
import { removeJobDir } from "../storage/files.js";
import { failInterruptedJobs } from "./decision.js";
import { fulfillJob, reportFailure } from "./fulfill.js";
import {
  claimNextQueuedJob,
  findInterruptedMatching,
  saveInspection,
  transitionJob,
} from "./service.js";

const POLL_MS = 5000;

export interface WorkerHandle {
  stop(): Promise<void>;
}

let wakeResolver: (() => void) | null = null;

// Called when a job is created so the worker doesn't wait for the next poll.
export function wakeWorker(): void {
  wakeResolver?.();
}

function sleepUntilWoken(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      wakeResolver = null;
      resolve();
    }
    wakeResolver = done;
  });
}

interface InspectionResult {
  hints: SearchHints;
  ready: boolean;
  reason: string | null;
}

function storedHints(job: JobDocument): SearchHints {
  const h = job.hints;
  return {
    title: h?.title ?? null,
    artist: h?.artist ?? null,
    album: h?.album ?? null,
    durationSec: h?.durationSec ?? null,
    isrc: h?.isrc ?? null,
    titleSource: (h?.titleSource ?? null) as HintSource | null,
    artistSource: (h?.artistSource ?? null) as HintSource | null,
  };
}

async function failJob(
  api: Api,
  job: JobDocument,
  reason: string,
  message: string,
): Promise<void> {
  const failed = await transitionJob(job._id, "failed", reason).then(
    () => true,
    () => false,
  );
  if (failed) {
    await reportFailure(api, job, message);
  }
}

// Returns null when the job is finished or gone, so nothing else should run for it.
async function ensureInspected(
  api: Api,
  job: JobDocument,
): Promise<InspectionResult | null> {
  // Resumed after a restart: inspection was already saved, so don't redo it.
  if (job.inspection) {
    return {
      hints: storedHints(job),
      ready: job.inspection.state === "ready",
      reason: job.inspection.reason ?? null,
    };
  }

  const outcome = await inspectJob(api, job);

  if (outcome.kind === "download_failed") {
    await failJob(
      api,
      job,
      "download_failed",
      "Couldn't download that file from Telegram. Please send it again.",
    );
    return null;
  }

  const saved = await saveInspection(job._id, outcome);
  if (!saved) {
    // Cancelled while inspecting: discard anything we stored for it.
    await removeJobDir(job.shortId);
    logger.info({ jobId: job.shortId }, "Job left matching during inspection");
    return null;
  }

  logger.info(
    {
      jobId: job.shortId,
      state: outcome.inspection.state,
      reason: outcome.inspection.reason,
      downloaded: outcome.inspection.downloaded,
      title: outcome.hints.title,
      artist: outcome.hints.artist,
      titleSource: outcome.hints.titleSource,
      artistSource: outcome.hints.artistSource,
    },
    "Job inspected",
  );

  return {
    hints: outcome.hints,
    ready: outcome.inspection.state === "ready",
    reason: outcome.inspection.reason,
  };
}

async function processJob(api: Api, job: JobDocument): Promise<void> {
  requestPanel(api, job.chatId, "edit");

  const inspected = await ensureInspected(api, job);
  if (inspected) {
    if (!inspected.ready || inspected.hints.title === null) {
      await failJob(
        api,
        job,
        inspected.reason ?? "no_title_found",
        "I couldn't work out a track name from this file, so I didn't search.",
      );
    } else {
      await fulfillJob(api, job, inspected.hints);
    }
  }

  requestPanel(api, job.chatId, "edit");
}

async function run(api: Api, isStopping: () => boolean): Promise<void> {
  const interrupted = await failInterruptedJobs();
  if (interrupted > 0) {
    logger.info({ count: interrupted }, "Failed jobs interrupted by a restart");
  }

  // Jobs claimed before a restart but never searched are resumed first.
  const resume = await findInterruptedMatching();
  if (resume.length > 0) {
    logger.info({ count: resume.length }, "Resuming interrupted jobs");
  }

  while (!isStopping()) {
    let job: JobDocument | null | undefined = resume.shift();

    if (!job) {
      try {
        job = await claimNextQueuedJob();
      } catch (err) {
        logger.error({ err }, "Could not claim next job");
        await sleepUntilWoken(POLL_MS);
        continue;
      }
    }

    if (!job) {
      await sleepUntilWoken(POLL_MS);
      continue;
    }

    try {
      await processJob(api, job);
    } catch (err) {
      logger.error({ err, jobId: job.shortId }, "Job processing failed");
      await failJob(
        api,
        job,
        "processing_error",
        "Something went wrong while processing this file.",
      );
      requestPanel(api, job.chatId, "edit");
    }
  }
}

// One job at a time, oldest first.
export function startWorker(api: Api): WorkerHandle {
  let stopping = false;

  const done = run(api, () => stopping).catch((err: unknown) => {
    logger.fatal({ err }, "Worker crashed");
  });

  return {
    stop: async () => {
      stopping = true;
      wakeWorker();
      await done;
    },
  };
}
