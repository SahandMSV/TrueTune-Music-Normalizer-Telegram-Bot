import { createHash } from "node:crypto";
import { GrammyError, type Api } from "grammy";
import { config } from "../../config.js";
import { PanelModel } from "../../db/models/panel.js";
import type { JobDocument } from "../../db/models/job.js";
import {
  countRecentlyFinished,
  findActiveJobsForChat,
} from "../../jobs/service.js";
import type { JobStatus } from "../../jobs/states.js";
import { logger } from "../../logger.js";
import {
  RECENT_WINDOW_MINUTES,
  jobDisplayName,
  renderPanel,
  type PanelData,
  type PanelJob,
  type PanelView,
} from "./render.js";

// edit: update in place. bump: move to the bottom of the chat.
// show: like bump, but also creates an empty panel (explicit /queue).
export type SyncMode = "edit" | "bump" | "show";

const MODE_RANK: Record<SyncMode, number> = { edit: 0, bump: 1, show: 2 };

const EDIT_DEBOUNCE_MS = 600;
const BUMP_DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 5000;

interface Pending {
  timer: NodeJS.Timeout;
  firstAt: number;
  mode: SyncMode;
}

const pending = new Map<number, Pending>();
const running = new Map<number, Promise<void>>();

function higher(a: SyncMode, b: SyncMode): SyncMode {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

function toPanelJob(job: JobDocument): PanelJob {
  return {
    shortId: job.shortId,
    status: job.status as JobStatus,
    name: jobDisplayName(job.source),
    durationSec: job.source.durationSec ?? null,
  };
}

async function loadPanelData(chatId: number): Promise<PanelData> {
  const since = new Date(Date.now() - RECENT_WINDOW_MINUTES * 60_000);
  const [jobs, recentlyFinished] = await Promise.all([
    findActiveJobsForChat(chatId),
    countRecentlyFinished(chatId, since),
  ]);
  return {
    jobs: jobs.map(toPanelJob),
    recentlyFinished,
    queueLimit: config.maxActiveJobsPerUser,
  };
}

function fingerprintOf(view: PanelView): string {
  return createHash("sha1")
    .update(view.text)
    .update(JSON.stringify(view.keyboard.inline_keyboard))
    .digest("hex");
}

async function tryEdit(
  api: Api,
  chatId: number,
  messageId: number,
  view: PanelView,
): Promise<"ok" | "gone" | "failed"> {
  try {
    await api.editMessageText(chatId, messageId, view.text, {
      parse_mode: "HTML",
      reply_markup: view.keyboard,
      link_preview_options: { is_disabled: true },
    });
    return "ok";
  } catch (err) {
    if (err instanceof GrammyError) {
      const description = err.description.toLowerCase();
      if (description.includes("message is not modified")) {
        return "ok";
      }
      if (
        description.includes("message to edit not found") ||
        description.includes("message can't be edited")
      ) {
        return "gone";
      }
    }
    logger.warn(
      { chatId, reason: err instanceof Error ? err.message : "unknown" },
      "Panel edit failed",
    );
    return "failed";
  }
}

async function syncPanel(
  api: Api,
  chatId: number,
  mode: SyncMode,
): Promise<void> {
  const panel = await PanelModel.findOne({ chatId });
  const data = await loadPanelData(chatId);

  if (!panel?.messageId && data.jobs.length === 0 && mode !== "show") {
    return;
  }

  const view = renderPanel(data, panel?.page ?? 0);
  const fingerprint = fingerprintOf(view);

  if (panel?.messageId && mode === "edit") {
    if (panel.lastRendered === fingerprint) {
      return;
    }
    const outcome = await tryEdit(api, chatId, panel.messageId, view);
    if (outcome === "ok") {
      await PanelModel.updateOne(
        { chatId },
        { $set: { page: view.page, lastRendered: fingerprint } },
      );
      return;
    }
    if (outcome === "failed") {
      return;
    }
    // "gone": the panel message was deleted, so fall through and send a new one.
  }

  const sent = await api.sendMessage(chatId, view.text, {
    parse_mode: "HTML",
    reply_markup: view.keyboard,
    link_preview_options: { is_disabled: true },
  });

  await PanelModel.updateOne(
    { chatId },
    {
      $set: {
        messageId: sent.message_id,
        page: view.page,
        lastRendered: fingerprint,
      },
    },
    { upsert: true },
  );

  // Delete the old panel only after the new one is saved, so the chat never has none.
  if (panel?.messageId) {
    await api.deleteMessage(chatId, panel.messageId).catch(() => undefined);
  }
}

// Panel updates for one chat run strictly one after another.
function enqueue(api: Api, chatId: number, mode: SyncMode): Promise<void> {
  const previous = running.get(chatId) ?? Promise.resolve();
  const next = previous
    .then(() => syncPanel(api, chatId, mode))
    .catch((err: unknown) => {
      logger.error(
        { chatId, reason: err instanceof Error ? err.message : "unknown" },
        "Panel sync failed",
      );
    });
  running.set(chatId, next);
  void next.finally(() => {
    if (running.get(chatId) === next) {
      running.delete(chatId);
    }
  });
  return next;
}

// Debounced: a burst of calls collapses into one update, with a maximum wait
// so a continuous stream of files still produces periodic updates.
export function requestPanel(api: Api, chatId: number, mode: SyncMode): void {
  const now = Date.now();
  const existing = pending.get(chatId);
  const effective = existing ? higher(existing.mode, mode) : mode;
  const firstAt = existing?.firstAt ?? now;

  if (existing) {
    clearTimeout(existing.timer);
  }

  const delay = effective === "edit" ? EDIT_DEBOUNCE_MS : BUMP_DEBOUNCE_MS;
  const remaining = Math.max(0, MAX_WAIT_MS - (now - firstAt));

  const timer = setTimeout(
    () => {
      pending.delete(chatId);
      void enqueue(api, chatId, effective);
    },
    Math.min(delay, remaining),
  );

  pending.set(chatId, { timer, firstAt, mode: effective });
}

// Immediate: used for button taps and commands where the user is waiting.
export function refreshPanelNow(
  api: Api,
  chatId: number,
  mode: SyncMode = "edit",
): Promise<void> {
  const existing = pending.get(chatId);
  let effective = mode;
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(chatId);
    effective = higher(mode, existing.mode);
  }
  return enqueue(api, chatId, effective);
}

export async function setPanelPage(
  chatId: number,
  page: number,
): Promise<void> {
  await PanelModel.updateOne({ chatId }, { $set: { page } });
}

// Forces the next edit even if the rendered content is unchanged.
export async function invalidatePanel(chatId: number): Promise<void> {
  await PanelModel.updateOne({ chatId }, { $set: { lastRendered: "" } });
}
