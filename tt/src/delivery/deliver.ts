import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { InlineKeyboard, InputFile, type Api } from "grammy";
import { escapeHtml, truncate } from "../bot/panel/render.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { describeFailure } from "../provider/errors.js";
import { retrieveTrack, type RetrievedTrack } from "../provider/catalog.js";
import { runExclusive } from "../provider/queue.js";
import {
  editMessage,
  renderResults,
  type SearchView,
} from "../search/render.js";
import { releasePick } from "../search/service.js";
import { startRelay } from "./relay.js";
import { sanitizeFileName, writeMp3Tags } from "./tag.js";

const PROVIDER_TEMP = path.join(config.tempDir, "provider");
const RELAY_TIMEOUT_MS = 8_000;

export interface PickInput {
  api: Api;
  chatId: number;
  messageId: number;
  view: SearchView;
  providerMessageId: number;
  item: { n: number; label: string; data: string };
}

let botUsername: string | null = null;

async function getBotUsername(api: Api): Promise<string> {
  if (botUsername === null) {
    const me = await api.getMe();
    if (!me.username) {
      throw new Error("The bot has no username");
    }
    botUsername = me.username;
  }
  return botUsername;
}

// Nothing is in flight at startup, so anything left here is an orphan.
export async function cleanProviderTemp(): Promise<void> {
  await rm(PROVIDER_TEMP, { recursive: true, force: true });
}

// Extra actions are placeholders for now.
function trackKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📝 Lyrics", "x:lyrics")
    .text("🖼 Cover", "x:cover")
    .row()
    .text("ℹ️ Metadata", "x:meta");
}

function names(track: RetrievedTrack): {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
} {
  const { details, info } = track;
  return {
    title: info?.title ?? details.title,
    artist: info?.artist ?? details.performer,
    album: info?.album ?? null,
    year: info?.year ?? null,
  };
}

function buildCaption(
  track: RetrievedTrack,
  note: string,
  extraLines: readonly string[],
): string {
  const { title, artist, album, year } = names(track);
  const lines: string[] = [];

  const headline = [artist, title].filter(Boolean).join(" — ");
  if (headline) {
    lines.push(headline);
  }
  const albumLine = [album, year].filter(Boolean).join(" · ");
  if (albumLine) {
    lines.push(albumLine);
  }
  lines.push(...extraLines);
  lines.push(`Provider file: ${track.qualityLabel ?? track.details.mimeType}`);
  lines.push(note);
  return lines.join("\n");
}

// Fast path: our account re-sends the audio to this bot by reference, and the
// bot forwards it using its file id. No bytes pass through this machine.
// Returns false on any problem so the caller can fall back.
async function sendByRelay(
  api: Api,
  chatId: number,
  track: RetrievedTrack,
  extraLines: readonly string[],
): Promise<boolean> {
  const relay = startRelay(RELAY_TIMEOUT_MS);

  try {
    await track.relayTo(await getBotUsername(api), relay.caption);
  } catch (err) {
    relay.cancel();
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "Relay could not be sent",
    );
    return false;
  }

  const relayed = await relay.result;
  if (!relayed) {
    logger.warn("Relay was not received in time");
    return false;
  }

  try {
    await api.sendAudio(chatId, relayed.fileId, {
      caption: buildCaption(
        track,
        "Sent exactly as the provider delivered it.",
        extraLines,
      ),
      reply_markup: trackKeyboard(),
    });
    return true;
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "Sending the relayed file failed",
    );
    return false;
  }
}

// Slow path: download, rewrite tags and cover, upload.
async function sendByUpload(
  api: Api,
  chatId: number,
  track: RetrievedTrack,
  dir: string,
  extraLines: readonly string[],
): Promise<void> {
  const filePath = await track.downloadTo(dir);
  const cover = await track.downloadCover();
  const { title, artist, album, year } = names(track);

  let tagged = false;
  if (track.details.mimeType === "audio/mpeg" && (track.info || cover)) {
    try {
      await writeMp3Tags(filePath, { title, artist, album, year, cover });
      tagged = true;
    } catch (err) {
      logger.warn(
        { reason: err instanceof Error ? err.message : "unknown" },
        "Could not write tags",
      );
    }
  }

  const fileName = `${sanitizeFileName(
    [artist, title].filter(Boolean).join(" - "),
  )}${path.extname(filePath)}`;

  await api.sendAudio(chatId, new InputFile(filePath, fileName), {
    title: title ?? undefined,
    performer: artist ?? undefined,
    duration: track.details.durationSec ?? undefined,
    caption: buildCaption(
      track,
      tagged
        ? "Tags and cover written from the provider's metadata."
        : "File left exactly as the provider sent it.",
      extraLines,
    ),
    reply_markup: trackKeyboard(),
  });
}

// Sends a retrieved track to a chat: the relay first, the upload as fallback.
// Throws only if both fail.
export async function sendRetrievedTrack(
  api: Api,
  chatId: number,
  track: RetrievedTrack,
  extraLines: readonly string[] = [],
): Promise<"relay" | "upload"> {
  if (await sendByRelay(api, chatId, track, extraLines)) {
    return "relay";
  }

  const dir = path.join(PROVIDER_TEMP, randomBytes(6).toString("hex"));
  try {
    await sendByUpload(api, chatId, track, dir, extraLines);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return "upload";
}

// Runs in the background: the caller has already claimed the pick.
export async function deliverPick(input: PickInput): Promise<void> {
  const { api, chatId, messageId, view, item } = input;
  const startedAt = Date.now();
  let footer = "";
  let delivered = false;

  try {
    await editMessage(
      api,
      chatId,
      messageId,
      `⏳ Getting <b>${escapeHtml(truncate(item.label, 80))}</b>…`,
    );

    const track = await runExclusive(() =>
      retrieveTrack({
        providerMessageId: input.providerMessageId,
        data: item.data,
        n: item.n,
      }),
    );
    const retrievedMs = Date.now() - startedAt;

    const via = await sendRetrievedTrack(api, chatId, track);
    delivered = true;

    logger.info(
      {
        search: view.shortId,
        n: item.n,
        via,
        retrievedMs,
        totalMs: Date.now() - startedAt,
      },
      "Track delivered",
    );
  } catch (err) {
    logger.warn(
      {
        search: view.shortId,
        n: item.n,
        reason: err instanceof Error ? err.message : "unknown",
      },
      "Delivery failed",
    );
    footer = `⚠️ ${describeFailure(err)}`;
  } finally {
    await releasePick(view.shortId).catch(() => undefined);
  }

  if (delivered) {
    // The modal has done its job, so only the track stays in the chat.
    await api.deleteMessage(chatId, messageId).catch(() => undefined);
    return;
  }

  const rendered = renderResults(view, footer);
  await editMessage(api, chatId, messageId, rendered.text, rendered.keyboard);
}
