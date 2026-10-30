import { randomBytes } from "node:crypto";

export interface RelayedAudio {
  fileId: string;
}

interface Waiter {
  resolve: (value: RelayedAudio | null) => void;
  timer: NodeJS.Timeout;
}

const PREFIX = "tt-relay:";
const CAPTION = /^tt-relay:([0-9a-f]{16})$/;

const waiters = new Map<string, Waiter>();

function finish(token: string, value: RelayedAudio | null): boolean {
  const waiter = waiters.get(token);
  if (!waiter) {
    return false;
  }
  clearTimeout(waiter.timer);
  waiters.delete(token);
  waiter.resolve(value);
  return true;
}

export function parseRelayCaption(caption: string | undefined): string | null {
  return CAPTION.exec((caption ?? "").trim())?.[1] ?? null;
}

// The random token ties the message the bot receives to the delivery waiting for it.
export function startRelay(timeoutMs: number): {
  caption: string;
  result: Promise<RelayedAudio | null>;
  cancel(): void;
} {
  const token = randomBytes(8).toString("hex");

  const result = new Promise<RelayedAudio | null>((resolve) => {
    const timer = setTimeout(() => finish(token, null), timeoutMs);
    waiters.set(token, { resolve, timer });
  });

  return {
    caption: `${PREFIX}${token}`,
    result,
    cancel: () => {
      finish(token, null);
    },
  };
}

export function completeRelay(token: string, value: RelayedAudio): boolean {
  return finish(token, value);
}
