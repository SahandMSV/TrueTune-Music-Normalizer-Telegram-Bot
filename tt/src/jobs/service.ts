import type { Types, UpdateQuery } from "mongoose";
import {
  JobModel,
  type JobDocument,
  type JobFields,
} from "../db/models/job.js";
import {
  TERMINAL_STATUSES,
  isTerminal,
  statusesThatCanReach,
  type JobStatus,
} from "./states.js";

export class JobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobTransitionError";
  }
}

export interface CreateJobInput {
  userId: number;
  chatId: number;
  source: JobFields["source"];
}

type JobId = Types.ObjectId | string;

export async function createJob(input: CreateJobInput): Promise<JobDocument> {
  return JobModel.create({
    userId: input.userId,
    chatId: input.chatId,
    source: input.source,
    status: "queued",
    history: [{ status: "queued", at: new Date() }],
  });
}

// The status filter makes the transition atomic: two racing callers
// cannot both move a job out of the same state.
export async function transitionJob(
  jobId: JobId,
  to: JobStatus,
  reason?: string,
): Promise<JobDocument> {
  const now = new Date();

  const update: UpdateQuery<JobFields> = {
    $set: { status: to, ...(isTerminal(to) ? { finishedAt: now } : {}) },
    $push: { history: { status: to, at: now, reason } },
  };

  const updated = await JobModel.findOneAndUpdate(
    { _id: jobId, status: { $in: statusesThatCanReach(to) } },
    update,
    { new: true },
  );

  if (updated) {
    return updated;
  }

  const existing = await JobModel.findById(jobId);
  if (!existing) {
    throw new JobTransitionError(`Job ${String(jobId)} not found`);
  }
  throw new JobTransitionError(
    `Illegal transition for job ${existing.shortId}: ${existing.status} -> ${to}`,
  );
}

export async function findJobByShortId(
  shortId: string,
): Promise<JobDocument | null> {
  return JobModel.findOne({ shortId });
}

export async function findActiveJobsForUser(
  userId: number,
): Promise<JobDocument[]> {
  return JobModel.find({
    userId,
    status: { $nin: TERMINAL_STATUSES },
  }).sort({ createdAt: 1 });
}
