import { GramjsNotReadyError } from "../gramjs/client.js";
import { ProviderBusyError } from "./queue.js";

export type ProviderErrorCode = "no_results" | "refused" | "timeout" | "failed";

export class ProviderError extends Error {
  code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

// User-facing text only: nothing here can contain credentials or internals.
export function describeFailure(err: unknown): string {
  if (err instanceof ProviderBusyError) {
    return "Too many requests are waiting for the provider. Try again in a moment.";
  }
  if (err instanceof GramjsNotReadyError) {
    return "The music provider account isn't connected right now.";
  }
  if (err instanceof ProviderError) {
    switch (err.code) {
      case "no_results":
        return "No tracks found for that search. Try different words.";
      case "refused":
        return "The provider refused this request.";
      case "timeout":
        return "The provider didn't deliver in time. Try another result or search again.";
      case "failed":
        return "The provider's file couldn't be fetched. Try another result.";
    }
  }
  return "Something went wrong. Please try again.";
}
