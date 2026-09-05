'use client';

/**
 * Repertoire.
 *
 * The mode everything else has been preparing for. Reading, rhythm and both
 * hands have to happen at once here, which is the whole difficulty — and it is
 * the only place where the thing being measured is also the thing you wanted to
 * do in the first place.
 *
 * Two ideas do the work on this page:
 *
 *  - **Tempo is the unit of progress, not accuracy.** "Clean at 96" says
 *    something; "94% accurate" does not, because accuracy is trivially bought
 *    by slowing down. So the take is played against a target the motor ladder
 *    sets, and holding it moves the target up rather than adding to a score.
 *  - **A failing bar becomes a loop.** The grader clusters errors by bar and
 *    the mode persists the worst one, so after a few takes the page can say
 *    "bar 7, in three of four takes" and offer those bars on their own. Playing
 *    the whole piece again to fix four of its bars is the most common way to
 *    waste practice time.
 *
 * Like the Independence Lab this has its own page rather than living in
 * `DrillRunner`: the runner's contract is question in, response out, and a
 * performance is neither.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LADDERS, MOTOR_INTERVALS, TEMPO_CRITERION, TEMPO_STEP, TEMPO_TOLERANCE,
  bestCleanTempo, clampRange, flattenScore, generateDrill, gradeDrill,
  gradePerformance, keyboardSpan, measureCount, modeMeta, onsetClusters, pieceAttempts,
  repertoireActivityId, sectionAroundBar, troubleBars,
  type Drill, type Grade, type PerformanceReport, type RepertoireEntry,
  type SectionRange, type TroubleBar,
} from '@etude/core';
import { ScoreView } from '@/components/ScoreView';
import { Keyboard } from '@/components/Keyboard';
import { useTakeRecorder } from '@/lib/input/useTakeRecorder';
import { useRepertoire } from '@/lib/content/repertoire';
import { useLogHistory } from '@/db/history';
import { useRecordAttempt, useEtudeState, ladderStateFor } from '@/db/store';
import { audio } from '@/lib/audio';

/** Bars in a practice loop. Enough to carry the approach and the exit. */
const LOOP_BARS = 4;

export default function RepertoirePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-5 pt-8">Loading…</div>}>
      <Repertoire />
    </Suspense>
  );
}

function Repertoire() {
  const params = useSearchParams();
  const catalogue = useRepertoire();
  const { app } = useEtudeState();
  const { events } = useLogHistory();
  const record = useRecordAttempt();

  const ladder = LADDERS.repertoire;
  const ladderState = ladderStateFor(app, 'repertoire');

  const [pieceId, setPieceId] = useState<string | null>(null);
  const [range, setRange] = useState<SectionRange | null>(null);
  const [tempoNudge, setTempoNudge] = useState(0);
  const [click, setClick] = useState(true);
  const [countIn, setCountIn] = useState<number | null>(null);
  // The report and the grade together. The report is the measurement; the
  // grade is the verdict, and only the grade knows whether the target tempo was
  // actually held — a note-perfect take at the wrong tempo is not a held rung.
  const [result, setResult] = useState<{ report: PerformanceReport; grade: Grade } | null>(null);
  const [saving, setSaving] = useState(false);

  // Deep link from the library: /play/repertoire?piece=minuet-in-g
  const requested = params.get('piece');
  useEffect(() => {
    if (requested) setPieceId(requested);
  }, [requested]);

  const entry = useMemo(
    () => catalogue?.find((e) => e.id === pieceId) ?? null,
    [catalogue, pieceId],
  );

  const bars = entry ? measureCount(entry.score) : 0;
  const section = useMemo<SectionRange | null>(() => {
    if (!entry) return null;
    return clampRange(entry.score, range ?? { fromMeasure: 1, toMeasure: bars });
  }, [entry, range, bars]);

  // Everything this passage has been graded at before, which is where both the
  // tempo target and the failing bar come from.
  const history = useMemo(() => {
    if (!entry || !section) return null;
    const wholePiece = pieceAttempts(events, `repertoire-${entry.id}-`);
    const thisPassage = pieceAttempts(
      events,
      repertoireActivityId(entry.id, section),
    );
    return {
      passage: thisPassage,
      trouble: troubleBars(wholePiece.filter((a) => a.fromMeasure === 1)),
      best: bestCleanTempo(thisPassage, TEMPO_CRITERION),
    };
  }, [events, entry, section]);

  // The tempo ladder. A held take moves the target up a step; a missed one
  // moves it down. Never above what the piece is written at — the job is to
  // reach the marked tempo cleanly, not to race it.
  const target = useMemo(() => {
    if (!entry) return 0;
    const earned = history?.best ?? 0;
    const base = earned > 0 ? earned + TEMPO_STEP : Math.min(entry.tempo, 60);
    return Math.max(40, Math.min(entry.tempo, base + tempoNudge * TEMPO_STEP));
  }, [entry, history, tempoNudge]);

  const drill: Drill | null = useMemo(() => {
    if (!entry || !section) return null;
    return generateDrill({
      modeId: 'repertoire',
      rungIndex: ladderState.rungIndex,
      seed: 1,
      repertoire: { pieceId: entry.id, section, tempoTarget: target },
    });
  }, [entry, section, target, ladderState.rungIndex]);

  const question = drill?.question.kind === 'play-piece' ? drill.question : null;
  const recorder = useTakeRecorder(question?.tempoTarget ?? null);

  const beats = useMemo(() => {
    const first = question?.score.parts[0]?.measures[0]?.timeSignature;
    return first?.beats ?? 4;
  }, [question]);

  const stopClick = useCallback(() => {
    audio.stopMetronome();
    setCountIn(null);
  }, []);

  useEffect(() => stopClick, [stopClick]);

  const startTake = useCallback(async () => {
    if (!question) return;
    setResult(null);

    if (!click) {
      recorder.start();
      return;
    }

    // A count-in rather than starting cold. Without one the first bar is played
    // against a click the player has not yet found, and it lands in the metrics
    // as a rushed opening that says nothing about the piece.
    await audio.resume();
    setCountIn(beats);
    let beat = 0;
    audio.startMetronome(question.tempoTarget, beats, () => {
      beat += 1;
      if (beat <= beats) {
        setCountIn(beats - beat);
        if (beat === beats) {
          setCountIn(null);
          recorder.start();
        }
      }
    });
  }, [question, click, beats, recorder]);

  const finishTake = useCallback(async () => {
    stopClick();
    const take = recorder.stop();
    if (!take || !drill || !question) return;

    const grade = gradeDrill(drill, { kind: 'take', take });
    setResult({ report: gradePerformance(question.score, take), grade });
    setSaving(true);
    try {
      await record(drill, { kind: 'take', take }, grade, {
        responseMs: 0,
        sessionId: null,
        scaffolds: [],
        ladder: ladderState,
        take,
        tempoTarget: question.tempoTarget,
        // The player follows the click they *hear*, which is already late by
        // the output latency, so every onset lands late by exactly that much.
        audioOffsetMs: audio.outputLatencyMs,
      });
    } finally {
      setSaving(false);
    }
  }, [recorder, drill, question, record, ladderState, stopClick]);

  const loopWorstBar = useCallback((bar: number) => {
    if (!entry) return;
    setRange(sectionAroundBar(entry.score, bar, LOOP_BARS));
    setResult(null);
  }, [entry]);

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-24">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">Repertoire</h1>
        <Link href="/library" className="text-sm text-ink-faint underline">Library</Link>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-faint">{modeMeta('repertoire').why}</p>

      <PiecePicker
        catalogue={catalogue}
        maxLevel={ladderState.rungIndex + 1}
        rungName={ladder.rungs[ladderState.rungIndex]?.name ?? ''}
        selectedId={pieceId}
        onSelect={(id) => { setPieceId(id); setRange(null); setResult(null); setTempoNudge(0); }}
      />

      {entry && question && section && (
        <>
          <section className="panel mt-6 p-5" data-testid="take-setup">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">{entry.title}</h2>
                {entry.composer && (
                  <p className="text-sm text-ink-dim">{entry.composer}</p>
                )}
              </div>
              <span className="tabular text-sm text-ink-faint" data-testid="section-label">
                {question.whole
                  ? `all ${bars} bars`
                  : `bars ${section.fromMeasure}–${section.toMeasure}`}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setRange(null); setResult(null); }}
                className={`tap rounded-xl px-4 text-sm ${
                  question.whole ? 'bg-accent text-ground' : 'bg-raised text-ink-dim'
                }`}
                data-testid="section-whole"
              >
                Whole piece
              </button>
              {Array.from({ length: Math.ceil(bars / LOOP_BARS) }, (_, i) => {
                const from = i * LOOP_BARS + 1;
                const to = Math.min(bars, from + LOOP_BARS - 1);
                const active = !question.whole
                  && section.fromMeasure === from && section.toMeasure === to;
                return (
                  <button
                    key={from}
                    onClick={() => { setRange({ fromMeasure: from, toMeasure: to }); setResult(null); }}
                    className={`tap rounded-xl px-4 text-sm ${
                      active ? 'bg-accent text-ground' : 'bg-raised text-ink-dim'
                    }`}
                    data-testid={`section-${from}-${to}`}
                  >
                    {from}–{to}
                  </button>
                );
              })}
            </div>

            <TempoRow
              target={question.tempoTarget}
              goal={question.tempoGoal}
              best={history?.best ?? 0}
              onNudge={(delta) => setTempoNudge((n) => n + delta)}
            />

            {history && history.trouble.length > 0 && (
              <TroubleRow bars={history.trouble} onLoop={loopWorstBar} />
            )}

            <label className="mt-4 flex items-center gap-2 text-sm text-ink-dim">
              <input
                type="checkbox"
                checked={click}
                onChange={(e) => setClick(e.target.checked)}
                data-testid="toggle-click"
              />
              Count me in and keep the click going
            </label>
            {click && (
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                The click is corrected for output latency before anything is
                graded — you play in time with what you hear, which is already
                late, and not subtracting it would report every onset as rushed.
              </p>
            )}
          </section>

          <section
            className="panel mt-6 overflow-x-auto p-4"
            data-testid="repertoire-score"
            // The notes in playing order, so an end-to-end test can perform the
            // piece rather than only check that a staff appeared.
            data-expected={onsetClusters(flattenScore(question.score))
              .map((c) => c.pitches.join('+'))
              .join(',')}
          >
            <ScoreView musicXml={question.musicXml} showCursor={false} zoom={1.4} />
          </section>

          <section className="mt-6 flex flex-wrap items-center gap-3">
            {countIn !== null ? (
              <span
                className="tabular rounded-xl bg-raised px-6 py-3 text-lg font-bold text-accent"
                data-testid="count-in"
              >
                {countIn === 0 ? 'Play' : countIn}
              </span>
            ) : !recorder.recording ? (
              <button
                onClick={() => void startTake()}
                className="tap rounded-xl bg-accent px-6 font-semibold text-ground"
                data-testid="start-take"
              >
                Start playing
              </button>
            ) : (
              <button
                onClick={() => void finishTake()}
                className="tap rounded-xl bg-raised px-6 font-semibold text-ink"
                data-testid="finish-take"
              >
                Done — {recorder.noteCount} notes
              </button>
            )}
            {saving && <span className="text-sm text-ink-faint">Saving…</span>}
          </section>

          {result && (
            <TakeReport
              report={result.report}
              grade={result.grade}
              target={question.tempoTarget}
              goal={question.tempoGoal}
              onLoop={loopWorstBar}
            />
          )}

          <section className="mt-6">
            {/*
              Sized to the passage rather than fixed. A note the score asks for
              that is not on screen cannot be played at all — Ode to Joy's
              left-hand G2 falls below the C3 default, which made the piece
              literally unplayable here until this was measured.
            */}
            <Keyboard {...keyboardSpan(question.score, { low: 48, octaves: 3 })} />
          </section>
        </>
      )}
    </div>
  );
}

function PiecePicker({
  catalogue, maxLevel, rungName, selectedId, onSelect,
}: {
  catalogue: readonly RepertoireEntry[] | null;
  maxLevel: number;
  rungName: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (catalogue === null) {
    return (
      <section className="panel mt-6 p-5">
        <p className="text-sm text-ink-faint">Reading the library…</p>
      </section>
    );
  }

  const suggested = catalogue.filter((e) => e.level >= 1 && e.level <= maxLevel);
  const rest = catalogue.filter((e) => !suggested.includes(e));

  return (
    <section className="panel mt-6 p-5" data-testid="piece-picker">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          At your level
        </span>
        <span className="text-xs text-accent">{rungName}</span>
      </div>

      {suggested.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">
          Nothing graded at this level yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {suggested.map((entry) => (
            <PieceRow
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      {rest.length > 0 && (
        <>
          <div className="mt-6 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Everything else
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            Above your current rung, or imported — nothing can read a file and
            say how hard it is to play, so imported pieces are never suggested,
            only offered.
          </p>
          <ul className="mt-3 divide-y divide-hairline">
            {rest.map((entry) => (
              <PieceRow
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PieceRow({
  entry, selected, onSelect,
}: {
  entry: RepertoireEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(entry.id)}
        className={`flex w-full items-baseline gap-3 py-3 text-left ${
          selected ? 'text-accent' : 'text-ink'
        }`}
        data-testid={`piece-${entry.id}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{entry.title}</span>
          <span className="block truncate text-xs text-ink-dim">
            {entry.composer ? `${entry.composer} · ` : ''}{entry.teaches}
          </span>
        </span>
        <span className="tabular shrink-0 text-xs text-ink-faint">
          {entry.level >= 1 ? `level ${entry.level}` : 'ungraded'}
        </span>
      </button>
    </li>
  );
}

/**
 * The tempo ladder, shown rather than hidden.
 *
 * Three numbers, because they answer three different questions: what you are
 * playing at now, the best you have held cleanly, and what the piece is
 * actually marked at. A single "tempo" field would collapse a progression into
 * a setting.
 */
function TempoRow({
  target, goal, best, onNudge,
}: {
  target: number;
  goal: number;
  best: number;
  onNudge: (delta: number) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="tempo-row">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Playing at
        </div>
        <div className="tabular mt-1 text-2xl font-bold text-ink" data-testid="tempo-target">
          {target} <span className="text-sm font-normal text-ink-faint">BPM</span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onNudge(-1)}
          className="tap rounded-xl bg-raised px-4 text-ink-dim"
          aria-label={`Slower, ${TEMPO_STEP} BPM`}
          data-testid="tempo-down"
        >
          −
        </button>
        <button
          onClick={() => onNudge(1)}
          className="tap rounded-xl bg-raised px-4 text-ink-dim"
          aria-label={`Faster, ${TEMPO_STEP} BPM`}
          data-testid="tempo-up"
        >
          +
        </button>
      </div>
      <div className="text-sm text-ink-dim">
        {best > 0 ? (
          <>Best held clean: <span className="tabular text-ink">{Math.round(best)}</span></>
        ) : (
          <span className="text-ink-faint">Not held clean yet</span>
        )}
        {' · '}
        marked <span className="tabular text-ink">{goal}</span>
      </div>
    </div>
  );
}

/**
 * The bar that keeps failing, and a way to go and practise it.
 *
 * The most actionable output the grader produces. "You fail at bar 7 in three
 * of four takes" names something to do; an accuracy percentage does not.
 */
function TroubleRow({
  bars, onLoop,
}: {
  bars: readonly TroubleBar[];
  onLoop: (bar: number) => void;
}) {
  const worst = bars[0];
  if (!worst) return null;

  return (
    <div className="mt-5 rounded-xl bg-raised p-4" data-testid="trouble-bars">
      <p className="text-sm text-ink">
        Bar {worst.measureNumber} goes wrong in {worst.takes} of your last{' '}
        {worst.outOf} takes.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        A loop includes the bars either side, because the run-up and the exit are
        usually where the trouble actually is.
      </p>
      <button
        onClick={() => onLoop(worst.measureNumber)}
        className="tap mt-3 rounded-xl bg-accent px-5 text-sm font-semibold text-ground"
        data-testid="loop-worst-bar"
      >
        Loop bar {worst.measureNumber}
      </button>
    </div>
  );
}

function TakeReport({
  report, grade, target, goal, onLoop,
}: {
  report: PerformanceReport;
  grade: Grade;
  target: number;
  goal: number;
  onLoop: (bar: number) => void;
}) {
  // The rung is held only when the notes *and* the tempo were. `tempoBpm` is
  // zero when nothing was demonstrated, which is also what the motor scheduler
  // reads, so the sentence on screen and the number in the log cannot disagree.
  const atTempo = (grade.diagnostics.tempoBpm ?? 0) > 0;
  const held = atTempo && grade.correctness >= TEMPO_CRITERION;
  const playedBpm = Math.round(grade.diagnostics.tempoPlayedBpm ?? 0);
  const worst = report.metrics.errorLocations[0];

  return (
    <section className="panel mt-6 p-5" data-testid="take-report">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          This take
        </span>
        <span className="tabular text-2xl font-bold" data-testid="take-score">
          {Math.round(grade.correctness * 100)}%
        </span>
      </div>
      {!atTempo && (
        // Otherwise the headline and the sentence under it disagree: the
        // performance score knows nothing about tempo, because the tempo map
        // absorbs a uniform change by design, so a take at three times the
        // target reads as a flawless one until the target is brought into it.
        <p className="mt-1 text-xs text-ink-faint">
          The notes alone scored {Math.round(report.score * 100)}%.
        </p>
      )}

      <p className="mt-3 text-sm text-ink" data-testid="tempo-verdict">
        {held ? (
          target >= goal
            ? `Clean at ${target} — that is the marked tempo. This one is learned.`
            : `Clean at ${target}. Next take at ${target + TEMPO_STEP}.`
        ) : !atTempo ? (
          `That was around ${playedBpm} against a target of ${target}. `
          + `The notes are one thing; at this tempo is another — and a tempo `
          + `you did not play at is not one this can credit you with.`
        ) : (
          `Not clean at ${target} yet. Try ${Math.max(40, target - TEMPO_STEP)} — `
          + 'accuracy first, then speed. Slowing down is how the tempo goes up.'
        )}
      </p>

      <ul className="mt-4 space-y-2">
        {report.findings.map((finding, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink">{finding}</li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-ink-faint">
        Counted at tempo within {Math.round(TEMPO_TOLERANCE * 100)}% of the
        target — wider than an unaccompanied take drifts, narrower than one rung
        of the ladder to the next.
      </p>

      {worst && worst.errors > 0 && (
        <button
          onClick={() => onLoop(worst.measureNumber)}
          className="tap mt-4 rounded-xl bg-raised px-5 text-sm text-ink"
          data-testid="loop-this-bar"
        >
          Loop bar {worst.measureNumber}
        </button>
      )}

      <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-faint">
        A clean take also sets the review date: {MOTOR_INTERVALS.join(', ')} days
        out, rather than a forgetting curve. Motor memory decays far more slowly
        than a fact does, and consolidates with sleep rather than with review.
      </p>
    </section>
  );
}
