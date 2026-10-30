import { Api, type TelegramClient } from "telegram";
import { EditedMessage } from "telegram/events/EditedMessage.js";
import { NewMessage } from "telegram/events/NewMessage.js";
import { logger } from "../logger.js";
import { getUserClient } from "./client.js";

export interface ButtonSummary {
  text: string;
  kind: string;
}

export interface MediaSummary {
  kind: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  title: string | null;
  performer: string | null;
}

export interface EventSummary {
  atMs: number;
  kind: "new" | "edited" | "note";
  messageId: number;
  text: string;
  media: MediaSummary | null;
  buttons: ButtonSummary[][];
}

export interface ProbeOptions {
  username: string;
  windowMs: number;
  // If set, the first reply that has callback buttons gets this button
  // (0-based, counted across all buttons in reading order) tapped once.
  clickIndex?: number;
  send(client: TelegramClient, peer: Api.TypeInputPeer): Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buttonKind(button: Api.TypeKeyboardButton): string {
  if (button instanceof Api.KeyboardButtonCallback) {
    return "callback";
  }
  if (button instanceof Api.KeyboardButtonUrl) {
    return "url";
  }
  if (button instanceof Api.KeyboardButtonSwitchInline) {
    return "inline_query";
  }
  return "other";
}

function markupRows(
  markup: Api.TypeReplyMarkup | undefined,
): Api.TypeKeyboardButton[][] {
  if (
    markup instanceof Api.ReplyInlineMarkup ||
    markup instanceof Api.ReplyKeyboardMarkup
  ) {
    return markup.rows.map((row) => row.buttons);
  }
  return [];
}

function summarizeMarkup(
  markup: Api.TypeReplyMarkup | undefined,
): ButtonSummary[][] {
  return markupRows(markup).map((row) =>
    row.map((button) => ({ text: button.text, kind: buttonKind(button) })),
  );
}

// Readable callback data, or a hex prefix when it isn't plain text.
function describeData(data: Buffer): string {
  const text = data.toString("utf8");
  if (/^[\x20-\x7e]+$/.test(text)) {
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return `hex:${data.toString("hex").slice(0, 80)}`;
}

// Reads the raw TL objects instead of message.file, whose getters throw
// in this GramJS version.
function summarizeMedia(message: Api.Message): MediaSummary | null {
  const media = message.media;

  if (media instanceof Api.MessageMediaPhoto) {
    return {
      kind: "photo",
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      durationSec: null,
      title: null,
      performer: null,
    };
  }

  if (
    media instanceof Api.MessageMediaDocument &&
    media.document instanceof Api.Document
  ) {
    const doc = media.document;
    const summary: MediaSummary = {
      kind: "document",
      fileName: null,
      mimeType: doc.mimeType,
      sizeBytes: Number(doc.size.toString()),
      durationSec: null,
      title: null,
      performer: null,
    };

    for (const attribute of doc.attributes) {
      if (attribute instanceof Api.DocumentAttributeFilename) {
        summary.fileName = attribute.fileName;
      } else if (attribute instanceof Api.DocumentAttributeAudio) {
        summary.kind = attribute.voice ? "voice" : "audio";
        summary.durationSec = attribute.duration;
        summary.title = attribute.title ?? null;
        summary.performer = attribute.performer ?? null;
      }
    }
    return summary;
  }

  return media ? emptyMedia() : null;
}

function emptyMedia(): MediaSummary {
  return {
    kind: "other",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    durationSec: null,
    title: null,
    performer: null,
  };
}

function summarize(
  message: Api.Message,
  kind: "new" | "edited",
  startedAt: number,
): EventSummary {
  return {
    atMs: Date.now() - startedAt,
    kind,
    messageId: message.id,
    text: message.message ?? "",
    media: summarizeMedia(message),
    buttons: summarizeMarkup(message.replyMarkup),
  };
}

// Diagnostic only: sends one thing to a provider bot and records everything
// that bot says back (new and edited messages) during the window.
export async function probeProvider(
  options: ProbeOptions,
): Promise<EventSummary[]> {
  const client = await getUserClient();
  const peer = await client.getInputEntity(options.username);
  const startedAt = Date.now();
  const events: EventSummary[] = [];
  let clicked = false;

  function note(text: string): void {
    events.push({
      atMs: Date.now() - startedAt,
      kind: "note",
      messageId: 0,
      text,
      media: null,
      buttons: [],
    });
  }

  // Taps by sending the chosen button's exact callback data, so which
  // button is pressed does not depend on any library helper.
  async function maybeClick(message: Api.Message): Promise<void> {
    const index = options.clickIndex;
    if (index === undefined || clicked) {
      return;
    }
    const buttons = markupRows(message.replyMarkup).flat();
    if (!buttons.some((b) => b instanceof Api.KeyboardButtonCallback)) {
      return;
    }

    clicked = true;
    const target = buttons[index];
    if (!(target instanceof Api.KeyboardButtonCallback)) {
      note(
        `Cannot tap button ${index + 1}: it is missing or not a callback button (reply has ${buttons.length} buttons)`,
      );
      return;
    }

    note(
      `Tapping button ${index + 1}: ${target.text} | data: ${describeData(target.data)}`,
    );
    try {
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer,
          msgId: message.id,
          data: target.data,
        }),
      );
      note("Bot acknowledged the tap");
    } catch (err) {
      // Bots often never answer the callback itself, which is not a failure.
      note(
        `Tap finished with: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  const onNew = (event: { message: Api.Message }): void => {
    try {
      events.push(summarize(event.message, "new", startedAt));
      void maybeClick(event.message);
    } catch (err) {
      logger.warn(
        { reason: err instanceof Error ? err.message : "unknown" },
        "Probe could not summarize a message",
      );
    }
  };

  const onEdited = (event: { message: Api.Message }): void => {
    try {
      events.push(summarize(event.message, "edited", startedAt));
    } catch (err) {
      logger.warn(
        { reason: err instanceof Error ? err.message : "unknown" },
        "Probe could not summarize an edit",
      );
    }
  };

  const filter = { incoming: true, fromUsers: [options.username] };
  const newBuilder = new NewMessage(filter);
  const editedBuilder = new EditedMessage(filter);

  client.addEventHandler(onNew, newBuilder);
  client.addEventHandler(onEdited, editedBuilder);

  try {
    await options.send(client, peer);
    await sleep(options.windowMs);
  } finally {
    client.removeEventHandler(onNew, newBuilder);
    client.removeEventHandler(onEdited, editedBuilder);
  }

  return events;
}
