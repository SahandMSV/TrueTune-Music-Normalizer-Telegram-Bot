import { Composer, type Api, type Context } from "grammy";
import { config } from "../../config.js";
import { GramjsNotReadyError } from "../../gramjs/client.js";
import { probeProvider, type EventSummary } from "../../gramjs/probe.js";
import { logger } from "../../logger.js";
import { truncate } from "../panel/render.js";

const PROBE_WINDOW_MS = 20_000;
const PICK_WINDOW_MS = 40_000;
const MAX_REPLY_CHARS = 3800;

let probing = false;

function formatEvent(event: EventSummary, index: number): string {
  const lines = [
    `#${index + 1} +${(event.atMs / 1000).toFixed(1)}s ${event.kind}${
      event.messageId ? ` (msg ${event.messageId})` : ""
    }`,
  ];

  if (event.text) {
    lines.push(`text: ${truncate(event.text.replace(/\s+/g, " "), 300)}`);
  }

  if (event.media) {
    const m = event.media;
    const size =
      m.sizeBytes !== null
        ? `${(m.sizeBytes / 1024 / 1024).toFixed(1)} MB`
        : "?";
    lines.push(
      `media: ${m.kind} | name: ${m.fileName ?? "-"} | ${m.mimeType ?? "-"} | ${size} | ${m.durationSec ?? "?"}s`,
    );
    if (m.title || m.performer) {
      lines.push(`media tags: ${m.performer ?? "-"} / ${m.title ?? "-"}`);
    }
  }

  event.buttons.forEach((row, i) => {
    lines.push(
      `row ${i + 1}: ${row.map((b) => `[${truncate(b.text, 40)}] (${b.kind})`).join(" ")}`,
    );
  });

  return lines.join("\n");
}

function formatReport(windowMs: number, events: EventSummary[]): string {
  const header = `Provider: ${events.length} event(s) in ${windowMs / 1000}s`;
  if (events.length === 0) {
    return `${header}\nNo reply was received.`;
  }

  const blocks: string[] = [];
  let length = header.length;
  for (const [i, event] of events.entries()) {
    const block = formatEvent(event, i);
    if (length + block.length + 2 > MAX_REPLY_CHARS) {
      blocks.push(`… ${events.length - i} more event(s) omitted`);
      break;
    }
    blocks.push(block);
    length += block.length + 2;
  }
  return [header, ...blocks].join("\n\n");
}

async function runProbe(
  api: Api,
  chatId: number,
  query: string,
  clickIndex: number | undefined,
): Promise<void> {
  const windowMs = clickIndex === undefined ? PROBE_WINDOW_MS : PICK_WINDOW_MS;
  try {
    const events = await probeProvider({
      username: config.providers.searchUsername,
      windowMs,
      clickIndex,
      send: (client, peer) => client.sendMessage(peer, { message: query }),
    });
    await api.sendMessage(chatId, formatReport(windowMs, events), {
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    logger.warn({ reason }, "Probe failed");
    await api
      .sendMessage(
        chatId,
        err instanceof GramjsNotReadyError
          ? err.message
          : "Probe failed. Check the logs for details.",
      )
      .catch(() => undefined);
  } finally {
    probing = false;
  }
}

async function start(
  ctx: Context,
  query: string,
  clickIndex: number | undefined,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (ctx.from?.id !== config.ownerId || chatId === undefined) {
    return;
  }

  if (probing) {
    await ctx.reply("A probe is already running. Wait for its report.");
    return;
  }

  probing = true;
  const windowMs = clickIndex === undefined ? PROBE_WINDOW_MS : PICK_WINDOW_MS;
  await ctx.reply(
    `Sending to the provider and listening for ${windowMs / 1000}s…`,
  );
  void runProbe(ctx.api, chatId, query, clickIndex);
}

export const probe = new Composer<Context>();

// Owner-only diagnostics. They run in the background so the bot keeps
// handling buttons and files while it waits for the provider's replies.
probe.command("probe", async (ctx) => {
  const query = ctx.match.trim();
  if (!query) {
    await ctx.reply(
      "Usage: /probe <text to send to the provider>\nExample: /probe poison tree",
    );
    return;
  }
  await start(ctx, query, undefined);
});

probe.command("probepick", async (ctx) => {
  const match = /^(\d{1,2})\s+(.+)$/s.exec(ctx.match.trim());
  const position = match?.[1];
  const query = match?.[2]?.trim();
  if (!position || !query || Number(position) < 1) {
    await ctx.reply(
      "Usage: /probepick <result number> <search text>\nExample: /probepick 1 poison tree",
    );
    return;
  }
  await start(ctx, query, Number(position) - 1);
});
