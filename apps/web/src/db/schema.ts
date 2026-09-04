/**
 * Local-first storage.
 *
 * IndexedDB is the source of truth. There is no server, and adding one later
 * means shipping the event log rather than migrating a mutable schema — which
 * is the whole reason the log exists.
 *
 * Layout notes that matter:
 *  - Events are keyed by ULID, which sorts lexicographically by creation time.
 *    That is what makes "everything after cursor X" a cheap range scan instead
 *    of a full table read.
 *  - Per-skill state lives in its own row rather than inside one big projection
 *    blob, so updating one skill does not rewrite all seventy.
 *  - Raw MIDI takes get their own store. They are a few KB each and they let a
 *    better grader re-analyse everything you have ever played.
 */

import Dexie, { type Table } from 'dexie';
import type { EventEnvelope } from '@etude/core';

export interface StoredEvent extends EventEnvelope {
  /** Duplicated out of the envelope so Dexie can index it. */
  readonly type: string;
  readonly at: string;
}

export interface SkillRow {
  readonly skillId: string;
  /** Serialized MasteryState. */
  readonly mastery: unknown;
  /** Serialized FSRS card, for declarative skills. */
  readonly declarative?: unknown;
  /** Serialized MotorState, for motor skills. */
  readonly motor?: unknown;
  /** Denormalized for range queries on the due list. */
  readonly dueAt: string | null;
}

export interface MetaRow {
  readonly key: string;
  readonly value: unknown;
}

export interface BlobRow {
  readonly id: string;
  readonly kind: 'midi-take' | 'musicxml' | 'audio';
  readonly data: Blob;
  readonly createdAt: string;
  /** User-imported content never syncs and never ships. */
  readonly isPrivate: boolean;
}

export class EtudeDb extends Dexie {
  events!: Table<StoredEvent, string>;
  skills!: Table<SkillRow, string>;
  meta!: Table<MetaRow, string>;
  blobs!: Table<BlobRow, string>;

  constructor() {
    super('etude');
    this.version(1).stores({
      events: 'id, type, at',
      skills: 'skillId, dueAt',
      meta: 'key',
      blobs: 'id, kind, createdAt',
    });
  }
}

let instance: EtudeDb | null = null;

/** The database is created lazily so importing this module is safe on the server. */
export function db(): EtudeDb {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable — db() must only be called in the browser');
  }
  instance ??= new EtudeDb();
  return instance;
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Ask the browser not to evict our data.
 *
 * Chromium grants this by heuristic with no prompt — installing to the home
 * screen materially improves the odds. Losing practice history would be the
 * worst failure this app has, so we ask on every start and surface the answer
 * in diagnostics rather than assuming it worked.
 */
export async function requestPersistence(): Promise<{
  persisted: boolean;
  supported: boolean;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { persisted: false, supported: false };
  }
  try {
    const already = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : false;
    if (already) return { persisted: true, supported: true };
    return { persisted: await navigator.storage.persist(), supported: true };
  } catch {
    return { persisted: false, supported: true };
  }
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
