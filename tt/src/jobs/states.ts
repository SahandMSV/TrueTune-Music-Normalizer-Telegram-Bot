export const JOB_STATUSES = [
  "queued",
  "matching",
  "awaiting_selection",
  "retrieving",
  "validating",
  "tagging",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const satisfies readonly JobStatus[];

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["matching", "cancelled", "failed"],
  matching: ["awaiting_selection", "retrieving", "cancelled", "failed"],
  awaiting_selection: [
    "matching",
    "retrieving",
    "cancelled",
    "failed",
    "timed_out",
  ],
  retrieving: [
    "validating",
    "awaiting_selection",
    "cancelled",
    "failed",
    "timed_out",
  ],
  validating: ["tagging", "completed", "cancelled", "failed"],
  tagging: ["completed", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function isTerminal(status: JobStatus): boolean {
  return (TERMINAL_STATUSES as readonly JobStatus[]).includes(status);
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function statusesThatCanReach(to: JobStatus): JobStatus[] {
  return JOB_STATUSES.filter((from) => canTransition(from, to));
}
