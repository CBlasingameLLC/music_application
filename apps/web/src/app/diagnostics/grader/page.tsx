'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  FAULT_PRESETS, gradePerformance, synthesizeTake, type PerformanceReport,
} from '@etude/core';
import { bundledScores } from '@etude/content';

/**
 * The grader inspector.
 *
 * The grader has to be trustworthy before there is a keyboard to play into it,
 * and a passing test is a weak guarantee about a *metric*: one that measures
 * the wrong thing passes exactly as convincingly as one that measures the right
 * thing. So this injects a known fault into a known piece and shows what the
 * grader made of it. If the numbers do not say what the fault was, that is
 * visible here rather than months later on real playing.
 */
export default function GraderInspectorPage() {
  const pieces = useMemo(() => bundledScores(), []);
  const [pieceId, setPieceId] = useState(pieces[0]?.spec.id ?? '');
  const [presetId, setPresetId] = useState('clean');
  const [tempo, setTempo] = useState(80);

  const report: PerformanceReport | null = useMemo(() => {
    const piece = pieces.find((p) => p.spec.id === pieceId);
    const preset = FAULT_PRESETS.find((p) => p.id === presetId);
    if (!piece || !preset) return null;
    const take = synthesizeTake(piece.score, { tempo, seed: 7, faults: preset.faults });
    return gradePerformance(piece.score, take);
  }, [pieces, pieceId, presetId, tempo]);

  const preset = FAULT_PRESETS.find((p) => p.id === presetId);

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold">Grader inspector</h1>
        <Link href="/diagnostics" className="text-sm text-ink-faint underline">
          Diagnostics
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-faint">
        Injects a known fault into a known piece and shows what the grader made
        of it. If the numbers do not describe the fault, something is wrong with
        the metric rather than with the playing.
      </p>

      <section className="panel mt-6 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Piece
            </span>
            <select
              value={pieceId}
              onChange={(e) => setPieceId(e.target.value)}
              className="tap mt-2 w-full rounded-xl bg-raised px-4 text-ink"
            >
              {pieces.map(({ spec }) => (
                <option key={spec.id} value={spec.id}>{spec.title}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Tempo
            </span>
            <input
              type="range" min={50} max={140} value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              className="mt-4 w-full"
            />
            <span className="tabular text-sm text-ink-dim">{tempo} BPM</span>
          </label>
        </div>

        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Injected fault
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {FAULT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                aria-pressed={presetId === p.id}
                className={[
                  'tap rounded-xl px-4 text-sm font-medium transition-colors',
                  presetId === p.id ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-dim',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset && <p className="mt-3 text-sm text-ink-faint">{preset.description}</p>}
        </div>
      </section>

      {report && (
        <>
          <section className="mt-6" data-testid="grader-findings">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
              What it says
            </h2>
            <ul className="panel divide-y divide-hairline">
              {report.findings.map((finding, i) => (
                <li key={i} className="px-4 py-3 text-[1.02rem] leading-snug">
                  {finding}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Score" value={`${Math.round(report.score * 100)}%`} />
            <Stat label="Note accuracy" value={`${Math.round(report.metrics.noteAccuracy * 100)}%`} />
            <Stat label="Timing" value={`${Math.round(report.metrics.timing.meanAbsDeviationMs)} ms`} />
            <Stat label="Tempo" value={`${Math.round(report.metrics.tempo.medianBpm)} BPM`} />
          </section>

          <section className="panel mt-6 divide-y divide-hairline" data-testid="grader-metrics">
            <Row label="Alignment" value={
              `${report.alignment.matched} matched · ${report.alignment.substituted} wrong · ` +
              `${report.alignment.deleted} missed · ${report.alignment.inserted} extra`
            } />
            <Row
              label="Tempo steadiness"
              value={
                `drift ${report.metrics.tempo.driftFraction >= 0 ? '+' : ''}` +
                `${(report.metrics.tempo.driftFraction * 100).toFixed(0)}% across the passage · ` +
                `${(report.metrics.tempo.instabilityCv * 100).toFixed(1)}% wobble about the trend · ` +
                `${(report.metrics.tempo.coefficientOfVariation * 100).toFixed(1)}% raw variation`
              }
              note={
                report.metrics.tempo.instabilityCv < 0.02 &&
                Math.abs(report.metrics.tempo.driftFraction) > 0.06
                  ? 'A smooth accelerando is steady and directional at once — which is why the raw variation is the wrong thing to fault.'
                  : undefined
              }
            />
            <Row
              label="Chord spread"
              value={
                report.metrics.chordSpread.events.length === 0
                  ? 'no chords in this piece'
                  : `${report.metrics.chordSpread.faultedCount} faulted · ` +
                    `melody lead ${report.metrics.chordSpread.meanSignedLeadMs.toFixed(0)} ms`
              }
              note={
                report.metrics.chordSpread.meanSignedLeadMs > 12
                  ? 'Positive lead is good voicing, not an error — a naive metric would punish it.'
                  : undefined
              }
            />
            <Row label="Evenness" value={
              `${(report.metrics.evenness.detrendedIoiCv * 100).toFixed(1)}% detrended IOI variation`
            } note="Detrended, so a genuine accelerando does not read as unevenness." />
            <Row
              label="Per-hand timing"
              value={
                report.metrics.timing.perHand
                  ? `right ${report.metrics.timing.perHand.right.meanAbsDeviationMs.toFixed(0)} ms · ` +
                    `left ${report.metrics.timing.perHand.left.meanAbsDeviationMs.toFixed(0)} ms`
                  : 'unavailable — this piece has one staff'
              }
              note="From staff assignment, never a pitch threshold: the left hand crosses above middle C constantly."
            />
            <Row
              label="Independence"
              value={
                report.metrics.independence
                  ? `entrainment ${(report.metrics.independence.entrainment * 100).toFixed(0)}%` +
                    (report.metrics.independence.dynamicSeparationDb !== null
                      ? ` · balance ${report.metrics.independence.dynamicSeparationDb.toFixed(1)} dB`
                      : '')
                  : 'unavailable — needs two staves'
              }
              note="Entrainment is the left hand being pulled onto the right hand's beats."
            />
            <Row
              label="Dynamics"
              value={
                report.metrics.dynamics
                  ? `range ${(report.metrics.dynamics.rangeUtilization * 127).toFixed(0)} of 127`
                  : 'not measured — no velocity from this source'
              }
            />
            <Row
              label="Hesitations"
              value={
                report.metrics.hesitations.length === 0
                  ? 'none'
                  : report.metrics.hesitations
                      .map((h) => `bar ${h.measureNumber} (+${Math.round(h.excessMs)} ms)`)
                      .join(', ')
              }
            />
            <Row
              label="Errors by bar"
              value={
                report.metrics.errorLocations.length === 0
                  ? 'none'
                  : report.metrics.errorLocations
                      .slice(0, 5)
                      .map((e) => `bar ${e.measureNumber}: ${e.errors}`)
                      .join(' · ')
              }
              note="The most actionable output there is — it names something you can go and practise."
            />
          </section>
          <div className="h-10" />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="tabular mt-1 text-2xl font-bold text-accent">{value}</div>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="w-40 shrink-0 text-sm font-semibold text-ink">{label}</span>
        <span className="tabular min-w-0 flex-1 text-sm text-ink-dim">{value}</span>
      </div>
      {note && <p className="mt-1 pl-0 text-xs leading-snug text-ink-faint sm:pl-[10.75rem]">{note}</p>}
    </div>
  );
}
