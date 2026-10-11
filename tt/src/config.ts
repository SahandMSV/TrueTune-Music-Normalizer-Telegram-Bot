import "dotenv/config";
import { z } from "zod";

const userIdList = z
  .string()
  .default("")
  .transform((raw, ctx) => {
    const ids: number[] = [];
    for (const part of raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        ctx.addIssue({ code: "custom", message: `Invalid user id: ${part}` });
        return z.NEVER;
      }
      ids.push(id);
    }
    return ids;
  });

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  OWNER_ID: z.coerce.number().int().positive(),
  ALLOWED_USER_IDS: userIdList,
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/truetune"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

export const config = {
  botToken: env.BOT_TOKEN,
  ownerId: env.OWNER_ID,
  allowedUserIds: new Set<number>([env.OWNER_ID, ...env.ALLOWED_USER_IDS]),
  mongodbUri: env.MONGODB_URI,
  logLevel: env.LOG_LEVEL,
  isProduction: env.NODE_ENV === "production",
} as const;
