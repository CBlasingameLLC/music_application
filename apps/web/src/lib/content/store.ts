'use client';

/**
 * Where scores live on the device.
 *
 * Imported files are stored in OPFS with metadata in IndexedDB. The separation
 * matters: OPFS holds bytes efficiently and IndexedDB is queryable, so the
 * library page can list what you have without reading every file.
 *
 * **User-imported content never leaves the device.** It is not in git, it is
 * not in the build, and it is not in any sync payload. That is enforced by
 * architecture rather than by a `.gitignore` rule: there is no code path that
 * reads a bundled private score, because no such thing exists. A copyrighted
 * arrangement you import is yours, stays yours, and cannot leak through a
 * public release of this app.
 */

import {
  type Provenance, type Score, MusicXmlParseError, parseMusicXml,
} from '@etude/core';
import { db } from '@/db/schema';
import { append } from '@/db/log';

const DIRECTORY = 'scores';

export interface StoredScore {
  readonly id: string;
  readonly title: string;
  readonly composer: string | null;
  readonly provenance: Provenance;
  readonly importedAt: string;
  readonly measureCount: number;
  readonly sizeBytes: number;
}

function opfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

async function scoreDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

/** Metadata rows live in the existing `meta` table under a namespaced key. */
const metaKey = (id: string): string => `score:${id}`;

export async function listScores(): Promise<StoredScore[]> {
  const rows = await db().meta.toArray();
  return rows
    .filter((r) => r.key.startsWith('score:'))
    .map((r) => r.value as StoredScore)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function readScoreXml(id: string): Promise<string | null> {
  if (opfsAvailable()) {
    try {
      const dir = await scoreDirectory();
      const handle = await dir.getFileHandle(`${id}.musicxml`);
      return await (await handle.getFile()).text();
    } catch {
      // Fall through to the IndexedDB copy below.
    }
  }
  const blob = await db().blobs.get(id);
  return blob ? blob.data.text() : null;
}

export interface ImportResult {
  readonly stored: StoredScore;
  readonly score: Score;
}

/**
 * Import a MusicXML file.
 *
 * Parsed before it is stored, so a file that cannot be read is rejected with a
 * reason rather than sitting in the library as a broken entry.
 */
export async function importScoreFile(file: File): Promise<ImportResult> {
  const text = await file.text();

  if (file.name.endsWith('.mxl') || text.slice(0, 2) === 'PK') {
    throw new MusicXmlParseError(
      'This is a compressed .mxl file. Export it as uncompressed MusicXML (.musicxml or .xml) and import that.',
    );
  }

  const id = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Imports are private by default. Anything else would be the wrong default
  // for a file whose licence we cannot know.
  const provenance: Provenance = {
    source: 'userImported',
    license: 'unknown',
    attribution: null,
    isPrivate: true,
  };

  const score = parseMusicXml(text, { id, provenance });

  if (opfsAvailable()) {
    const dir = await scoreDirectory();
    const handle = await dir.getFileHandle(`${id}.musicxml`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  } else {
    // OPFS is unavailable on some browsers; IndexedDB keeps the file on-device
    // just the same, which is the property that actually matters.
    await db().blobs.put({
      id,
      kind: 'musicxml',
      data: new Blob([text], { type: 'application/vnd.recordare.musicxml+xml' }),
      createdAt: new Date().toISOString(),
      isPrivate: true,
    });
  }

  const stored: StoredScore = {
    id,
    title: score.title,
    composer: score.composer,
    provenance,
    importedAt: new Date().toISOString(),
    measureCount: score.parts[0]?.measures.length ?? 0,
    sizeBytes: text.length,
  };

  await db().meta.put({ key: metaKey(id), value: stored });

  // The event log records that content exists, never its bytes. Even when sync
  // is switched on, a private score's contents stay on the device.
  await append('Content.Imported', {
    contentId: id,
    title: score.title,
    format: 'musicxml',
    source: 'userImported',
    isPrivate: true,
  });

  return { stored, score };
}

export async function deleteScore(id: string): Promise<void> {
  if (opfsAvailable()) {
    try {
      const dir = await scoreDirectory();
      await dir.removeEntry(`${id}.musicxml`);
    } catch {
      // Already gone, which is the desired end state anyway.
    }
  }
  await db().blobs.delete(id);
  await db().meta.delete(metaKey(id));
}

export async function loadScore(id: string): Promise<Score | null> {
  const xml = await readScoreXml(id);
  if (!xml) return null;
  const rows = await db().meta.get(metaKey(id));
  const stored = rows?.value as StoredScore | undefined;
  return parseMusicXml(xml, { id, provenance: stored?.provenance });
}

export { MusicXmlParseError };
