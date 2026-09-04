/**
 * The append-only event log.
 *
 * Everything the app knows about your practice is derived from this log. Mastery,
 * streaks, XP and the review queue are *projections* over it, never independently
 * mutated state. Three things follow from that, and each one is load-bearing:
 *
 *  1. Adding cloud sync later means shipping the log, not migrating a schema.
 *  2. Grading is versioned: `AttemptGraded` is separate from `ActivityAttempted`,
 *     so re-grading an old take with a better algorithm appends a new event
 *     rather than overwriting history.
 *  3. Raw MIDI takes are stored, so improved analysis can run retroactively over
 *     everything you have ever played.
 */

import { ulid } from 'ulid';

/** Monotonic, lexicographically sortable id. Time-ordered without a server. */
export type EventId = string;

export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  /** ULID. Sorts by creation time, which is what makes incremental folds cheap. */
  readonly id: EventId;
  readonly streamId: string;
  readonly seq: number;
  readonly type: TType;
  /** Payload schema version, read by the upcaster chain. */
  readonly v: number;
  /** ISO-8601 UTC. */
  readonly at: string;
  readonly deviceId: string;
  readonly appVersion: string;
  readonly payload: TPayload;
  readonly causationId?: EventId;
  readonly correlationId?: string;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type TimeBudgetMinutes = 10 | 20 | 45;

export interface SessionStarted {
  readonly sessionId: string;
  readonly budgetMinutes: TimeBudgetMinutes;
  readonly plan: ReadonlyArray<{ slot: string; activityIds: string[] }>;
}

export interface SessionEnded {
  readonly sessionId: string;
  readonly elapsedSeconds: number;
  readonly completedActivities: number;
}

export interface ActivityPresented {
  readonly sessionId: string | null;
  readonly activityId: string;
  readonly modeId: string;
  readonly rungId: string;
  readonly skillIds: readonly string[];
  /** Deterministic regeneration key for procedurally generated drills. */
  readonly seed: number;
}

export interface ActivityAttempted {
  readonly attemptId: string;
  readonly activityId: string;
  readonly sessionId: string | null;
  readonly responseMs: number;
  /** What the user actually did, mode-specific and deliberately untyped here. */
  readonly response: unknown;
  /** Which on-screen aids were visible. Drives the XP scaffold multiplier. */
  readonly scaffolds: readonly string[];
}

export interface AttemptGraded {
  readonly attemptId: string;
  readonly correctness: number;
  readonly latencyMs: number;
  readonly diagnostics: Readonly<Record<string, number>>;
  readonly skillEvidence: readonly SkillEvidence[];
  readonly xpAwarded: number;
  /** Bumped whenever the grader changes, so re-grades are identifiable. */
  readonly graderVersion: number;
}

export interface SkillEvidence {
  readonly skillId: string;
  readonly correctness: number;
  /** How much this attempt should move the mastery estimate, 0-1. */
  readonly weight: number;
}

export interface ActivityAbandoned {
  readonly activityId: string;
  readonly sessionId: string | null;
  readonly reason: 'skipped' | 'timeout' | 'navigated-away';
}

export interface TakeRecorded {
  readonly takeId: string;
  readonly activityId: string;
  /** Key into the blob store. Raw MIDI is kept so takes can be re-graded later. */
  readonly midiBlobRef: string;
  readonly tempoTarget: number | null;
  readonly deviceProfileId: string;
  /** Measured output latency at capture time; without it every metric is biased. */
  readonly audioOffsetMs: number;
}

export interface LadderMoved {
  readonly modeId: string;
  readonly fromRungId: string;
  readonly toRungId: string;
  readonly direction: 'promote' | 'demote';
}

export interface SkillUnlocked {
  readonly skillId: string;
}

export interface SettingChanged {
  readonly key: string;
  readonly value: unknown;
}

export interface DeviceCalibrated {
  readonly deviceProfileId: string;
  readonly audioOutputLatencyMs: number;
  readonly inputLatencyMs: number;
}

export interface ContentImported {
  readonly contentId: string;
  readonly title: string;
  readonly format: 'musicxml' | 'midi';
  readonly source: 'bundled' | 'generated' | 'userImported';
  /** User-imported content is private and must never sync or ship. */
  readonly isPrivate: boolean;
}

/** The discriminated union of every event the app can append. */
export type EtudeEvent =
  | EventEnvelope<'Session.Started', SessionStarted>
  | EventEnvelope<'Session.Ended', SessionEnded>
  | EventEnvelope<'Activity.Presented', ActivityPresented>
  | EventEnvelope<'Activity.Attempted', ActivityAttempted>
  | EventEnvelope<'Activity.Graded', AttemptGraded>
  | EventEnvelope<'Activity.Abandoned', ActivityAbandoned>
  | EventEnvelope<'Take.Recorded', TakeRecorded>
  | EventEnvelope<'Ladder.Moved', LadderMoved>
  | EventEnvelope<'Skill.Unlocked', SkillUnlocked>
  | EventEnvelope<'Setting.Changed', SettingChanged>
  | EventEnvelope<'Device.Calibrated', DeviceCalibrated>
  | EventEnvelope<'Content.Imported', ContentImported>;

export type EtudeEventType = EtudeEvent['type'];

/** Current payload version for each event type, read by the upcaster chain. */
export const EVENT_VERSIONS: Record<EtudeEventType, number> = {
  'Session.Started': 1,
  'Session.Ended': 1,
  'Activity.Presented': 1,
  'Activity.Attempted': 1,
  'Activity.Graded': 1,
  'Activity.Abandoned': 1,
  'Take.Recorded': 1,
  'Ladder.Moved': 1,
  'Skill.Unlocked': 1,
  'Setting.Changed': 1,
  'Device.Calibrated': 1,
  'Content.Imported': 1,
};

/** Bumped whenever grading logic changes, so re-grades can be told apart. */
export const GRADER_VERSION = 1;

export interface EventContext {
  readonly deviceId: string;
  readonly appVersion: string;
  readonly streamId?: string;
}

let seqCounter = 0;

/**
 * Build an event envelope. `seq` is a within-session ordering hint only; the
 * ULID is the real ordering key, so a restart resetting the counter is harmless.
 */
export function makeEvent<T extends EtudeEvent>(
  type: T['type'],
  payload: T['payload'],
  ctx: EventContext,
  extra: { causationId?: EventId; correlationId?: string } = {},
): EtudeEvent {
  return {
    id: ulid(),
    streamId: ctx.streamId ?? 'practice',
    seq: seqCounter++,
    type,
    v: EVENT_VERSIONS[type],
    at: new Date().toISOString(),
    deviceId: ctx.deviceId,
    appVersion: ctx.appVersion,
    payload,
    ...extra,
  } as EtudeEvent;
}

/**
 * Upcast an event read from storage to the current payload shape.
 *
 * Every version bump adds a case here rather than migrating stored rows. The
 * log stays immutable; only the read path changes. This function plus the
 * stable envelope *is* the Dial integration seam — an outbound adapter reads
 * events after a cursor, maps them, and posts.
 */
export function upcast(raw: EventEnvelope): EtudeEvent {
  const current = EVENT_VERSIONS[raw.type as EtudeEventType];
  if (current === undefined) {
    throw new Error(`unknown event type in log: ${raw.type}`);
  }
  if (raw.v === current) return raw as EtudeEvent;
  if (raw.v > current) {
    throw new Error(
      `event ${raw.id} is version ${raw.v}, newer than this build understands (${current}). ` +
        'Update the app rather than dropping the event.',
    );
  }
  // No historical versions yet. Each future bump adds a step here.
  return raw as EtudeEvent;
}

/** Narrowing helper so projections can switch on type without casting. */
export function isEventOfType<T extends EtudeEventType>(
  event: EtudeEvent,
  type: T,
): event is Extract<EtudeEvent, { type: T }> {
  return event.type === type;
}

export { ulid };
