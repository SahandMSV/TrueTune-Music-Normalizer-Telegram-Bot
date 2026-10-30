export class ProviderBusyError extends Error {
  constructor() {
    super("Provider queue is full");
    this.name = "ProviderBusyError";
  }
}

// Replies from the provider can't be told apart between requests,
// so only one conversation with it runs at a time.
const MAX_PENDING = 5;

let tail: Promise<void> = Promise.resolve();
let pending = 0;

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  if (pending >= MAX_PENDING) {
    return Promise.reject(new ProviderBusyError());
  }
  pending += 1;

  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );

  return run.finally(() => {
    pending -= 1;
  });
}
