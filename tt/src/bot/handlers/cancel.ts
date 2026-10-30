import { Composer, type Context } from "grammy";
import { cancelJob } from "../../jobs/cancel.js";
import { refreshPanelNow } from "../panel/panel.js";

export const cancel = new Composer<Context>();

// Cancels exactly one job by ID. There is deliberately no "cancel the latest" fallback.
cancel.command("cancel", async (ctx) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (userId === undefined || chatId === undefined) {
    return;
  }

  const arg = ctx.match.trim().toLowerCase().replace(/^#/, "");

  // Removing the command keeps the panel as the last message in the chat.
  const deleted = await ctx
    .deleteMessage()
    .then(() => true)
    .catch(() => false);

  if (!/^[0-9a-f]{8}$/.test(arg)) {
    await ctx.reply(
      "To cancel a file, tap its ✕ button in the queue panel, " +
        "or send /cancel followed by its job ID (for example /cancel 1a2b3c4d).",
    );
    await refreshPanelNow(ctx.api, chatId, "bump");
    return;
  }

  const result = await cancelJob(userId, arg);
  if (!result.ok) {
    await ctx.reply(
      result.reason === "not_found"
        ? `No job ${arg} found.`
        : `Job ${arg} has already finished.`,
    );
    await refreshPanelNow(ctx.api, chatId, "bump");
    return;
  }

  await refreshPanelNow(ctx.api, chatId, deleted ? "edit" : "bump");
});
