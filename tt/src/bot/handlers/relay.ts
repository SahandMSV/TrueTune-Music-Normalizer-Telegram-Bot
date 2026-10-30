import { Composer, type Context } from "grammy";
import { completeRelay, parseRelayCaption } from "../../delivery/relay.js";

export const relay = new Composer<Context>();

// Audio re-sent by our own account carries a one-time token in its caption.
// It is consumed here and removed from the chat; it never becomes a job.
relay.on("message:audio", async (ctx, next) => {
  const token = parseRelayCaption(ctx.message.caption);
  if (token === null) {
    await next();
    return;
  }

  completeRelay(token, { fileId: ctx.message.audio.file_id });
  await ctx.deleteMessage().catch(() => undefined);
});
