import { InlineKeyboard, type Api } from "grammy";
import { escapeHtml, truncate } from "../bot/panel/render.js";
import { logger } from "../logger.js";

export interface SearchView {
  shortId: string;
  query: string;
  results: { n: number; label: string }[];
}

export function renderResults(
  view: SearchView,
  footer: string | null,
): { text: string; keyboard: InlineKeyboard } {
  const lines = [
    `<b>Results for</b> “${escapeHtml(truncate(view.query, 80))}”`,
    "Tap the track you want.",
  ];
  if (footer) {
    lines.push("", escapeHtml(footer));
  }

  const keyboard = new InlineKeyboard();
  for (const result of view.results) {
    keyboard
      .text(
        `${result.n}. ${truncate(result.label, 55)}`,
        `s:${view.shortId}:${result.n}`,
      )
      .row();
  }
  keyboard.text("✕ Close", `sx:${view.shortId}`);

  return { text: lines.join("\n"), keyboard };
}

// Omitting the keyboard removes it from the message.
export async function editMessage(
  api: Api,
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  try {
    await api.editMessageText(chatId, messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    logger.debug(
      { reason: err instanceof Error ? err.message : "unknown" },
      "Could not edit message",
    );
  }
}
