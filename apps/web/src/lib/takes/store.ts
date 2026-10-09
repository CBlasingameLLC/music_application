'use client';

/**
 * Keeping the raw performance, not just the score it earned.
 *
 * A `PerformedTake` is the grader's *input*. Everything the report shows —
 * alignment, tempo map, per-hand deviation, the bar you keep failing — is
 * derived from it, so keeping the take means a better grader can re-analyse
 * every performance ever played. Keeping only the report means the opposite:
 * the analysis is frozen at whatever the grader understood on the day.
 *
 * That is why `Activity.Graded` sits beside `Activity.Attempted` rather than
 * mutating it, and why it carries `graderVersion` — a re-grade is a new event,
 * not a correction. None of that machinery is worth anything without the input
 * it replays, which is what this stores.
 *
 * A take is a few KB of JSON. The event log keeps only the reference, so
 * reading history stays a cheap range scan over small rows.
 */

import type { PerformedTake } from '@etude/core';
import { db, hasIndexedDb } from '@/db/schema';

/**
 * Save a take and return the key to put in `TakeRecorded.midiBlobRef`.
 *
 * Failure is deliberately not fatal. Losing the raw take costs the ability to
 * re-grade it later; refusing to record the attempt because the blob would not
 * write costs the practice itself. The caller gets null and omits the event.
 */
export async function saveTake(takeId: string, take: PerformedTake): Promise<string | null> {
  if (!hasIndexedDb()) return null;
  const ref = `take:${takeId}`;
  try {
    await db().blobs.put({
      id: ref,
      kind: 'midi-take',
      data: new Blob([JSON.stringify(take)], { type: 'application/json' }),
      createdAt: new Date().toISOString(),
      // A take is a recording of the user playing, never imported content, so
      // it is not private in the copyright sense the flag exists for.
      isPrivate: false,
    });
    return ref;
  } catch {
    return null;
  }
}

/** Read a take back for re-grading. Null when it has been evicted or never stored. */
export async function loadTake(ref: string): Promise<PerformedTake | null> {
  if (!hasIndexedDb()) return null;
  try {
    const row = await db().blobs.get(ref);
    if (!row) return null;
    return JSON.parse(await row.data.text()) as PerformedTake;
  } catch {
    return null;
  }
}

/** Every stored take, newest first. The raw material for a re-grade pass. */
export async function listTakeRefs(): Promise<string[]> {
  if (!hasIndexedDb()) return [];
  const rows = await db().blobs.where('kind').equals('midi-take').toArray();
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => r.id);
}
