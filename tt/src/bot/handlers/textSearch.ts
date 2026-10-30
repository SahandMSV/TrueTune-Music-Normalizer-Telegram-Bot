import { Composer, type Api, type Context } from "grammy";
import { deliverPick } from "../../delivery/deliver.js";
import { logger } from "../../logger.js";
import { describeFailure } from "../../provider/errors.js";
import { searchTracks } from "../../provider/catalog.js";
import { runExclusive } from "../../provider/queue.js";
import { editMessage, renderResults } from "../../search/render.js";
import { claimPick, createSearch, releasePick } from "../../search/service.js";
import { escapeHtml } from "../panel/render.js";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const LINK = /https?:\/\/|www\.|t\.me\//i;

const PLACEHOLDER_TEXT: Record<string, string> = {
  lyrics: "Lyrics are coming soon.",
  cover: "Cover export is coming soon.",
  meta: "Metadata view is coming soon.",
};

async function runSearch(
  api: Api,
  userId: number,
  chatId: number,
  statusMessageId: number,
  query: string,
): Promise<void> {
  try {
    const outcome = await runExclusive(() => searchTracks(query));
    const search = await createSearch({
      userId,
      chatId,
      messageId: statusMessageId,
      query,
      providerMessageId: outcome.providerMessageId,
      service: outcome.service,
      results: outcome.items.map(({ n, label, data }) => ({ n, label, data })),
    });

    const rendered = renderResults(
      {
        shortId: search.shortId,
        query,
        results: search.results.map((r) => ({ n: r.n, label: r.label })),
      },
      null,
    );
    await editMessage(
      api,
      chatId,
      statusMessageId,
      rendered.text,
      rendered.keyboard,
    );
    logger.info(
      { search: search.shortId, results: search.results.length, userId },
      "Search completed",
    );
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown", userId },
      "Search failed",
    );
    await editMessage(api, chatId, statusMessageId, describeFailure(err));
  }
}

export const textSearch = new Composer<Context>();

// Any plain text that no command handled is a track search.
textSearch.on("message:text", async (ctx) => {
  const text = ctx.message.text.replace(/\s+/g, " ").trim();
  if (text.startsWith("/")) {
    return;
  }

  if (text.length < MIN_QUERY_LENGTH || text.length > MAX_QUERY_LENGTH) {
    await ctx.reply(
      `Send a track name between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters, for example: poison tree`,
    );
    return;
  }
  if (LINK.test(text)) {
    await ctx.reply("Links aren't supported yet. Type the track name instead.");
    return;
  }

  const status = await ctx.reply(
    `🔎 Searching for <b>${escapeHtml(text)}</b>…`,
    { parse_mode: "HTML" },
  );

  // Background work: updates are handled one at a time, so awaiting the
  // provider here would freeze every other button and file.
  void runSearch(ctx.api, ctx.from.id, ctx.chat.id, status.message_id, text);
});

textSearch.callbackQuery(/^s:([0-9a-f]{8}):(\d{1,2})$/, async (ctx) => {
  const shortId = ctx.match[1];
  const position = ctx.match[2];
  const chatId = ctx.chat?.id;
  const messageId = ctx.callbackQuery.message?.message_id;

  if (
    !shortId ||
    !position ||
    chatId === undefined ||
    messageId === undefined
  ) {
    await ctx.answerCallbackQuery();
    return;
  }

  const search = await claimPick(shortId, ctx.from.id, Number(position));
  if (!search) {
    await ctx.answerCallbackQuery({
      text: "That search is busy or has expired. Search again.",
    });
    return;
  }

  const item = search.results.find((r) => r.n === Number(position));
  if (!item) {
    await releasePick(shortId);
    await ctx.answerCallbackQuery({
      text: "That result is no longer available.",
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: "Getting your track…" });

  void deliverPick({
    api: ctx.api,
    chatId,
    messageId,
    view: {
      shortId: search.shortId,
      query: search.query,
      results: search.results.map((r) => ({ n: r.n, label: r.label })),
    },
    providerMessageId: search.providerMessageId,
    item: { n: item.n, label: item.label, data: item.data },
  });
});

textSearch.callbackQuery(/^sx:[0-9a-f]{8}$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => undefined);
});

textSearch.callbackQuery(/^x:(lyrics|cover|meta)$/, async (ctx) => {
  const key = ctx.match[1] ?? "";
  await ctx.answerCallbackQuery({
    text: PLACEHOLDER_TEXT[key] ?? "Coming soon.",
  });
});
