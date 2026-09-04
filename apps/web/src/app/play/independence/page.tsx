'use client';

/**
 * The Independence Lab.
 *
 * A performance mode rather than a question mode. The other drills ask
 * something and check the answer; here you play an exercise start to finish and
 * the take is measured — because what is being trained is not whether the notes
 * are right but whether the hands stayed apart while playing them.
 *
 * That is why this has its own page rather than living in `DrillRunner`: the
 * runner's contract is question in, response out, and a take is neither.
 */

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import {
  LADDERS, flattenScore, generateDrill, gradeDrill, judgeIndependence, modeMeta,
  onsetClusters,
  type AspectVerdict, type Drill, type IndependenceReport,
} from '@etude/core';
import { ScoreView } from '@/components/ScoreView';
import { Keyboard } from '@/components/Keyboard';
import { useTakeRecorder } from '@/lib/input/useTakeRecorder';
import { useRecordAttempt, useEtudeState, ladderStateFor } from '@/db/store';
import { input } from '@/lib/input/manager';

function randomSeed(): number {
  return Math.floor(Math.random() * 1e9);
}

const ASPECT_LABEL: Record<string, string> = {
  together: 'Playing it together',
  rhythm: 'Keeping the rhythms apart',
  articulation: 'Two articulations at once',
  dynamics: 'Two dynamics at once',
};

export default function IndependenceLabPage() {
  const { app } = useEtudeState();
  const record = useRecordAttempt();
  const ladder = LADDERS.independence;

  const ladderState = ladderStateFor(app, 'independence');
  const [rungIndex, setRungIndex] = useState<number | null>(null);
  const effectiveRung = rungIndex ?? ladderState.rungIndex;

  const [seed, setSeed] = useState<number | null>(null);
  const [report, setReport] = useState<IndependenceReport | null>(null);
  const [saving, setSaving] = useState(false);

  const drill: Drill | null = useMemo(() => {
    if (seed === null) return null;
    return generateDrill({ modeId: 'independence', rungIndex: effectiveRung, seed });
  }, [seed, effectiveRung]);

  const question = drill?.question.kind === 'play-independence' ? drill.question : null;
  const recorder = useTakeRecorder(question?.tempo ?? null);

  const begin = useCallback(() => {
    setReport(null);
    setSeed(randomSeed());
  }, []);

  const startTake = useCallback(() => {
    setReport(null);
    recorder.start();
  }, [recorder]);

  const finishTake = useCallback(async () => {
    const take = recorder.stop();
    if (!take || !drill || !question) return;

    const judged = judgeIndependence(question.score, take, {
      aspect: question.aspect,
      splitPoint: question.splitPoint,
      articulation: question.articulation,
      dynamics: question.dynamics,
    });
    setReport(judged);

    setSaving(true);
    try {
      await record(drill, { kind: 'take', take }, gradeDrill(drill, { kind: 'take', take }), {
        responseMs: 0,
        sessionId: null,
        scaffolds: [],
        ladder: ladderState,
      });
    } finally {
      setSaving(false);
    }
  }, [recorder, drill, question, record, ladderState]);

  const rung = ladder.rungs[effectiveRung];

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-24">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">Independence Lab</h1>
        <Link href="/practice" className="text-sm text-ink-faint underline">
          Practice
        </Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-faint">{modeMeta('independence').why}</p>

      <section className="panel mt-6 p-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Rung
        </span>
        <div className="mt-3 flex flex-wrap gap-2">
          {ladder.rungs.map((r, i) => (
            <button
              key={r.id}
              onClick={() => { setRungIndex(i); setSeed(null); setReport(null); }}
              className={`tap rounded-xl px-4 text-sm ${
                i === effectiveRung ? 'bg-accent text-ground' : 'bg-raised text-ink-dim'
              }`}
              data-testid={`rung-${r.id}`}
            >
              {r.name}
            </button>
          ))}
        </div>

        {rung && (
          <p className="mt-4 text-sm text-ink-dim">
            {ASPECT_LABEL[String(rung.params.aspect ?? 'rhythm')]}
            {' · '}
            {String(rung.params.ratio ?? '1:1')}
            {' · '}
            {String(rung.params.tempo ?? 72)} BPM
          </p>
        )}

        {!input.velocityAvailable && rung?.params.aspect === 'dynamics' && (
          // Said plainly rather than scored anyway. A touchscreen reports the
          // same nominal velocity for every note, so a dynamics number from one
          // would be a number about nothing.
          <p className="mt-3 rounded-xl bg-raised px-4 py-3 text-sm text-ink-dim">
            This rung is measured from how hard you strike the keys, which needs
            a MIDI keyboard. You can still play it — the notes will be graded,
            the dynamics will not.
          </p>
        )}

        <button
          onClick={begin}
          className="tap mt-5 rounded-xl bg-raised px-5 text-ink"
          data-testid="new-exercise"
        >
          {seed === null ? 'Generate an exercise' : 'New exercise'}
        </button>
      </section>

      {question && (
        <>
          <section
            className="panel mt-6 overflow-x-auto p-4"
            data-testid="independence-score"
            // The notes in playing order, so an end-to-end test can perform the
            // exercise rather than only check that a staff appeared. A test
            // that cannot play the thing cannot tell a working grader from one
            // that returns the same verdict whatever it is given.
            data-expected={onsetClusters(flattenScore(question.score))
              .map((c) => c.pitches.join('+'))
              .join(',')}
          >
            <ScoreView musicXml={question.musicXml} showCursor={false} zoom={1.4} />
          </section>

          <section className="mt-6 flex flex-wrap items-center gap-3">
            {!recorder.recording ? (
              <button
                onClick={startTake}
                className="tap rounded-xl bg-accent px-6 font-semibold text-ground"
                data-testid="start-take"
              >
                Start playing
              </button>
            ) : (
              <button
                onClick={finishTake}
                className="tap rounded-xl bg-raised px-6 font-semibold text-ink"
                data-testid="finish-take"
              >
                Done — {recorder.noteCount} notes
              </button>
            )}
            {saving && <span className="text-sm text-ink-faint">Saving…</span>}
          </section>

          {report && <Verdicts report={report} />}

          <section className="mt-6">
            <Keyboard low={48} octaves={3} />
          </section>
        </>
      )}
    </div>
  );
}

function Verdicts({ report }: { report: IndependenceReport }) {
  return (
    <section className="panel mt-6 p-5" data-testid="independence-verdicts">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          What it says
        </span>
        <span className="tabular text-2xl font-bold">
          {Math.round(report.correctness * 100)}%
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {report.findings.map((finding, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink">{finding}</li>
        ))}
      </ul>

      <div className="mt-5 divide-y divide-hairline border-t border-hairline">
        {report.verdicts.map((verdict) => (
          <VerdictRow key={verdict.aspect} verdict={verdict} />
        ))}
      </div>
    </section>
  );
}

function VerdictRow({ verdict }: { verdict: AspectVerdict }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-sm text-ink-dim">{ASPECT_LABEL[verdict.aspect] ?? verdict.aspect}</span>
      <span className="tabular text-sm">
        {!verdict.measurable
          ? <span className="text-ink-faint">not measured</span>
          : verdict.held
            ? <span className="text-accent">held</span>
            : <span className="text-warn">{Math.round((verdict.score ?? 0) * 100)}%</span>}
      </span>
    </div>
  );
}
