import { createHash } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getCached, setCached } from "./cache.js";

const BASE_URL = "https://musicbrainz.org/ws/2";
const APP_NAME = "TrueTune";
const APP_VERSION = "0.1.0";
const USER_AGENT = `${APP_NAME}/${APP_VERSION} ( ${config.musicbrainzContact} )`;

// MusicBrainz allows one request per second; the extra margin avoids edge cases.
const MIN_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export class MusicBrainzError extends Error {
  status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MusicBrainzError";
    this.status = status;
  }
}

// Every request, including retries, takes the next free time slot, so
// concurrent callers can never exceed the rate limit.
let nextSlotAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeSlot(): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);
  nextSlotAt = startAt + MIN_INTERVAL_MS;
  if (startAt > now) {
    await sleep(startAt - now);
  }
}

function backOff(ms: number): void {
  nextSlotAt = Math.max(nextSlotAt, Date.now() + ms);
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}

async function fetchWithRetry(url: string): Promise<unknown> {
  let lastError = new MusicBrainzError("MusicBrainz request failed");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await takeSlot();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = new MusicBrainzError("Network error or timeout");
      logger.warn({ attempt }, "MusicBrainz request failed, will retry");
      backOff(attempt * 2000);
      continue;
    }

    if (res.status === 503 || res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
          : attempt * 3000;
      lastError = new MusicBrainzError(
        "MusicBrainz is limiting requests",
        res.status,
      );
      logger.warn(
        { attempt, status: res.status, waitMs: wait },
        "MusicBrainz rate limit",
      );
      await discard(res);
      backOff(wait);
      continue;
    }

    if (res.status >= 500) {
      lastError = new MusicBrainzError(`HTTP ${res.status}`, res.status);
      logger.warn({ attempt, status: res.status }, "MusicBrainz server error");
      await discard(res);
      backOff(attempt * 2000);
      continue;
    }

    if (!res.ok) {
      await discard(res);
      throw new MusicBrainzError(`HTTP ${res.status}`, res.status);
    }

    try {
      return (await res.json()) as unknown;
    } catch {
      throw new MusicBrainzError("MusicBrainz returned invalid JSON");
    }
  }

  throw lastError;
}

// Cached GET. Only successful responses are cached, so errors are always retried later.
export async function mbGet(
  path: string,
  params: Record<string, string>,
  ttlMs: number,
): Promise<unknown> {
  const query = new URLSearchParams({ ...params, fmt: "json" });
  const url = `${BASE_URL}/${path}?${query.toString()}`;
  const key = `mb:${createHash("sha1").update(url).digest("hex")}`;

  const cached = await getCached(key);
  if (cached !== undefined) {
    return cached;
  }

  const body = await fetchWithRetry(url);
  await setCached(key, body, ttlMs);
  return body;
}
