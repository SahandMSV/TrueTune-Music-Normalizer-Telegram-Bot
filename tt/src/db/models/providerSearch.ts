import { randomBytes } from "node:crypto";
import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from "mongoose";

const resultSchema = new Schema(
  {
    n: { type: Number, required: true },
    label: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false },
);

const providerSearchSchema = new Schema({
  shortId: {
    type: String,
    required: true,
    unique: true,
    default: () => randomBytes(4).toString("hex"),
  },
  userId: { type: Number, required: true, index: true },
  chatId: { type: Number, required: true },
  messageId: { type: Number, required: true },
  query: { type: String, required: true },
  providerMessageId: { type: Number, required: true },
  service: { type: String, required: true },
  results: { type: [resultSchema], default: [] },
  state: { type: String, enum: ["idle", "retrieving"], default: "idle" },
  pickedN: { type: Number },
  // Searches expire after six hours, which also invalidates their buttons.
  createdAt: { type: Date, default: Date.now, expires: 6 * 60 * 60 },
});

export type ProviderSearchFields = InferSchemaType<typeof providerSearchSchema>;
export type ProviderSearchDocument = HydratedDocument<ProviderSearchFields>;

export const ProviderSearchModel = model(
  "ProviderSearch",
  providerSearchSchema,
  "provider_searches",
);
