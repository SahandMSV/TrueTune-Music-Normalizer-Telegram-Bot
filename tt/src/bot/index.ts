import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { allowlist } from "./middleware/allowlist.js";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  bot.use(allowlist(config.allowedUserIds));

  bot.command("start", (ctx) =>
    ctx.reply("TrueTune is online. File processing is not available yet."),
  );

  bot.catch((err) => {
    logger.error(
      { err: err.error, updateId: err.ctx.update.update_id },
      "Unhandled bot error",
    );
  });

  return bot;
}
