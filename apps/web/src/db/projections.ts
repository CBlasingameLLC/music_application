/**
 * Projections over the event log.
 *
 * Mastery, streaks, XP, ladder positions and the due queue are all *derived*.
 * Nothing here is authoritative — delete every projection and it rebuilds from
 * the log identically, which is the property the tests check.
 *
 * Catching up reads only events after the stored cursor, so startup costs time
 * proportional to what changed rather than to the size of history. The cursor
 * is written in the same transaction as the state it describes, so it can never
 * run ahead of the data.
 */

import {
  type AppState, type DeclarativeCard, type EtudeEvent, type MasteryState,
  type MotorState, type SkillAccumulator,
  PROJECTION_VERSION, SKILLS, currentMastery, dueAt as masteryDueAt,
  emptyAppState, foldEvents, initialMastery, skillKind, streakFrom,
} from '@etude/core';
import { db, type SkillRow } from './schema';
import { eventsAfter } from './log';

/**
 * Bump whenever fold logic changes. A mismatch discards the derived tables and
 * replays from genesis — safe precisely because they are derived.
 */
const CURSOR_KEY = 'projection:cursor';
const STATE_KEY = 'projection:state';

// The fold itself now lives in core, shared with the historical replay behind
// the analytics. Re-exported here so every existing import keeps working, and
// so there is visibly one definition rather than two that could drift.
export {
  PROJECTION_VERSION, emptyAppState, foldEvents, streakFrom, skillKind,
  type AppState, type SkillAccumulator,
};

function loadAccumulator(row: SkillRow | undefined, skillId: string): SkillAccumulator {
  const kind = skillKind(skillId);
  if (!row) return { mastery: initialMastery(skillId, kind) };
  return {
    mastery: (row.mastery as MasteryState) ?? initialMastery(skillId, kind),
    declarative: row.declarative as DeclarativeCard | undefined,
    motor: row.motor as MotorState | undefined,
  };
}

async function readCursor(): Promise<{ id: string | null; version: number }> {
  const row = await db().meta.get(CURSOR_KEY);
  const value = row?.value as { id?: string | null; version?: number } | undefined;
  return { id: value?.id ?? null, version: value?.version ?? 0 };
}

async function readState(): Promise<AppState> {
  const row = await db().meta.get(STATE_KEY);
  return (row?.value as AppState | undefined) ?? emptyAppState;
}

/**
 * Bring projections up to date with the log.
 *
 * Events, derived state and cursor move together in one transaction. Without
 * that, a crash between writes would leave the cursor claiming work that never
 * landed, and the corruption would be silent.
 */
export async function catchUp(): Promise<AppState> {
  const database = db();
  const cursor = await readCursor();

  const stale = cursor.version !== PROJECTION_VERSION;
  const from = stale ? null : cursor.id;
  let base = stale ? emptyAppState : await readState();

  const events = await eventsAfter(from);
  if (events.length === 0 && !stale) return base;

  const skills = new Map<string, SkillAccumulator>();
  const touched = new Set<string>();
  for (const e of events) {
    if (e.type === 'Activity.Graded') {
      for (const ev of e.payload.skillEvidence) touched.add(ev.skillId);
    }
  }

  if (stale) {
    await database.skills.clear();
  } else {
    for (const id of touched) {
      skills.set(id, loadAccumulator(await database.skills.get(id), id));
    }
  }

  base = foldEvents(base, skills, events);

  const lastId = events.length > 0 ? events[events.length - 1]?.id ?? from : from;

  await database.transaction('rw', database.skills, database.meta, async () => {
    const rows: SkillRow[] = [];
    for (const [skillId, acc] of skills) {
      const due = acc.mastery.kind === 'declarative'
        ? acc.declarative?.card.due ?? null
        : acc.motor ? masteryDueAt(acc.mastery) : null;
      rows.push({
        skillId,
        mastery: acc.mastery,
        declarative: acc.declarative,
        motor: acc.motor,
        dueAt: due ? new Date(due).toISOString() : null,
      });
    }
    if (rows.length > 0) await database.skills.bulkPut(rows);
    await database.meta.put({ key: STATE_KEY, value: base });
    await database.meta.put({
      key: CURSOR_KEY,
      value: { id: lastId, version: PROJECTION_VERSION },
    });
  });

  return base;
}

export async function getAppState(): Promise<AppState> {
  return catchUp();
}

export async function getSkillRows(): Promise<SkillRow[]> {
  return db().skills.toArray();
}

/** Current decayed mastery for every skill that has any history. */
export async function getMasteryMap(now = new Date()): Promise<Map<string, number>> {
  const rows = await getSkillRows();
  const out = new Map<string, number>();
  for (const row of rows) {
    const m = row.mastery as MasteryState | undefined;
    if (m) out.set(row.skillId, currentMastery(m, now));
  }
  return out;
}

/** Drop every derived table. The log is untouched, so this is always safe. */
export async function resetProjections(): Promise<void> {
  const database = db();
  await database.transaction('rw', database.skills, database.meta, async () => {
    await database.skills.clear();
    await database.meta.delete(CURSOR_KEY);
    await database.meta.delete(STATE_KEY);
  });
}

