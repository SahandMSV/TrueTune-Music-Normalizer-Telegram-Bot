import type { JobDocument } from "../db/models/job.js";
import { logger } from "../logger.js";
import { removeJobDir } from "../storage/files.js";
import {
  JobTransitionError,
  findActiveJobsForUser,
  findJobByShortId,
  transitionJob,
} from "./service.js";

export type CancelResult =
  | { ok: true; job: JobDocument }
  | { ok: false; reason: "not_found" | "already_finished" };

// Always targets one explicit job, and only if it belongs to the user.
export async function cancelJob(
  userId: number,
  shortId: string,
): Promise<CancelResult> {
  const job = await findJobByShortId(shortId);
  if (!job || job.userId !== userId) {
    return { ok: false, reason: "not_found" };
  }

  try {
    const cancelled = await transitionJob(
      job._id,
      "cancelled",
      "cancelled_by_user",
    );
    // Cancelling is an explicit discard: remove any stored copy of the file.
    await removeJobDir(cancelled.shortId);
    logger.info({ jobId: cancelled.shortId, userId }, "Job cancelled");
    return { ok: true, job: cancelled };
  } catch (err) {
    if (err instanceof JobTransitionError) {
      return { ok: false, reason: "already_finished" };
    }
    throw err;
  }
}

export async function cancelAllJobs(userId: number): Promise<number> {
  const jobs = await findActiveJobsForUser(userId);
  let cancelled = 0;
  for (const job of jobs) {
    const result = await cancelJob(userId, job.shortId);
    if (result.ok) {
      cancelled += 1;
    }
  }
  return cancelled;
}
