import type { Types, UpdateQuery } from "mongoose";
import {
  JobModel,
  type JobDocument,
  type JobFields,
} from "../db/models/job.js";
import type { InspectionData } from "../inspection/inspect.js";
import type { SearchHints } from "../inspection/hints.js";
import type { MatchData } from "../musicbrainz/types.js";
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

export interface InspectionSave {
  hints: SearchHints;
  inspection: InspectionData;
  localPath: string | null;
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
    { returnDocument: "after" },
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

// Atomically takes the oldest queued job and moves it to "matching".
export async function claimNextQueuedJob(): Promise<JobDocument | null> {
  return JobModel.findOneAndUpdate(
    { status: "queued" },
    {
      $set: { status: "matching" },
      $push: { history: { status: "matching", at: new Date() } },
    },
    { sort: { createdAt: 1, _id: 1 }, returnDocument: "after" },
  );
}

// Jobs that were claimed but never finished the matching stage (e.g. after a restart).
export async function findInterruptedMatching(): Promise<JobDocument[]> {
  return JobModel.find({
    status: "matching",
    match: { $exists: false },
  }).sort({ createdAt: 1, _id: 1 });
}

// Returns false if the job left "matching" (e.g. it was cancelled) meanwhile.
export async function saveInspection(
  jobId: JobId,
  data: InspectionSave,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    hints: data.hints,
    inspection: data.inspection,
  };
  if (data.localPath !== null) {
    set["source.localPath"] = data.localPath;
  }

  const result = await JobModel.updateOne(
    { _id: jobId, status: "matching" },
    { $set: set },
  );
  return result.matchedCount === 1;
}

// Returns false if the job left "matching" (e.g. it was cancelled) meanwhile.
export async function saveMatch(
  jobId: JobId,
  match: MatchData,
): Promise<boolean> {
  const set: Record<string, unknown> = { match };

  const result = await JobModel.updateOne(
    { _id: jobId, status: "matching" },
    { $set: set },
  );
  return result.matchedCount === 1;
}

export async function countActiveJobsForUser(userId: number): Promise<number> {
  return JobModel.countDocuments({
    userId,
    status: { $nin: TERMINAL_STATUSES },
  });
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
  }).sort({ createdAt: 1, _id: 1 });
}

export async function findActiveJobsForChat(
  chatId: number,
): Promise<JobDocument[]> {
  return JobModel.find({
    chatId,
    status: { $nin: TERMINAL_STATUSES },
  }).sort({ createdAt: 1, _id: 1 });
}

export async function countRecentlyFinished(
  chatId: number,
  since: Date,
): Promise<Record<string, number>> {
  const rows = await JobModel.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        chatId,
        status: { $in: [...TERMINAL_STATUSES] },
        finishedAt: { $gte: since },
      },
    },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}
