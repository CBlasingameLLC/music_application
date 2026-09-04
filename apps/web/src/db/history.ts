'use client';

/**
 * Reading the whole log, for the views that need history rather than now.
 *
 * The live projection reads only events after its cursor, so startup costs time
 * proportional to what changed. The dashboard cannot do that: a trend needs
 * every event, replayed in order, because mastery as of the 3rd is a different
 * question from mastery today.
 *
 * That is affordable — a year of daily practice measured at 681 ms — but it is
 * not free, so it is cached on the log's newest event id. The log is
 * append-only and ULIDs sort by creation time, so an unchanged newest id means
 * an unchanged log, and the cache can never serve something stale.
 */

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { EtudeEvent } from '@etude/core';
import { db, hasIndexedDb } from './schema';

export interface LogHistory {
  readonly events: readonly EtudeEvent[];
  readonly ready: boolean;
}

let cache: { id: string | null; events: EtudeEvent[] } | null = null;

/** Every event, oldest first. Cached until the log grows. */
export async function readWholeLog(): Promise<EtudeEvent[]> {
  if (!hasIndexedDb()) return [];

  const newest = await db().events.orderBy('id').last();
  const id = newest?.id ?? null;
  if (cache && cache.id === id) return cache.events;

  // ULID primary keys sort lexicographically by creation time, so ordering by
  // the key *is* ordering by when it happened — no separate sort needed.
  const rows = await db().events.orderBy('id').toArray();
  const events = rows as unknown as EtudeEvent[];
  cache = { id, events };
  return events;
}

/** Drop the cache. Used after an import replaces the log wholesale. */
export function forgetHistory(): void {
  cache = null;
}

export function useLogHistory(): LogHistory {
  const count = useLiveQuery(() => (hasIndexedDb() ? db().events.count() : 0), [], -1);
  const [events, setEvents] = useState<EtudeEvent[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (count < 0) return;
    let cancelled = false;
    void readWholeLog().then((all) => {
      if (cancelled) return;
      setEvents(all);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [count]);

  return { events, ready };
}
