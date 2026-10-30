import type { Api, TelegramClient } from "telegram";
import { EditedMessage } from "telegram/events/EditedMessage.js";
import { NewMessage } from "telegram/events/NewMessage.js";
import { logger } from "../logger.js";

type Predicate = (message: Api.Message) => boolean;

interface Waiter {
  predicate: Predicate;
  resolve: (message: Api.Message | null) => void;
  timer: NodeJS.Timeout;
}

export interface Listener {
  readonly messages: readonly Api.Message[];
  waitFor(predicate: Predicate, timeoutMs: number): Promise<Api.Message | null>;
  close(): void;
}

function test(predicate: Predicate, message: Api.Message): boolean {
  try {
    return predicate(message);
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "Listener predicate failed",
    );
    return false;
  }
}

/**
 * Buffers both new and edited messages from one bot.
 * An edit updates the stored version of that message id so waitFor
 * always sees the latest keyboard / text.
 */
export function listen(client: TelegramClient, username: string): Listener {
  const messages: Api.Message[] = [];
  const consumed = new Set<number>();
  const waiters: Waiter[] = [];

  function settle(waiter: Waiter, message: Api.Message | null): void {
    clearTimeout(waiter.timer);
    const index = waiters.indexOf(waiter);
    if (index >= 0) {
      waiters.splice(index, 1);
    }
    waiter.resolve(message);
  }

  const handler = (event: { message: Api.Message }): void => {
    const message = event.message;
    const existingIdx = messages.findIndex((m) => m.id === message.id);
    if (existingIdx >= 0) {
      messages[existingIdx] = message;
    } else {
      messages.push(message);
    }

    for (const waiter of [...waiters]) {
      if (consumed.has(message.id)) break;
      if (test(waiter.predicate, message)) {
        consumed.add(message.id);
        settle(waiter, message);
      }
    }
  };

  const filter = { incoming: true, fromUsers: [username] };
  const newBuilder = new NewMessage(filter);
  const editedBuilder = new EditedMessage(filter);

  client.addEventHandler(handler, newBuilder);
  client.addEventHandler(handler, editedBuilder);

  return {
    messages,

    waitFor(predicate, timeoutMs) {
      const existing = [...messages]
        .reverse()
        .find((m) => !consumed.has(m.id) && test(predicate, m));
      if (existing) {
        consumed.add(existing.id);
        return Promise.resolve(existing);
      }

      return new Promise<Api.Message | null>((resolve) => {
        const waiter: Waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => settle(waiter, null), timeoutMs),
        };
        waiters.push(waiter);
      });
    },

    close() {
      client.removeEventHandler(handler, newBuilder);
      client.removeEventHandler(handler, editedBuilder);
      for (const waiter of [...waiters]) {
        settle(waiter, null);
      }
    },
  };
}
