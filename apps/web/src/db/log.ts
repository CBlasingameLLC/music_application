/**
 * Appending to and reading from the event log.
 *
 * Nothing else in the app writes history. Every user action funnels through
 * `append`, which is what keeps projections derivable and makes the eventual
 * Dial sync a matter of reading forward from a cursor.
 */

import type { EtudeEvent, EventContext } from '@etude/core';
import { makeEvent, upcast } from '@etude/core';
import { db, type StoredEvent } from './schema';

const DEVICE_KEY = 'etude.deviceId';
export const APP_VERSION = '0.1.0';

/** Stable per-device id, used to attribute events and to key calibration. */
export function deviceId(): string {
  if (typeof localStorage === 'undefined') return 'server';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function eventContext(): EventContext {
  return { deviceId: deviceId(), appVersion: APP_VERSION };
}

/** Append one event. Returns the stored envelope so callers can chain causation. */
export async function append<T extends EtudeEvent>(
  type: T['type'],
  payload: T['payload'],
  extra: { causationId?: string; correlationId?: string } = {},
): Promise<EtudeEvent> {
  const event = makeEvent(type, payload, eventContext(), extra);
  await db().events.add(event as StoredEvent);
  return event;
}

/** Append several events atomically. Either all land or none do. */
export async function appendMany(
  entries: ReadonlyArray<{ type: EtudeEvent['type']; payload: EtudeEvent['payload'] }>,
): Promise<EtudeEvent[]> {
  const ctx = eventContext();
  const events = entries.map((e) => makeEvent(e.type, e.payload, ctx));
  await db().events.bulkAdd(events as StoredEvent[]);
  return events;
}

/**
 * Every event strictly after `cursor`, oldest first.
 *
 * ULID ordering means this is a bounded range scan, so catching a projection up
 * costs time proportional to what changed rather than to the size of history.
 */
export async function eventsAfter(
  cursor: string | null,
  limit?: number,
): Promise<EtudeEvent[]> {
  const table = db().events;
  const collection = cursor
    ? table.where('id').above(cursor)
    : table.orderBy('id');
  const rows = limit ? await collection.limit(limit).toArray() : await collection.toArray();
  return rows.map((r) => upcast(r));
}

export async function eventCount(): Promise<number> {
  return db().events.count();
}

export async function latestEventId(): Promise<string | null> {
  const last = await db().events.orderBy('id').last();
  return last?.id ?? null;
}

/**
 * Full history as JSON.
 *
 * Doubles as the backup path and as the manual Dial hand-off until the sync
 * adapter is switched on. Worth having early precisely because IndexedDB
 * persistence is only best-effort on Fire OS.
 */
export async function exportLog(): Promise<string> {
  const events = await db().events.orderBy('id').toArray();
  return JSON.stringify(
    { format: 'etude-event-log', version: 1, exportedAt: new Date().toISOString(), events },
    null,
    2,
  );
}

/** Merge an exported log back in. Existing ids are skipped, never overwritten. */
export async function importLog(json: string): Promise<{ added: number; skipped: number }> {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== 'object' || parsed === null ||
    (parsed as { format?: string }).format !== 'etude-event-log'
  ) {
    throw new Error('Not an Étude event log.');
  }
  const events = (parsed as { events?: StoredEvent[] }).events ?? [];
  const existing = new Set(await db().events.toCollection().primaryKeys());

  const fresh = events.filter((e) => !existing.has(e.id));
  if (fresh.length > 0) await db().events.bulkAdd(fresh);
  return { added: fresh.length, skipped: events.length - fresh.length };
}
