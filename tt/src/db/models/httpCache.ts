import { Schema, model } from "mongoose";

const httpCacheSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
});

// MongoDB deletes expired documents in the background (about once a minute).
httpCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const HttpCacheModel = model("HttpCache", httpCacheSchema, "http_cache");
