import { TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { readSession } from "./session.js";

export class GramjsNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GramjsNotReadyError";
  }
}

let client: TelegramClient | null = null;
let starting: Promise<TelegramClient> | null = null;

export function createClient(session: string): TelegramClient {
  const created = new TelegramClient(
    new StringSession(session),
    config.gramjs.apiId,
    config.gramjs.apiHash,
    { connectionRetries: 5 },
  );
  created.setLogLevel(LogLevel.ERROR);
  return created;
}

async function start(): Promise<TelegramClient> {
  const session = await readSession();
  if (!session) {
    throw new GramjsNotReadyError(
      "No GramJS session found. Run `pnpm gramjs:login` first.",
    );
  }

  const created = createClient(session);
  await created.connect();

  if (!(await created.isUserAuthorized())) {
    await created.disconnect();
    throw new GramjsNotReadyError(
      "The saved GramJS session is no longer authorized. Run `pnpm gramjs:login` again.",
    );
  }

  const me = await created.getMe();
  logger.info({ userId: String(me.id) }, "GramJS connected");
  return created;
}

export async function getUserClient(): Promise<TelegramClient> {
  if (client) {
    if (!client.connected) {
      await client.connect();
    }
    return client;
  }

  starting ??= start();
  try {
    client = await starting;
    return client;
  } finally {
    starting = null;
  }
}

export async function closeUserClient(): Promise<void> {
  const current = client;
  client = null;
  if (current) {
    await current.disconnect().catch(() => undefined);
  }
}
