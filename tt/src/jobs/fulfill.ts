import type { Api } from "grammy";
import { requestPanel } from "../bot/panel/panel.js";
import { jobDisplayName, truncate } from "../bot/panel/render.js";
import type { JobDocument } from "../db/models/job.js";
import { sendRetrievedTrack } from "../delivery/deliver.js";
import type { SearchHints } from "../inspection/hints.js";
import { logger } from "../logger.js";
import {
  retrieveTrack,
  searchTracks,
  type RetrievedTrack,
} from "../provider/catalog.js";
import { ProviderError, describeFailure } from "../provider/errors.js";
import { runExclusive } from "../provider/queue.js";
import { removeJobDir } from "../storage/files.js";
import { saveResult } from "./decision.js";
import { JobTransitionError, transitionJob } from "./service.js";
import type { JobStatus } from "./states.js";

interface Fetched {
  track: RetrievedTrack;
  label: string;
}

// Tells the user a job ended badly. The panel only shows active jobs, so
// without this a failed file would just disappear.
export async function reportFailure(
  api: Api,
  job: JobDocument,
  message: string,
): Promise<void> {
  await api
    .sendMessage(
      job.chatId,
      `⚠️ ${truncate(jobDisplayName(job.source), 80)}\n${message}`,
    )
    .catch(() => undefined);
  requestPanel(api, job.chatId, "bump");
}

// Returns false when the job is no longer in a state that allows the step,
// which is what happens after the user cancels it.
async function advance(
  api: Api,
  job: JobDocument,
  to: JobStatus,
  reason: string,
): Promise<boolean> {
  try {
    await transitionJob(job._id, to, reason);
  } catch (err) {
    if (err instanceof JobTransitionError) {
      logger.info(
        { jobId: job.shortId, to },
        "Job can no longer take this step",
      );
      return false;
    }
    throw err;
  }
  requestPanel(api, job.chatId, "edit");
  return true;
}

function lengthNote(
  yours: number | null,
  theirs: number | null,
): { diff: number | null; line: string | null } {
  if (yours === null || theirs === null) {
    return { diff: null, line: null };
  }
  const diff = Math.abs(yours - theirs);
  if (diff <= 5) {
    return { diff, line: `Length is within ${diff} s of your file.` };
  }
  if (diff > 10) {
    return {
      diff,
      line: `⚠️ Length differs from your file by ${diff} s, so this may be a different version.`,
    };
  }
  return { diff, line: null };
}

function failureText(err: unknown, query: string): string {
  if (err instanceof ProviderError) {
    if (err.code === "no_results") {
      return `No match found for “${truncate(query, 80)}”.`;
    }
    if (err.code === "timeout") {
      return `The provider didn't deliver the first result for “${truncate(query, 80)}”.`;
    }
  }
  return describeFailure(err);
}

async function failFetch(
  api: Api,
  job: JobDocument,
  err: unknown,
  query: string,
): Promise<void> {
  const timedOut = err instanceof ProviderError && err.code === "timeout";
  const reason =
    err instanceof ProviderError ? `provider_${err.code}` : "provider_error";

  logger.warn(
    {
      jobId: job.shortId,
      reason,
      detail: err instanceof Error ? err.message : "unknown",
    },
    "Retrieval failed",
  );

  if (await advance(api, job, timedOut ? "timed_out" : "failed", reason)) {
    await reportFailure(api, job, failureText(err, query));
  }
}

// Searches the provider for "Artist Title" and sends its first result.
// Nothing is ranked, confirmed or substituted: if the first result does not
// deliver, the job fails instead of using a different track.
export async function fulfillJob(
  api: Api,
  job: JobDocument,
  hints: SearchHints,
): Promise<void> {
  if (hints.title === null) {
    if (await advance(api, job, "failed", "no_title_found")) {
      await reportFailure(
        api,
        job,
        "I couldn't work out a track name from this file, so I didn't search.",
      );
    }
    return;
  }

  const query = hints.artist ? `${hints.artist} ${hints.title}` : hints.title;

  if (!(await advance(api, job, "retrieving", "search_started"))) {
    return;
  }

  let fetched: Fetched;
  try {
    // One provider turn per job: search and fetch without interleaving.
    fetched = await runExclusive(async (): Promise<Fetched> => {
      const found = await searchTracks(query);
      const first = found.items[0];
      if (!first) {
        throw new ProviderError("no_results", "Search had no results");
      }
      const track = await retrieveTrack({
        providerMessageId: found.providerMessageId,
        data: first.data,
        n: first.n,
      });
      return { track, label: first.label };
    });
  } catch (err) {
    await failFetch(api, job, err, query);
    return;
  }

  // If the user cancelled while the provider was working, nothing is sent.
  if (!(await advance(api, job, "validating", "retrieved"))) {
    return;
  }

  const { track, label } = fetched;
  const note = lengthNote(hints.durationSec, track.details.durationSec);
  const extraLines = [
    `First provider result for “${truncate(query, 60)}”: ${truncate(label, 60)}`,
  ];
  if (note.line) {
    extraLines.push(note.line);
  }

  let via: "relay" | "upload";
  try {
    via = await sendRetrievedTrack(api, job.chatId, track, extraLines);
  } catch (err) {
    logger.warn(
      {
        jobId: job.shortId,
        reason: err instanceof Error ? err.message : "unknown",
      },
      "Delivery failed",
    );
    if (await advance(api, job, "failed", "delivery_failed")) {
      await reportFailure(api, job, "The file was found but couldn't be sent.");
    }
    return;
  }

  await saveResult(job._id, {
    via,
    providerLabel: label,
    durationDiffSec: note.diff,
  });
  await advance(api, job, "completed", "delivered");
  await removeJobDir(job.shortId);
  requestPanel(api, job.chatId, "bump");
  logger.info({ jobId: job.shortId, via, query, label }, "Job completed");
}
