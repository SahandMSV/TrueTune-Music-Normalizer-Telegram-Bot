import { HttpCacheModel } from "../db/models/httpCache.js";
import { logger } from "../logger.js";

// Cache problems must never break a lookup, so both functions swallow errors.
export async function getCached(key: string): Promise<unknown> {
  try {
    const doc = await HttpCacheModel.findOne({
      key,
      expiresAt: { $gt: new Date() },
    }).lean();
    return doc?.value;
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "Cache read failed",
    );
    return undefined;
  }
}

export async function setCached(
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  try {
    await HttpCacheModel.updateOne(
      { key },
      { $set: { value, expiresAt: new Date(Date.now() + ttlMs) } },
      { upsert: true },
    );
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "Cache write failed",
    );
  }
}
