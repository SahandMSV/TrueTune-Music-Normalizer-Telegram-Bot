import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { allowlist } from "./middleware/allowlist.js";
import { cancel } from "./handlers/cancel.js";
import { intake } from "./handlers/intake.js";
import { panelActions } from "./handlers/panelActions.js";
import { probe } from "./handlers/probe.js";
import { relay } from "./handlers/relay.js";
import { textSearch } from "./handlers/textSearch.js";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  // Retries rate-limited calls, which matters when a user forwards many files at once.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

  bot.use(allowlist(config.allowedUserIds));

  bot.command("start", (ctx) =>
    ctx.reply(
      "TrueTune is online.\n\n" +
        "• Type a track name to search and get the file.\n" +
        "• Audio files you send or forward appear in a queue panel. " +
        "Identifying and fixing them isn't finished yet.",
    ),
  );

  bot.use(panelActions);
  bot.use(probe);
  // Must come before intake so a relayed audio never becomes a job.
  bot.use(relay);
  bot.use(intake);
  bot.use(cancel);
  bot.use(textSearch);

  bot.catch((err) => {
    logger.error(
      { err: err.error, updateId: err.ctx.update.update_id },
      "Unhandled bot error",
    );
  });

  return bot;
}
