import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

// The session grants full access to your Telegram account: it is never
// logged, never sent in chat, and written with owner-only permissions.
export async function readSession(): Promise<string> {
  try {
    return (await readFile(config.gramjs.sessionPath, "utf8")).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

export async function writeSession(value: string): Promise<void> {
  const file = config.gramjs.sessionPath;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, value, { encoding: "utf8", mode: 0o600 });
}
