import type { Types } from "mongoose";
import { JobModel } from "../db/models/job.js";
import { logger } from "../logger.js";
import type { Decision } from "../ranking/rank.js";
import { removeJobDir } from "../storage/files.js";
import { transitionJob } from "./service.js";

type JobId = Types.ObjectId | string;

export interface JobResult {
  via: "relay" | "upload";
  providerLabel: string;
  durationDiffSec: number | null;
}

// Returns false if the job left "matching" (e.g. it was cancelled) meanwhile.
export async function saveDecision(
  jobId: JobId,
  decision: Decision,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    decision: { ...decision, decidedAt: new Date() },
  };
  const result = await JobModel.updateOne(
    { _id: jobId, status: "matching" },
    { $set: set },
  );
  return result.matchedCount === 1;
}

export async function saveResult(
  jobId: JobId,
  value: JobResult,
): Promise<void> {
  const set: Record<string, unknown> = {
    result: { ...value, deliveredAt: new Date() },
  };
  await JobModel.updateOne({ _id: jobId }, { $set: set });
}

// Jobs caught mid-retrieval or mid-decision by a restart cannot be resumed
// safely, so they end as failed instead of staying in the queue forever.
export async function failInterruptedJobs(): Promise<number> {
  const jobs = await JobModel.find({
    $or: [
      { status: { $in: ["retrieving", "validating", "tagging"] } },
      { status: "matching", match: { $exists: true } },
    ],
  });

  let failed = 0;
  for (const job of jobs) {
    try {
      await transitionJob(job._id, "failed", "interrupted_by_restart");
      await removeJobDir(job.shortId);
      failed += 1;
    } catch (err) {
      logger.warn(
        {
          jobId: job.shortId,
          reason: err instanceof Error ? err.message : "unknown",
        },
        "Could not fail interrupted job",
      );
    }
  }
  return failed;
}
