import { createBot } from "./bot/index.js";
import { connectDatabase, disconnectDatabase } from "./db/connection.js";
import { cleanProviderTemp } from "./delivery/deliver.js";
import { closeUserClient, getUserClient } from "./gramjs/client.js";
import { startWorker } from "./jobs/worker.js";
import { logger } from "./logger.js";
import { resetStaleRetrievals } from "./search/service.js";

async function main(): Promise<void> {
  await connectDatabase();

  const reset = await resetStaleRetrievals();
  if (reset > 0) {
    logger.info({ count: reset }, "Reset interrupted retrievals");
  }
  await cleanProviderTemp();

  // The bot works without GramJS; only retrieval features need it.
  await getUserClient().catch((err: unknown) =>
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "GramJS is not ready",
    ),
  );

  const bot = createBot();

  await bot.api
    .setMyCommands([
      { command: "queue", description: "Show the queue panel" },
      { command: "cancel", description: "Cancel one job: /cancel <job ID>" },
    ])
    .catch((err: unknown) =>
      logger.warn(
        { reason: err instanceof Error ? err.message : "unknown" },
        "Could not set bot commands",
      ),
    );

  const worker = startWorker(bot.api);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    await bot.stop();
    await worker.stop();
    await closeUserClient();
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
