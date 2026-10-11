import { createBot } from "./bot/index.js";
import { connectDatabase, disconnectDatabase } from "./db/connection.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  await connectDatabase();

  const bot = createBot();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    await bot.stop();
    await disconnectDatabase();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await bot.start({
    onStart: (info) =>
      logger.info({ username: info.username }, "TrueTune is running"),
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
