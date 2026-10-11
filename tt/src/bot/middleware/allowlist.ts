import type { Context, MiddlewareFn } from "grammy";
import { logger } from "../../logger.js";

export function allowlist(allowed: ReadonlySet<number>): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (userId === undefined || !allowed.has(userId)) {
      logger.warn({ userId }, "Rejected update from non-allowlisted user");
      if (ctx.chat?.type === "private") {
        await ctx.reply("TrueTune is currently private.");
      }
      return;
    }

    if (ctx.chat?.type !== "private") {
      return;
    }

    await next();
  };
}
