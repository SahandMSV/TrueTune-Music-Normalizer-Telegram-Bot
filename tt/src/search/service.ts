import {
  ProviderSearchModel,
  type ProviderSearchDocument,
} from "../db/models/providerSearch.js";

export interface CreateSearchInput {
  userId: number;
  chatId: number;
  messageId: number;
  query: string;
  providerMessageId: number;
  service: string;
  results: { n: number; label: string; data: string }[];
}

export async function createSearch(
  input: CreateSearchInput,
): Promise<ProviderSearchDocument> {
  return ProviderSearchModel.create(input);
}

// Atomic: a search can have only one retrieval running at a time.
export async function claimPick(
  shortId: string,
  userId: number,
  n: number,
): Promise<ProviderSearchDocument | null> {
  return ProviderSearchModel.findOneAndUpdate(
    { shortId, userId, state: "idle" },
    { $set: { state: "retrieving", pickedN: n } },
    { returnDocument: "after" },
  );
}

export async function releasePick(shortId: string): Promise<void> {
  await ProviderSearchModel.updateOne(
    { shortId },
    { $set: { state: "idle" }, $unset: { pickedN: "" } },
  );
}

// After a restart nothing is actually retrieving.
export async function resetStaleRetrievals(): Promise<number> {
  const result = await ProviderSearchModel.updateMany(
    { state: "retrieving" },
    { $set: { state: "idle" }, $unset: { pickedN: "" } },
  );
  return result.modifiedCount;
}
