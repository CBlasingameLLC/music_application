'use client';

/**
 * Handing the piece catalogue to core.
 *
 * `packages/core` cannot import content — content depends on core, not the
 * other way round — so the pieces are registered here, at the one place that
 * can see both the bundled library and whatever this device has imported.
 *
 * Imported files are registered **ungraded**. Nothing can read a MusicXML
 * document and say how hard it is to play, so the ladder never suggests one;
 * it is chosen deliberately, from the library, by the person who imported it.
 * The alternative — guessing a tier from note count or range — would be the
 * ladder claiming to know something it does not, and the whole progression
 * system is only worth anything while its numbers mean what they say.
 */

import { useEffect, useState } from 'react';
import {
  type RepertoireEntry, initialTempo, registerRepertoire, repertoire,
} from '@etude/core';
import { bundledRepertoire } from '@etude/content';
import { listScores, loadScore } from './store';

/** Imported files carry no difficulty. Zero is the catalogue's word for that. */
const UNGRADED = 0;

/**
 * Rebuild the catalogue from the bundled library plus this device's imports.
 *
 * Cheap enough to run on mount: the bundled pieces are built from data already
 * in the bundle, and imports are a handful of files of a few KB each.
 */
export async function syncRepertoire(): Promise<readonly RepertoireEntry[]> {
  const entries: RepertoireEntry[] = [...bundledRepertoire()];

  try {
    for (const stored of await listScores()) {
      const score = await loadScore(stored.id);
      if (!score) continue;
      entries.push({
        id: stored.id,
        title: stored.title,
        composer: stored.composer,
        level: UNGRADED,
        teaches: stored.provenance.isPrivate
          ? 'Imported, and private to this device.'
          : 'Imported.',
        // Whatever the file says, falling back to something playable. This is
        // the goal tempo the ladder works toward, not the one you start at.
        tempo: initialTempo(score),
        score,
      });
    }
  } catch {
    // A device with no storage still gets the bundled library rather than an
    // empty screen. Losing the imported half is worth saying nothing about
    // here; the library page reports storage failures where they belong.
  }

  registerRepertoire(entries);
  return repertoire();
}

/**
 * The catalogue, kept in sync with what is on the device.
 *
 * Returns null until the first sync finishes, so a caller can tell "still
 * loading" from "genuinely nothing", which are different things to show.
 */
export function useRepertoire(): readonly RepertoireEntry[] | null {
  const [entries, setEntries] = useState<readonly RepertoireEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void syncRepertoire().then((all) => {
      if (!cancelled) setEntries(all);
    });
    return () => { cancelled = true; };
  }, []);

  return entries;
}
