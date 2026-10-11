import mongoose from "mongoose";
import { config } from "../config.js";
import { logger } from "../logger.js";

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected"),
  );
  mongoose.connection.on("reconnected", () =>
    logger.info("MongoDB reconnected"),
  );

  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: 5000,
  });

  logger.info({ db: mongoose.connection.name }, "MongoDB connected");
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
