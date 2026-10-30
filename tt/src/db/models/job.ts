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
    title: { type: String },
    performer: { type: String },
    localPath: { type: String },
  },
  { _id: false },
);

const hintsSchema = new Schema(
  {
    title: { type: String },
    artist: { type: String },
    album: { type: String },
    durationSec: { type: Number },
    isrc: { type: String },
    titleSource: { type: String },
    artistSource: { type: String },
  },
  { _id: false },
);

const embeddedSchema = new Schema(
  {
    title: { type: String },
    artist: { type: String },
    album: { type: String },
    albumArtist: { type: String },
    year: { type: Number },
    trackNo: { type: Number },
    isrc: { type: [String], default: [] },
    durationSec: { type: Number },
    codec: { type: String },
    container: { type: String },
    bitrateKbps: { type: Number },
    sampleRate: { type: Number },
    lossless: { type: Boolean },
  },
  { _id: false },
);

const inspectionSchema = new Schema(
  {
    state: { type: String, enum: ["ready", "insufficient"], required: true },
    reason: { type: String },
    downloaded: { type: Boolean, required: true },
    embedded: { type: embeddedSchema },
    inspectedAt: { type: Date, required: true },
  },
  { _id: false },
);

const candidateArtistSchema = new Schema(
  {
    mbid: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const candidateReleaseSchema = new Schema(
  {
    mbid: { type: String, required: true },
    title: { type: String, required: true },
    date: { type: String },
    country: { type: String },
    status: { type: String },
    primaryType: { type: String },
    secondaryTypes: { type: [String], default: [] },
  },
  { _id: false },
);

const candidateSchema = new Schema(
  {
    mbid: { type: String, required: true },
    title: { type: String, required: true },
    artistCredit: { type: String, default: "" },
    artists: { type: [candidateArtistSchema], default: [] },
    lengthSec: { type: Number },
    disambiguation: { type: String },
    firstReleaseYear: { type: Number },
    searchScore: { type: Number, required: true },
    via: {
      type: String,
      enum: ["isrc", "search", "search_fallback"],
      required: true,
    },
    isrcs: { type: [String], default: [] },
    releases: { type: [candidateReleaseSchema], default: [] },
    spotifyUrls: { type: [String], default: [] },
    enriched: { type: Boolean, default: false },
  },
  { _id: false },
);

const matchQuerySchema = new Schema(
  {
    kind: { type: String, required: true },
    query: { type: String, required: true },
    resultCount: { type: Number, required: true },
  },
  { _id: false },
);

const matchSchema = new Schema(
  {
    state: { type: String, enum: ["searched", "skipped"], required: true },
    reason: { type: String },
    queries: { type: [matchQuerySchema], default: [] },
    candidates: { type: [candidateSchema], default: [] },
    searchedAt: { type: Date, required: true },
  },
  { _id: false },
);

const rankedSchema = new Schema(
  {
    mbid: { type: String, required: true },
    title: { type: String, required: true },
    artist: { type: String, default: "" },
    lengthSec: { type: Number },
    year: { type: Number },
    disambiguation: { type: String },
    score: { type: Number, required: true },
    titleSim: { type: Number, required: true },
    artistSim: { type: Number, required: true },
    swapped: { type: Boolean, default: false },
    durationDiffSec: { type: Number },
  },
  { _id: false },
);

const decisionSchema = new Schema(
  {
    confidence: {
      type: String,
      enum: ["high", "ambiguous", "low"],
      required: true,
    },
    reason: { type: String, required: true },
    ranked: { type: [rankedSchema], default: [] },
    chosenMbid: { type: String },
    decidedAt: { type: Date, required: true },
  },
  { _id: false },
);

const resultSchema = new Schema(
  {
    via: { type: String, enum: ["relay", "upload"], required: true },
    providerLabel: { type: String, required: true },
    durationDiffSec: { type: Number },
    deliveredAt: { type: Date, required: true },
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
    chatId: { type: Number, required: true, index: true },
    status: {
      type: String,
      enum: JOB_STATUSES,
      required: true,
      default: "queued",
      index: true,
    },
    source: { type: sourceFileSchema, required: true },
    hints: { type: hintsSchema },
    inspection: { type: inspectionSchema },
    match: { type: matchSchema },
    decision: { type: decisionSchema },
    result: { type: resultSchema },
    history: { type: [historyEntrySchema], default: [] },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

export type JobFields = InferSchemaType<typeof jobSchema>;
export type JobDocument = HydratedDocument<JobFields>;

export const JobModel = model("Job", jobSchema);
