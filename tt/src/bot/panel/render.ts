import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { JobStatus } from "../../jobs/states.js";

export const PAGE_SIZE = 8;
export const RECENT_WINDOW_MINUTES = 30;

export interface PanelJob {
  shortId: string;
  status: JobStatus;
  name: string;
  durationSec: number | null;
}

export interface PanelData {
  jobs: PanelJob[];
  recentlyFinished: Record<string, number>;
  queueLimit: number;
}

export interface PanelView {
  text: string;
  keyboard: InlineKeyboard;
  page: number;
}

const STATUS_ICON: Record<JobStatus, string> = {
  queued: "⏳",
  matching: "🔎",
  awaiting_selection: "❓",
  retrieving: "⬇️",
  validating: "🧪",
  tagging: "🏷️",
  completed: "✅",
  failed: "❌",
  cancelled: "🚫",
  timed_out: "⌛",
};

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  matching: "Identifying…",
  awaiting_selection: "Needs your choice",
  retrieving: "Retrieving…",
  validating: "Validating…",
  tagging: "Writing tags…",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function formatDuration(totalSec: number | null): string {
  if (totalSec === null) {
    return "–:––";
  }
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = String(totalSec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function jobDisplayName(source: {
  fileName?: string | null;
  title?: string | null;
  performer?: string | null;
}): string {
  if (source.performer && source.title) {
    return `${source.performer} — ${source.title}`;
  }
  return source.fileName ?? source.title ?? "Untitled audio";
}

export function renderPanel(data: PanelData, requestedPage: number): PanelView {
  const total = data.jobs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const start = page * PAGE_SIZE;
  const visible = data.jobs.slice(start, start + PAGE_SIZE);

  const sections: string[] = [];

  if (total === 0) {
    sections.push(
      "<b>🎵 TrueTune queue</b>\nNothing waiting. Send or forward audio files to add them.",
    );
  } else {
    const inProgress = data.jobs.filter((j) => j.status !== "queued").length;
    const waiting = total - inProgress;
    const summary = [
      inProgress > 0 ? `${inProgress} in progress` : null,
      waiting > 0 ? `${waiting} waiting` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");

    sections.push(`<b>🎵 TrueTune queue</b> · ${total} active\n${summary}`);

    sections.push(
      visible
        .map((job, i) => {
          const n = start + i + 1;
          return (
            `<b>${n}.</b> ${STATUS_ICON[job.status]} ${escapeHtml(truncate(job.name, 60))}\n` +
            `└ ${formatDuration(job.durationSec)} · ${STATUS_LABEL[job.status]} · <code>${job.shortId}</code>`
          );
        })
        .join("\n"),
    );
  }

  const footer: string[] = [];
  if (totalPages > 1) {
    footer.push(`Page ${page + 1} of ${totalPages}`);
  }
  if (total >= data.queueLimit) {
    footer.push(
      `⚠️ Queue is full (${data.queueLimit}). New files are skipped until space frees up.`,
    );
  }
  const recentParts = (
    ["completed", "failed", "timed_out", "cancelled"] as const
  )
    .filter((s) => (data.recentlyFinished[s] ?? 0) > 0)
    .map((s) => `${STATUS_ICON[s]} ${data.recentlyFinished[s]}`);
  // if (recentParts.length > 0) {
  //   footer.push(
  //     // `Last ${RECENT_WINDOW_MINUTES} min: ${recentParts.join(" · ")}`,
  //   );
  // }
  if (footer.length > 0) {
    sections.push(footer.join("\n"));
  }

  const rows: InlineKeyboardButton[][] = visible.map((job, i) => [
    InlineKeyboard.text(
      `✕ ${start + i + 1} · ${truncate(job.name, 30)}`,
      `c:${job.shortId}`,
    ),
  ]);

  if (totalPages > 1) {
    const nav: InlineKeyboardButton[] = [];
    if (page > 0) {
      nav.push(InlineKeyboard.text("‹ Prev", `p:${page - 1}`));
    }
    nav.push(InlineKeyboard.text(`${page + 1}/${totalPages}`, "noop"));
    if (page < totalPages - 1) {
      nav.push(InlineKeyboard.text("Next ›", `p:${page + 1}`));
    }
    rows.push(nav);
  }

  if (total >= 2) {
    rows.push([InlineKeyboard.text(`✕ Cancel all (${total})`, "ca")]);
  }

  return {
    text: sections.join("\n\n"),
    keyboard: new InlineKeyboard(rows),
    page,
  };
}

export function renderCancelAllConfirm(count: number): InlineKeyboard {
  return new InlineKeyboard([
    [InlineKeyboard.text(`✕ Yes, cancel all ${count}`, "cy")],
    [InlineKeyboard.text("Keep them", "cn")],
  ]);
}
