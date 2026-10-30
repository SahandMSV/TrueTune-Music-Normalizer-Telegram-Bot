import { Api } from "telegram";

export interface AudioDetails {
  fileName: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  title: string | null;
  performer: string | null;
}

// Reads raw attributes: message.file's getters throw in this GramJS version.
export function audioDetails(message: Api.Message): AudioDetails | null {
  const media = message.media;
  if (
    !(media instanceof Api.MessageMediaDocument) ||
    !(media.document instanceof Api.Document)
  ) {
    return null;
  }

  const doc = media.document;
  const details: AudioDetails = {
    fileName: null,
    mimeType: doc.mimeType,
    sizeBytes: Number(doc.size.toString()),
    durationSec: null,
    title: null,
    performer: null,
  };

  let isAudio = false;
  for (const attribute of doc.attributes) {
    if (attribute instanceof Api.DocumentAttributeFilename) {
      details.fileName = attribute.fileName;
    } else if (
      attribute instanceof Api.DocumentAttributeAudio &&
      !attribute.voice
    ) {
      isAudio = true;
      details.durationSec = attribute.duration;
      details.title = attribute.title ?? null;
      details.performer = attribute.performer ?? null;
    }
  }

  return isAudio ? details : null;
}

export function hasPhoto(message: Api.Message): boolean {
  return message.media instanceof Api.MessageMediaPhoto;
}
