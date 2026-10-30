import { Composer, type Context } from "grammy";
import { cancelAllJobs, cancelJob } from "../../jobs/cancel.js";
import { countActiveJobsForUser } from "../../jobs/service.js";
import {
  invalidatePanel,
  refreshPanelNow,
  setPanelPage,
} from "../panel/panel.js";
import {
  jobDisplayName,
  renderCancelAllConfirm,
  truncate,
} from "../panel/render.js";

export const panelActions = new Composer<Context>();

// Re-sends the panel at the bottom, useful when it has scrolled far up.
panelActions.command("queue", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    return;
  }
  await ctx.deleteMessage().catch(() => undefined);
  await refreshPanelNow(ctx.api, chatId, "show");
});

panelActions.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

panelActions.callbackQuery(/^p:(\d{1,3})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const raw = ctx.match[1];
  if (chatId === undefined || raw === undefined) {
    return;
  }
  await setPanelPage(chatId, Number(raw));
  await refreshPanelNow(ctx.api, chatId);
});

panelActions.callbackQuery(/^c:([0-9a-f]{8})$/, async (ctx) => {
  const chatId = ctx.chat?.id;
  const shortId = ctx.match[1];
  if (chatId === undefined || shortId === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }

  const result = await cancelJob(ctx.from.id, shortId);
  if (result.ok) {
    await ctx.answerCallbackQuery({
      text: `Cancelled: ${truncate(jobDisplayName(result.job.source), 150)}`,
    });
  } else {
    await ctx.answerCallbackQuery({
      text:
        result.reason === "not_found"
          ? "That job no longer exists."
          : "That job has already finished.",
    });
  }
  await refreshPanelNow(ctx.api, chatId);
});

panelActions.callbackQuery("ca", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }

  const count = await countActiveJobsForUser(ctx.from.id);
  if (count === 0) {
    await ctx.answerCallbackQuery({ text: "Nothing to cancel." });
    await refreshPanelNow(ctx.api, chatId);
    return;
  }

  // The confirmation keyboard replaces the panel's buttons until the next refresh.
  await invalidatePanel(chatId);
  await ctx.answerCallbackQuery();
  await ctx
    .editMessageReplyMarkup({ reply_markup: renderCancelAllConfirm(count) })
    .catch(() => undefined);
});

panelActions.callbackQuery("cn", async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  if (chatId !== undefined) {
    await refreshPanelNow(ctx.api, chatId);
  }
});

panelActions.callbackQuery("cy", async (ctx) => {
  const chatId = ctx.chat?.id;
  const cancelled = await cancelAllJobs(ctx.from.id);
  await ctx.answerCallbackQuery({
    text: `Cancelled ${cancelled} job${cancelled === 1 ? "" : "s"}.`,
  });
  if (chatId !== undefined) {
    await refreshPanelNow(ctx.api, chatId);
  }
});
