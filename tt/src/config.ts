import "dotenv/config";
import path from "node:path";
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

const contact = z
  .string()
  .trim()
  .refine(
    (value) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
      /^https?:\/\/\S+$/.test(value),
    "must be an email address or an http(s) URL",
  );

const telegramUsername = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ""))
  .pipe(
    z.string().regex(/^[A-Za-z0-9_]{4,32}$/, "must be a Telegram username"),
  );

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  OWNER_ID: z.coerce.number().int().positive(),
  ALLOWED_USER_IDS: userIdList,
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/truetune"),
  TEMP_DIR: z.string().min(1).default("tmp"),
  MAX_ACTIVE_JOBS_PER_USER: z.coerce.number().int().positive().default(50),
  MUSICBRAINZ_CONTACT: contact,
  MB_ENRICH_COUNT: z.coerce.number().int().min(0).max(25).default(5),
  TG_API_ID: z.coerce.number().int().positive(),
  TG_API_HASH: z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{32}$/i,
      "must be the 32-character hash from my.telegram.org",
    ),
  GRAMJS_SESSION_PATH: z.string().min(1).default("secrets/gramjs.session"),
  SEARCH_PROVIDER_USERNAME: telegramUsername,
  RECOGNIZER_PROVIDER_USERNAME: telegramUsername,
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
  tempDir: path.resolve(env.TEMP_DIR),
  maxActiveJobsPerUser: env.MAX_ACTIVE_JOBS_PER_USER,
  musicbrainzContact: env.MUSICBRAINZ_CONTACT,
  mbEnrichCount: env.MB_ENRICH_COUNT,
  gramjs: {
    apiId: env.TG_API_ID,
    apiHash: env.TG_API_HASH,
    sessionPath: path.resolve(env.GRAMJS_SESSION_PATH),
  },
  providers: {
    searchUsername: env.SEARCH_PROVIDER_USERNAME,
    recognizerUsername: env.RECOGNIZER_PROVIDER_USERNAME,
  },
  logLevel: env.LOG_LEVEL,
  isProduction: env.NODE_ENV === "production",
} as const;
