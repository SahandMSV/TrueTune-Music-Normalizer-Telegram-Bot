import { randomBytes } from "node:crypto";
import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from "mongoose";
import { JOB_STATUSES } from "../../jobs/states.js";

const sourceFileSchema = new Schema(
  {
    telegramFileId: { type: String, required: true },
    telegramFileUniqueId: { type: String },
    fileName: { type: String },
    mimeType: { type: String },
    sizeBytes: { type: Number },
    durationSec: { type: Number },
    localPath: { type: String },
  },
  { _id: false },
);

const historyEntrySchema = new Schema(
  {
    status: { type: String, enum: JOB_STATUSES, required: true },
    at: { type: Date, required: true },
    reason: { type: String },
  },
  { _id: false },
);

const jobSchema = new Schema(
  {
    shortId: {
      type: String,
      required: true,
      unique: true,
      default: () => randomBytes(4).toString("hex"),
    },
    userId: { type: Number, required: true, index: true },
    chatId: { type: Number, required: true },
    status: {
      type: String,
      enum: JOB_STATUSES,
      required: true,
      default: "queued",
      index: true,
    },
    source: { type: sourceFileSchema, required: true },
    history: { type: [historyEntrySchema], default: [] },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

export type JobFields = InferSchemaType<typeof jobSchema>;
export type JobDocument = HydratedDocument<JobFields>;

export const JobModel = model("Job", jobSchema);
