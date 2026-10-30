import { createInterface } from "node:readline/promises";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config.js";
import { createClient } from "../gramjs/client.js";
import { writeSession } from "../gramjs/session.js";

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> => rl.question(question);

  const client = createClient("");

  await client.start({
    phoneNumber: () =>
      ask("Phone number (international format, e.g. +98...): "),
    phoneCode: () => ask("Login code sent by Telegram: "),
    password: () => ask("2FA password (leave empty if you have none): "),
    onError: async (err) => {
      console.error(`Login error: ${err.message}`);
      return false;
    },
  });

  // createClient always uses a StringSession; the client's own type is the abstract one.
  const saved = (client.session as StringSession).save();
  if (saved.length === 0) {
    throw new Error("GramJS did not return a session string");
  }

  await writeSession(saved);
  const me = await client.getMe();
  console.log(`Logged in as user id ${String(me.id)}.`);
  console.log(`Session saved to ${config.gramjs.sessionPath}`);

  rl.close();
  await client.disconnect();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Login failed");
  process.exit(1);
});
