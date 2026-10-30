import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Api } from "telegram";
import { config } from "../config.js";
import { getUserClient } from "../gramjs/client.js";
import { listen } from "../gramjs/listener.js";
import { audioDetails, hasPhoto, type AudioDetails } from "../gramjs/media.js";
import { logger } from "../logger.js";
import { safeExtension } from "../storage/files.js";
import { parseInfoCaption, type TrackInfo } from "./caption.js";
import { ProviderError } from "./errors.js";

const SEARCH_TIMEOUT_MS = 25_000;
const RETRIEVE_TIMEOUT_MS = 45_000;
const MAX_RESULTS = 10;

const CALLBACK_DATA = /^dl:([a-z]+):track:([A-Za-z0-9_-]{1,64})$/;

export interface SearchResultItem {
  n: number;
  label: string;
  data: string;
  service: string;
}

export interface SearchOutcome {
  providerMessageId: number;
  service: string;
  items: SearchResultItem[];
}

export interface RetrieveInput {
  providerMessageId: number;
  data: string;
  n: number;
  expectLabel?: string;
}

export interface RetrievedTrack {
  details: AudioDetails;
  info: TrackInfo | null;
  qualityLabel: string | null;
  relayTo(botUsername: string, caption: string): Promise<void>;
  downloadTo(dir: string): Promise<string>;
  downloadCover(): Promise<Buffer | null>;
}

function parseResults(message: Api.Message): SearchResultItem[] {
  const markup = message.replyMarkup;
  if (!(markup instanceof Api.ReplyInlineMarkup)) return [];

  const items: SearchResultItem[] = [];
  for (const row of markup.rows) {
    for (const button of row.buttons) {
      if (!(button instanceof Api.KeyboardButtonCallback)) continue;
      const data = button.data.toString("utf8");
      const dataMatch = CALLBACK_DATA.exec(data);
      const labelMatch = /^(\d{1,2})\.\s*(.+)$/su.exec(button.text);
      const service = dataMatch?.[1];
      const position = labelMatch?.[1];
      const label = labelMatch?.[2]?.trim();
      if (!service || !position || !label) continue;
      items.push({ n: Number(position), label, data, service });
    }
  }
  return items.slice(0, MAX_RESULTS);
}

function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function looselyMatches(
  haystack: string,
  performer: string | null,
  title: string | null,
): boolean {
  const pool = new Set(words(haystack));
  if (performer && !words(performer).some((w) => pool.has(w))) return false;
  if (title) {
    const tw = words(title);
    if (
      tw.length > 0 &&
      tw.filter((w) => pool.has(w)).length / tw.length < 0.55
    ) {
      return false;
    }
  }
  return true;
}

function describeTexts(messages: readonly Api.Message[]): string[] {
  return messages
    .map((m) => (m.message ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-5)
    .map((t) => t.slice(0, 160));
}

/** Find the exact KeyboardButtonCallback that matches our stored data */
function findButton(
  message: Api.Message,
  data: string,
): Api.KeyboardButtonCallback | null {
  const markup = message.replyMarkup;
  if (!(markup instanceof Api.ReplyInlineMarkup)) return null;

  for (const row of markup.rows) {
    for (const button of row.buttons) {
      if (
        button instanceof Api.KeyboardButtonCallback &&
        button.data.toString("utf8") === data
      ) {
        return button;
      }
    }
  }
  return null;
}

export async function searchTracks(query: string): Promise<SearchOutcome> {
  const client = await getUserClient();
  const username = config.providers.searchUsername;
  const peer = await client.getInputEntity(username);
  const listener = listen(client, username);

  try {
    await client.sendMessage(peer, { message: query });

    const reply = await listener.waitFor(
      (m) => parseResults(m).length > 0,
      SEARCH_TIMEOUT_MS,
    );
    if (!reply) {
      throw new ProviderError(
        "timeout",
        "No reply with results from the provider",
      );
    }

    const items = parseResults(reply);
    if (items.length === 0) {
      const text = (reply.message ?? "").replace(/\s+/g, " ").slice(0, 160);
      throw new ProviderError(
        /donat|premium|upgrade/i.test(text) ? "refused" : "no_results",
        "Reply had no result buttons",
      );
    }

    return {
      providerMessageId: reply.id,
      service: items[0]!.service,
      items,
    };
  } finally {
    listener.close();
  }
}

export async function retrieveTrack(
  input: RetrieveInput,
): Promise<RetrievedTrack> {
  const client = await getUserClient();
  const username = config.providers.searchUsername;
  const peer = await client.getInputEntity(username);
  const listener = listen(client, username);

  try {
    // ---------------------------------------------------------------
    // REAL BUTTON CLICK via GramJS
    // 1. Fetch the exact message that has the keyboard
    // 2. Find the matching KeyboardButtonCallback
    // 3. Call the official click helper (same path the official clients use)
    // ---------------------------------------------------------------
    const messages = await client.getMessages(peer, {
      ids: [input.providerMessageId],
    });
    const msg = messages[0];
    if (!msg) {
      throw new ProviderError("failed", "Result message no longer exists");
    }

    const button = findButton(msg, input.data);
    if (!button) {
      throw new ProviderError(
        "failed",
        "Target button no longer present on the message",
      );
    }

    // This is the proper GramJS way to click an inline callback button
    try {
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer,
          msgId: msg.id,
          data: button.data, // use the original Buffer, not a re-encoded string
        }),
      );
    } catch (err) {
      // BOT_RESPONSE_TIMEOUT is extremely common – the bot processed the
      // click but never answered the callback query. We still wait for the file.
      const msgText = err instanceof Error ? err.message : String(err);
      if (!/TIMEOUT|BOT_RESPONSE_TIMEOUT/i.test(msgText)) {
        logger.warn({ reason: msgText }, "GetBotCallbackAnswer hard error");
      }
    }

    const isWanted = (message: Api.Message): boolean => {
      const found = audioDetails(message);
      if (!found) return false;
      return (
        input.expectLabel === undefined ||
        looselyMatches(input.expectLabel, found.performer, found.title)
      );
    };

    const audio = await listener.waitFor(isWanted, RETRIEVE_TIMEOUT_MS);
    const details = audio ? audioDetails(audio) : null;

    if (!audio || !details) {
      logger.warn(
        {
          providerTexts: describeTexts(listener.messages),
          n: input.n,
          data: input.data,
        },
        "Provider did not deliver a file after real button click",
      );
      throw new ProviderError("timeout", "No file from the provider");
    }

    const infoMessage = listener.messages.findLast((m) => {
      if (!hasPhoto(m)) return false;
      const parsed = parseInfoCaption(m.message ?? "");
      return (
        parsed !== null &&
        looselyMatches(
          `${parsed.artist ?? ""} ${parsed.title ?? ""}`,
          details.performer,
          details.title,
        )
      );
    });

    const info = infoMessage
      ? parseInfoCaption(infoMessage.message ?? "")
      : null;
    const quality = (audio.message ?? "").replace(/\s+/g, " ").trim();

    return {
      details,
      info,
      qualityLabel: quality.length > 0 ? quality.slice(0, 80) : null,

      async relayTo(botUsername, caption) {
        if (!audio.media)
          throw new ProviderError("failed", "Provider audio has no media");
        const botPeer = await client.getInputEntity(botUsername);
        await client.sendFile(botPeer, { file: audio.media, caption });
      },

      async downloadTo(dir) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const filePath = path.join(
          dir,
          `provider${safeExtension(details.fileName ?? undefined, details.mimeType)}`,
        );
        const saved = await client.downloadMedia(audio, {
          outputFile: filePath,
        });
        if (typeof saved !== "string") {
          throw new ProviderError("failed", "Download returned no file");
        }
        const size = (await stat(filePath)).size;
        if (size === 0 || size !== details.sizeBytes) {
          throw new ProviderError("failed", "Downloaded file is incomplete");
        }
        return filePath;
      },

      async downloadCover() {
        if (!infoMessage) return null;
        try {
          const data = await client.downloadMedia(infoMessage);
          return Buffer.isBuffer(data) && data.length > 0 ? data : null;
        } catch {
          return null;
        }
      },
    };
  } finally {
    listener.close();
  }
}
