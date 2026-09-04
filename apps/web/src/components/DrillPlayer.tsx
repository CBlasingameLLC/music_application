'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Drill, type Grade, type Response, type ScaffoldId,
  SCAFFOLD_LABELS, SCAFFOLD_MULTIPLIERS,
  chordVoicing, gradeDrill, keyName, keyScale, romanNumeral,
  
} from '@etude/core';
import { audio, playCadence } from '@/lib/audio';
import { Keyboard } from './Keyboard';

export interface DrillPlayerProps {
  readonly drill: Drill;
  readonly onAnswered: (
    response: Response,
    grade: Grade,
    responseMs: number,
    scaffolds: readonly ScaffoldId[],
  ) => void;
  readonly onNext: () => void;
}

/**
 * Renders whichever question a drill carries and collects the answer.
 *
 * Feedback is always specific. "Wrong" teaches nothing; "right notes, wrong
 * inversion" or "that was the flat seventh" is the part that makes an attempt
 * worth having made.
 */
export function DrillPlayer({ drill, onAnswered, onNext }: DrillPlayerProps) {
  const [grade, setGrade] = useState<Grade | null>(null);
  const [scaffolds, setScaffolds] = useState<ScaffoldId[]>([]);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    setGrade(null);
    setScaffolds([]);
    startedAt.current = performance.now();
  }, [drill.id]);

  const submit = useCallback(
    (response: Response) => {
      if (grade) return;
      const g = gradeDrill(drill, response);
      setGrade(g);
      onAnswered(response, g, performance.now() - startedAt.current, scaffolds);
    },
    [drill, grade, onAnswered, scaffolds],
  );

  const toggleScaffold = (id: ScaffoldId) => {
    setScaffolds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const q = drill.question;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
        {q.kind === 'play-chord' && (
          <ChordQuestion
            drill={drill} grade={grade} scaffolds={scaffolds} onSubmit={submit}
          />
        )}
        {q.kind === 'identify-degree' && (
          <DegreeQuestion drill={drill} grade={grade} onSubmit={submit} />
        )}
        {q.kind === 'identify-interval' && (
          <IntervalQuestion drill={drill} grade={grade} onSubmit={submit} />
        )}
        {q.kind === 'identify-progression' && (
          <ProgressionQuestion drill={drill} grade={grade} onSubmit={submit} />
        )}
        {q.kind === 'key-signature' && (
          <KeySignatureQuestion drill={drill} grade={grade} onSubmit={submit} />
        )}
        {q.kind === 'tap-rhythm' && (
          <RhythmQuestion drill={drill} grade={grade} onSubmit={submit} />
        )}
      </div>

      {!grade && q.kind === 'play-chord' && (
        <ScaffoldBar active={scaffolds} onToggle={toggleScaffold} available={['keyboard-highlight', 'letter-names']} />
      )}

      {grade && <Feedback grade={grade} onNext={onNext} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Feedback({ grade, onNext }: { grade: Grade; onNext: () => void }) {
  // Auto-advance on a clean answer keeps a drill in flow. A miss waits for a
  // tap, because the explanation is the part worth reading.
  useEffect(() => {
    if (!grade.correct) return;
    const t = setTimeout(onNext, 850);
    return () => clearTimeout(t);
  }, [grade, onNext]);

  return (
    <div
      className={[
        'sticky bottom-0 border-t px-4 py-4',
        grade.correct ? 'border-good/40 bg-good/10' : 'border-bad/40 bg-bad/10',
      ].join(' ')}
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-4">
        <span className={`text-2xl ${grade.correct ? 'text-good' : 'text-bad'}`} aria-hidden>
          {grade.correct ? '✓' : '✕'}
        </span>
        <p className="flex-1 text-[1.02rem] leading-snug">{grade.detail}</p>
        {!grade.correct && (
          <button
            type="button"
            onClick={onNext}
            className="tap rounded-xl bg-raised px-6 font-semibold text-ink"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

function ScaffoldBar({
  active, onToggle, available,
}: {
  active: readonly ScaffoldId[];
  onToggle: (id: ScaffoldId) => void;
  available: readonly ScaffoldId[];
}) {
  return (
    <div className="border-t border-hairline px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-ink-faint">Need a hand?</span>
        {available.map((id) => {
          const on = active.includes(id);
          const cost = Math.round((1 - SCAFFOLD_MULTIPLIERS[id]) * 100);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              aria-pressed={on}
              className={[
                'tap rounded-lg px-4 text-sm font-medium transition-colors',
                on ? 'bg-warn/20 text-warn ring-1 ring-warn/50' : 'bg-raised text-ink-dim',
              ].join(' ')}
            >
              {SCAFFOLD_LABELS[id]}
              {/* The price is always visible. A crutch you can see the cost of
                  is a choice; a hidden one is a habit. */}
              <span className="ml-2 text-xs opacity-70">−{cost}% XP</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Prompt({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="text-ink">{children}</div>
      {hint && <p className="mt-2 text-sm text-ink-faint">{hint}</p>}
    </div>
  );
}

function PlayButton({ onClick, label = 'Play again' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap mx-auto mt-6 flex gap-3 rounded-2xl bg-raised px-8 text-[1.05rem] font-semibold text-ink"
    >
      <span aria-hidden>▶</span> {label}
    </button>
  );
}

function ChoiceGrid({
  choices, onPick, disabled, columns = 4,
}: {
  choices: readonly string[];
  onPick: (value: string) => void;
  disabled: boolean;
  columns?: number;
}) {
  return (
    <div
      className="mx-auto mt-8 grid max-w-3xl gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {choices.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          onClick={() => onPick(c)}
          className="tap rounded-xl border border-hairline bg-surface px-3 py-4 text-[1.05rem] font-semibold text-ink disabled:opacity-50"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ChordQuestion({
  drill, grade, scaffolds, onSubmit,
}: {
  drill: Drill;
  grade: Grade | null;
  scaffolds: readonly ScaffoldId[];
  onSubmit: (r: Response) => void;
}) {
  const [down, setDown] = useState<number[]>([]);
  useEffect(() => setDown([]), [drill.id]);

  const q = drill.question;
  const target = useMemo(
    () => (q.kind === 'play-chord' ? chordVoicing(q.chord) : []),
    [q],
  );
  if (q.kind !== 'play-chord') return null;
  const expectedCount = target.length;

  const noteOn = (midi: number) => {
    setDown((prev) => (prev.includes(midi) ? prev : [...prev, midi]));
  };

  // Submitting is explicit rather than automatic on note count. Auto-firing at
  // N notes would score a half-formed chord the instant the third finger lands.
  const check = () => onSubmit({ kind: 'notes', midi: down });

  // Mark only what was actually played. Colouring untouched keys would be
  // showing the answer rather than reporting on the attempt.
  const targetPcs = new Set(target.map((t) => t % 12));
  const marks = grade
    ? (Object.fromEntries(
        down.map((m) => [m, targetPcs.has(m % 12) ? 'correct' : 'wrong']),
      ) as Record<number, 'correct' | 'wrong'>)
    : {};

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Prompt hint={q.requireInversion ? 'Inversion matters — mind the bass note.' : `${expectedCount} notes`}>
        <span className="text-[clamp(3rem,9vw,5.5rem)] font-bold leading-none tracking-tight">
          {q.symbol}
        </span>
      </Prompt>

      <div className="mx-auto mt-6 flex max-w-3xl items-center gap-3">
        <span className="text-sm text-ink-faint">Playing:</span>
        <span className="tabular text-lg font-semibold text-accent">
          {down.length} / {expectedCount}
        </span>
        <button
          type="button"
          onClick={() => setDown([])}
          disabled={!!grade || down.length === 0}
          className="tap rounded-lg bg-raised px-4 text-sm text-ink-dim disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={check}
          disabled={!!grade || down.length === 0}
          className="tap flex-1 rounded-xl bg-accent px-6 font-bold text-accent-ink disabled:opacity-40"
        >
          Check
        </button>
      </div>

      <div className="mt-auto pt-6 pb-4">
        <Keyboard
          low={48}
          octaves={2}
          onNoteOn={noteOn}
          disabled={!!grade}
          highlight={scaffolds.includes('keyboard-highlight') && !grade ? target : []}
          showNames={scaffolds.includes('letter-names')}
          marks={marks}
        />
      </div>
    </div>
  );
}

function DegreeQuestion({
  drill, grade, onSubmit,
}: { drill: Drill; grade: Grade | null; onSubmit: (r: Response) => void }) {
  const q = drill.question;

  const play = useCallback(async () => {
    if (q.kind !== 'identify-degree') return;
    await audio.resume();
    // Establish the key first. Degree recognition is meaningless without a
    // tonal centre — that is the entire difference between functional ear
    // training and interval trivia.
    const cadence = q.cadence.map((c) => chordVoicing(c));
    const ms = playCadence(cadence);
    setTimeout(() => audio.note(q.target, 1.4), ms + 220);
  }, [q]);

  useEffect(() => { void play(); }, [play]);

  if (q.kind !== 'identify-degree') return null;

  return (
    <div>
      <Prompt hint={`Key of ${keyName(q.key)}`}>
        <span className="text-[clamp(1.4rem,4vw,2rem)] font-semibold">
          Which scale degree?
        </span>
      </Prompt>
      <PlayButton onClick={() => void play()} label="Hear it again" />
      <ChoiceGrid
        choices={q.choices.map(String)}
        onPick={(v) => onSubmit({ kind: 'choice', value: v })}
        disabled={!!grade}
        columns={Math.min(7, q.choices.length)}
      />
    </div>
  );
}

function IntervalQuestion({
  drill, grade, onSubmit,
}: { drill: Drill; grade: Grade | null; onSubmit: (r: Response) => void }) {
  const q = drill.question;

  const play = useCallback(async () => {
    if (q.kind !== 'identify-interval') return;
    await audio.resume();
    if (q.harmonic) {
      audio.chord([q.from, q.to], 1.6);
    } else {
      audio.sequence([[q.from], [q.to]], 0.8, 0.62);
    }
  }, [q]);

  useEffect(() => { void play(); }, [play]);

  if (q.kind !== 'identify-interval') return null;

  return (
    <div>
      <Prompt hint={q.harmonic ? 'Both notes together' : 'One after the other'}>
        <span className="text-[clamp(1.4rem,4vw,2rem)] font-semibold">
          Which interval?
        </span>
      </Prompt>
      <PlayButton onClick={() => void play()} label="Hear it again" />
      <ChoiceGrid
        choices={q.choices}
        onPick={(v) => onSubmit({ kind: 'choice', value: v })}
        disabled={!!grade}
        columns={4}
      />
    </div>
  );
}

function ProgressionQuestion({
  drill, grade, onSubmit,
}: { drill: Drill; grade: Grade | null; onSubmit: (r: Response) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [drill.id]);

  const q = drill.question;
  const play = useCallback(async () => {
    if (q.kind !== 'identify-progression') return;
    await audio.resume();
    audio.sequence(q.chords.map((c) => chordVoicing(c)), 0.9, 0.78);
  }, [q]);

  useEffect(() => { void play(); }, [play]);

  if (q.kind !== 'identify-progression') return null;
  const full = picked.length >= q.chords.length;

  return (
    <div>
      <Prompt hint={`${q.chords.length} chords in ${keyName(q.key)}`}>
        <span className="text-[clamp(1.4rem,4vw,2rem)] font-semibold">
          Name the progression
        </span>
      </Prompt>

      <div className="mx-auto mt-6 flex max-w-3xl justify-center gap-2">
        {q.chords.map((_, i) => (
          <div
            key={i}
            className={[
              'flex h-14 flex-1 items-center justify-center rounded-xl border text-lg font-bold',
              picked[i]
                ? 'border-accent/60 bg-accent/15 text-accent'
                : 'border-hairline bg-surface text-ink-faint',
            ].join(' ')}
          >
            {picked[i] ?? i + 1}
          </div>
        ))}
      </div>

      <div className="mx-auto mt-3 flex max-w-3xl gap-2">
        <button
          type="button"
          onClick={() => setPicked((p) => p.slice(0, -1))}
          disabled={!!grade || picked.length === 0}
          className="tap rounded-lg bg-raised px-5 text-sm text-ink-dim disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => void play()}
          className="tap rounded-lg bg-raised px-5 text-sm text-ink-dim"
        >
          Replay
        </button>
        <button
          type="button"
          onClick={() => onSubmit({ kind: 'sequence', values: picked })}
          disabled={!!grade || !full}
          className="tap flex-1 rounded-xl bg-accent font-bold text-accent-ink disabled:opacity-40"
        >
          Check
        </button>
      </div>

      <ChoiceGrid
        choices={q.choices}
        onPick={(v) => setPicked((p) => (p.length < q.chords.length ? [...p, v] : p))}
        disabled={!!grade || full}
        columns={Math.min(4, q.choices.length)}
      />
    </div>
  );
}

function KeySignatureQuestion({
  drill, grade, onSubmit,
}: { drill: Drill; grade: Grade | null; onSubmit: (r: Response) => void }) {
  const q = drill.question;
  if (q.kind !== 'key-signature') return null;

  const ask = {
    'accidental-count': `How many accidentals in ${keyName(q.key)}?`,
    'name-from-signature': `Which key has this signature?`,
    relative: `What is the relative minor of ${keyName(q.key)}?`,
    'scale-spelling': `Spell the ${keyName(q.key)} scale.`,
  }[q.ask];

  return (
    <div>
      <Prompt>
        <span className="text-[clamp(1.5rem,4.5vw,2.4rem)] font-semibold leading-tight">
          {ask}
        </span>
      </Prompt>
      {q.ask === 'name-from-signature' && <SignatureGlyph drill={drill} />}
      <ChoiceGrid
        choices={q.choices}
        onPick={(v) => onSubmit({ kind: 'choice', value: v })}
        disabled={!!grade}
        columns={q.ask === 'scale-spelling' ? 1 : 2}
      />
    </div>
  );
}

/** The accidentals of a key signature, in written order. */
function SignatureGlyph({ drill }: { drill: Drill }) {
  const q = drill.question;
  if (q.kind !== 'key-signature') return null;
  const scale = keyScale(q.key);
  const accidentals = scale.filter((n) => n.alter !== 0);

  return (
    <div className="mx-auto mt-6 flex max-w-3xl items-center justify-center gap-3">
      {accidentals.length === 0 ? (
        <span className="text-2xl text-ink-faint">no sharps or flats</span>
      ) : (
        accidentals.map((n) => (
          <span key={`${n.step}${n.alter}`} className="text-3xl font-bold text-accent">
            {n.step}
            {n.alter === 1 ? '♯' : '♭'}
          </span>
        ))
      )}
    </div>
  );
}

function RhythmQuestion({
  drill, grade, onSubmit,
}: { drill: Drill; grade: Grade | null; onSubmit: (r: Response) => void }) {
  const [phase, setPhase] = useState<'idle' | 'count-in' | 'recording'>('idle');
  const taps = useRef<number[]>([]);
  const patternStart = useRef(0);

  useEffect(() => {
    setPhase('idle');
    taps.current = [];
  }, [drill.id]);

  const q = drill.question;
  const pattern = q.kind === 'tap-rhythm' ? q.pattern : null;
  const totalBeats = pattern ? pattern.bars * pattern.beatsPerBar : 0;

  const start = useCallback(async () => {
    if (!pattern) return;
    await audio.resume();
    taps.current = [];
    setPhase('count-in');

    const countInBeats = pattern.beatsPerBar;
    audio.startMetronome(pattern.bpm, pattern.beatsPerBar, (beat, audioTime) => {
      if (beat === countInBeats) {
        // Anchor the pattern to the audio clock, converted to the performance
        // clock that pointer events are stamped with. Mixing the two clocks is
        // the classic way to put a silent constant bias into every metric.
        patternStart.current = audio.audioTimeToPerformanceTime(audioTime);
        setPhase('recording');
      }
      if (beat >= countInBeats + totalBeats) {
        audio.stopMetronome();
        setPhase('idle');
        onSubmit({ kind: 'taps', offsetsMs: taps.current });
      }
    });
  }, [pattern, totalBeats, onSubmit]);

  useEffect(() => () => audio.stopMetronome(), []);

  if (!pattern) return null;

  const tap = () => {
    if (phase !== 'recording') return;
    // The player taps in time with the click they *hear*, which is late by the
    // output latency. Subtracting it is what keeps the deviation figure honest.
    taps.current.push(performance.now() - patternStart.current - audio.outputLatencyMs);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Prompt hint={`${pattern.bpm} BPM · ${pattern.bars} bars`}>
        <span className="text-[clamp(1.4rem,4vw,2rem)] font-semibold">Tap the rhythm</span>
      </Prompt>

      <div className="mx-auto mt-6 w-full max-w-3xl">
        <div className="flex h-20 items-stretch gap-1 rounded-xl border border-hairline bg-surface p-2">
          {pattern.events.map((e, i) => (
            <div
              key={i}
              style={{ flexGrow: e.duration }}
              className={[
                'rounded-md',
                e.isRest ? 'border border-dashed border-hairline-strong' : 'bg-accent/70',
              ].join(' ')}
              title={e.isRest ? 'rest' : `${e.duration} beat`}
            />
          ))}
        </div>
        <p className="mt-2 text-center text-sm text-ink-faint">
          Filled blocks are notes. Dashed blocks are rests — do not tap those.
        </p>
      </div>

      {phase === 'idle' && !grade && (
        <PlayButton onClick={() => void start()} label="Start with count-in" />
      )}

      <button
        type="button"
        onPointerDown={tap}
        disabled={phase !== 'recording'}
        className={[
          'mx-4 mt-6 mb-6 flex-1 rounded-2xl border-2 text-2xl font-bold transition-colors',
          phase === 'recording'
            ? 'border-accent bg-accent/15 text-accent'
            : 'border-hairline bg-surface text-ink-faint',
        ].join(' ')}
      >
        {phase === 'recording' ? 'TAP' : phase === 'count-in' ? 'Count in…' : 'Tap area'}
      </button>
    </div>
  );
}
