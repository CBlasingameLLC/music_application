'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { serializeMusicXml, type Score } from '@etude/core';
import { bundledScore, bundledScores } from '@etude/content';
import { ScoreView } from '@/components/ScoreView';
import {
  type StoredScore, deleteScore, importScoreFile, listScores, loadScore,
} from '@/lib/content/store';

/**
 * The score library.
 *
 * Shows what is on this device and where each item came from. Provenance is
 * displayed rather than buried, because the licence of an engraving is a real
 * constraint on what can ever be published — and because an imported file's
 * privacy is a promise worth showing rather than merely keeping.
 */
export default function LibraryPage() {
  const [scores, setScores] = useState<StoredScore[]>([]);
  const [preview, setPreview] = useState<{ id: string; xml: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setScores(await listScores());
    } catch {
      setScores([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const { score } = await importScoreFile(file);
        await refresh();
        setPreview({ id: score.id, xml: serializeMusicXml(score) });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onPreview = useCallback(async (id: string) => {
    const score: Score | null = await loadScore(id);
    if (score) setPreview({ id, xml: serializeMusicXml(score) });
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-5 pt-8">
      <h1 className="text-3xl font-bold">Library</h1>
      <p className="mt-2 text-sm text-ink-faint">
        Scores on this device. Anything you import stays here — it is never
        uploaded, never committed, and never included in a public release.
      </p>

      <section className="panel mt-6 p-5">
        <h2 className="font-semibold">Import a score</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Uncompressed MusicXML (<code>.musicxml</code> or <code>.xml</code>).
          Exporting from MuseScore works: <em>File → Export → MusicXML</em>,
          choosing the uncompressed option.
        </p>

        <label className="tap mt-4 inline-flex cursor-pointer rounded-xl bg-accent px-6 font-bold text-accent-ink">
          {busy ? 'Reading…' : 'Choose a file'}
          <input
            type="file"
            accept=".musicxml,.xml,application/xml,text/xml"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = '';
            }}
          />
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-bad/10 p-3 text-sm text-bad">{error}</p>
        )}
      </section>

      {preview && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
              Preview
            </h2>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="tap rounded-lg bg-raised px-4 text-sm text-ink-dim"
            >
              Close
            </button>
          </div>
          <ScoreView musicXml={preview.xml} showCursor={false} zoom={1.1} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Included
        </h2>
        <p className="mb-3 text-sm text-ink-faint">
          Public-domain compositions engraved here, plus studies written for
          this app. All free to share.
        </p>
        <ul className="panel divide-y divide-hairline">
          {bundledScores().map(({ spec }) => (
            <li key={spec.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{spec.title}</div>
                {spec.composer && (
                  <div className="truncate text-xs text-ink-dim">{spec.composer}</div>
                )}
                <div className="mt-1 text-xs leading-snug text-ink-faint">{spec.teaches}</div>
                <div className="mt-1 text-[0.7rem] text-ink-faint opacity-70">
                  {spec.provenance.license}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const score = bundledScore(spec.id);
                  if (score) setPreview({ id: spec.id, xml: serializeMusicXml(score) });
                }}
                className="tap shrink-0 rounded-lg bg-raised px-4 text-sm text-ink-dim"
              >
                View
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 pb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Imported
        </h2>

        {scores.length === 0 ? (
          <div className="panel p-6 text-center">
            <p className="text-ink-dim">Nothing imported yet.</p>
            <p className="mt-2 text-sm text-ink-faint">
              Sight-reading material is generated, so you can practise reading
              without importing anything. This is for pieces you want to learn.
            </p>
            <Link href="/play/sight-read" className="mt-4 inline-block text-sm text-accent underline">
              Go to Sight-Read Sprint
            </Link>
          </div>
        ) : (
          <ul className="panel divide-y divide-hairline">
            {scores.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{s.title}</div>
                  <div className="truncate text-xs text-ink-faint">
                    {s.composer ? `${s.composer} · ` : ''}
                    {s.measureCount} bars ·{' '}
                    {s.provenance.isPrivate ? 'private to this device' : s.provenance.license}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onPreview(s.id)}
                  className="tap rounded-lg bg-raised px-4 text-sm text-ink-dim"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => void deleteScore(s.id).then(refresh)}
                  aria-label={`Delete ${s.title}`}
                  className="tap rounded-lg bg-raised px-3 text-sm text-ink-faint"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
