import { Schema, model } from "mongoose";

const panelSchema = new Schema(
  {
    chatId: { type: Number, required: true, unique: true },
    messageId: { type: Number },
    page: { type: Number, default: 0 },
    lastRendered: { type: String },
  },
  { timestamps: true },
);

export const PanelModel = model("Panel", panelSchema);
