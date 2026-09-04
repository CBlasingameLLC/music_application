/**
 * Synthetic performances with known faults.
 *
 * The grader has to be verifiable before there is a keyboard to play into it,
 * and "the tests pass" is a weak claim about a metric — a metric that measures
 * the wrong thing passes its tests exactly as convincingly as one that measures
 * the right thing. So faults are *injected deliberately*, and each test asserts
 * the grader reports that specific fault and nothing else.
 *
 * The same generator drives the inspector page, so what the tests assert and
 * what you can look at are the same fixtures.
 */

import type { MidiNote } from '../theory/pitch';
import type { Score } from '../score/model';
import { flattenScore, onsetClusters, msPerBeat } from '../score/timeline';
import type { PerformedNote, PerformedTake } from './take';
import { makeRng } from '../generators/rng';

export interface SynthesisFaults {
  /** Drop this many notated clusters entirely. */
  readonly dropped?: number;
  /** Play this many clusters at the wrong pitch. */
  readonly wrongNotes?: number;
  /** Add this many clusters that are not in the score. */
  readonly extraNotes?: number;
  /** Fractional tempo change across the take. 0.12 means ending 12% faster. */
  readonly tempoDrift?: number;
  /** Roll this many chords, spreading their onsets. */
  readonly rolledChords?: number;
  /** Milliseconds a rolled chord spans. */
  readonly rollMs?: number;
  /** Insert this many pauses, as if losing your place. */
  readonly hesitations?: number;
  readonly hesitationMs?: number;
  /**
   * Random timing noise, standard deviation in ms.
   *
   * This is noise *around* a pulse, not an unsteady pulse. It is independent
   * per onset, so the tempo map's median filter removes it by design — which
   * is correct, and is why it shows up in the timing residuals rather than in
   * the tempo. Use `tempoWobble` for a pulse that actually wanders.
   */
  readonly jitterMs?: number;
  /**
   * Sinusoidal tempo wander, as a fraction of a beat. The pulse breathing.
   *
   * The distinction from `jitterMs` is the whole point: this displacement is
   * *correlated across neighbouring onsets*, so the tempo map's median filter
   * preserves it and it registers as genuine pulse instability. Independent
   * noise does not, and should not.
   */
  readonly tempoWobble?: number;
  /** Beats per wobble cycle. Short periods read as unsteadiness, not rubato. */
  readonly wobblePeriodBeats?: number;
  /** Constant lateness applied to every onset. */
  readonly latencyMs?: number;
  /**
   * Pull left-hand onsets toward the nearest right-hand onset, 0-1.
   * The signature of one hand capturing the other.
   */
  readonly entrainment?: number;
  /** Lead the top note of each chord by this many ms, as experts do. */
  readonly melodyLeadMs?: number;
  /** Velocity for the top voice and for everything else, 0-1. */
  readonly melodyVelocity?: number;
  readonly accompanimentVelocity?: number;
}

export interface SynthesisOptions {
  readonly tempo?: number;
  readonly seed?: number;
  readonly faults?: SynthesisFaults;
}

/** Gaussian noise via Box-Muller, so jitter is realistic rather than uniform. */
function gaussian(rng: { next(): number }, sigma: number): number {
  if (sigma <= 0) return 0;
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Render a score as a performance, optionally with faults.
 *
 * With no faults this is a mechanically perfect take, which is the baseline
 * every metric is checked against: a perfect performance must report zero
 * error, or nothing measured afterwards means anything.
 */
export function synthesizeTake(score: Score, options: SynthesisOptions = {}): PerformedTake {
  const tempo = options.tempo ?? 80;
  const faults = options.faults ?? {};
  const rng = makeRng(options.seed ?? 1);

  const timeline = flattenScore(score);
  const clusters = onsetClusters(timeline);
  const beatMs = msPerBeat(tempo);

  const dropIndices = pickIndices(rng, clusters.length, faults.dropped ?? 0);
  const wrongIndices = pickIndices(rng, clusters.length, faults.wrongNotes ?? 0, dropIndices);
  // Only chords can be rolled. Picking any cluster would silently no-op on the
  // single-note ones that make up most of a melody.
  const chordIndices = clusters
    .map((c, i) => (c.pitches.length > 1 ? i : -1))
    .filter((i) => i > 0 && !dropIndices.has(i) && !wrongIndices.has(i));
  const rollIndices = new Set(
    rng.shuffle(chordIndices).slice(0, faults.rolledChords ?? 0),
  );
  const hesitationIndices = pickIndices(rng, clusters.length, faults.hesitations ?? 0);

  const totalBeats = clusters[clusters.length - 1]?.absoluteBeats ?? 1;
  const notes: PerformedNote[] = [];
  let accumulatedHesitation = 0;

  // Right-hand onsets, needed to model entrainment.
  const rhOnsetsByBeat = new Map<number, number>();

  for (let index = 0; index < clusters.length; index++) {
    const cluster = clusters[index];
    if (!cluster) continue;
    if (dropIndices.has(index)) continue;

    if (hesitationIndices.has(index)) {
      accumulatedHesitation += faults.hesitationMs ?? 700;
    }

    // Tempo drift compounds across the take, so the map has a real slope to find.
    const progress = totalBeats > 0 ? cluster.absoluteBeats / totalBeats : 0;
    const driftFactor = 1 - (faults.tempoDrift ?? 0) * progress;
    // Displacing position sinusoidally *is* a local tempo modulation: the
    // derivative of a sine displacement is a cosine tempo change, so the pulse
    // speeds and slows without ever stopping.
    const wobbleMs =
      (faults.tempoWobble ?? 0) > 0
        ? Math.sin(
            (2 * Math.PI * cluster.absoluteBeats) / (faults.wobblePeriodBeats ?? 4),
          ) * (faults.tempoWobble ?? 0) * beatMs
        : 0;

    const baseMs =
      cluster.absoluteBeats * beatMs * driftFactor +
      wobbleMs +
      accumulatedHesitation +
      (faults.latencyMs ?? 0);

    const rolled = rollIndices.has(index);
    const rollSpan = rolled ? (faults.rollMs ?? 90) : 0;
    const sortedNotes = [...cluster.notes].sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
    const topMidi = sortedNotes[sortedNotes.length - 1]?.midi ?? null;

    sortedNotes.forEach((note, noteIndex) => {
      if (note.midi === null) return;

      let midi: MidiNote = note.midi;
      if (wrongIndices.has(index)) midi = note.midi + (rng.bool() ? 1 : -1);

      const isTop = note.midi === topMidi;
      const rollOffset = rolled ? (noteIndex / Math.max(1, sortedNotes.length - 1)) * rollSpan : 0;
      // Melody lead is expert behaviour, not error: the top voice arrives early.
      const lead = isTop ? -(faults.melodyLeadMs ?? 0) : 0;

      let onset = baseMs + rollOffset + lead + gaussian(rng, faults.jitterMs ?? 0);

      if ((faults.entrainment ?? 0) > 0 && note.staff === 2) {
        const nearest = nearestValue([...rhOnsetsByBeat.values()], onset);
        if (nearest !== null) onset += (nearest - onset) * (faults.entrainment ?? 0);
      }

      const durationMs = Math.max(60, note.soundingBeats * beatMs * 0.9);
      const velocity = isTop
        ? (faults.melodyVelocity ?? 0.75)
        : (faults.accompanimentVelocity ?? 0.55);

      notes.push({ midi, onsetMs: onset, offsetMs: onset + durationMs, velocity });

      if (note.staff === 1) rhOnsetsByBeat.set(cluster.absoluteBeats, onset);
    });
  }

  // Extra notes: plausible neighbours, not random noise, so they exercise the
  // aligner's insertion path the way a real slip would.
  for (let k = 0; k < (faults.extraNotes ?? 0); k++) {
    const anchor = notes[rng.int(0, Math.max(0, notes.length - 1))];
    if (!anchor) break;
    const onset = anchor.onsetMs + beatMs * 0.5;
    notes.push({
      midi: anchor.midi + (rng.bool() ? 2 : -2),
      onsetMs: onset,
      offsetMs: onset + beatMs * 0.4,
      velocity: 0.6,
    });
  }

  notes.sort((a, b) => a.onsetMs - b.onsetMs || a.midi - b.midi);

  return {
    notes,
    pedal: [],
    tempoTarget: tempo,
    hasVelocity: true,
  };
}

function pickIndices(
  rng: ReturnType<typeof makeRng>,
  length: number,
  count: number,
  exclude: ReadonlySet<number> = new Set(),
): Set<number> {
  const chosen = new Set<number>();
  if (count <= 0 || length === 0) return chosen;
  // Never the first cluster: dropping the opening note changes where the take
  // starts rather than testing recovery inside it.
  let guard = 0;
  while (chosen.size < Math.min(count, length - 1) && guard++ < length * 20) {
    const index = rng.int(1, length - 1);
    if (!exclude.has(index)) chosen.add(index);
  }
  return chosen;
}

function nearestValue(values: readonly number[], target: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const value of values) {
    const d = Math.abs(value - target);
    if (d < bestDistance) { bestDistance = d; best = value; }
  }
  return bestDistance < 400 ? best : null;
}

/** Named fault presets, shared by the tests and the inspector. */
export const FAULT_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  faults: SynthesisFaults;
}> = [
  { id: 'clean', label: 'Perfect', description: 'Mechanically exact. Every metric should read zero error.', faults: {} },
  { id: 'human', label: 'Human but clean', description: 'Slight jitter and expert melody lead. Should not be faulted.', faults: { jitterMs: 12, melodyLeadMs: 28, melodyVelocity: 0.8, accompanimentVelocity: 0.5 } },
  { id: 'dropped', label: 'A missed note', description: 'One notated cluster never played. Must cost one note, not the rest of the take.', faults: { dropped: 1 } },
  { id: 'wrong', label: 'A wrong note', description: 'One cluster played a semitone off. Should read as a substitution, not a gap.', faults: { wrongNotes: 1 } },
  { id: 'extra', label: 'An extra note', description: 'A note that is not in the score. Should read as an insertion.', faults: { extraNotes: 1 } },
  { id: 'drift', label: 'Speeding up', description: '12% faster by the end. Residuals should stay near zero; the tempo map should slope.', faults: { tempoDrift: 0.12, jitterMs: 8 } },
  { id: 'rolled', label: 'Rolled chords', description: 'Chords spread over 90 ms. Should report spread, not four timing errors.', faults: { rolledChords: 2, rollMs: 90 } },
  { id: 'hesitation', label: 'Losing your place', description: 'Two long pauses mid-phrase. Should be located, not smeared across the take.', faults: { hesitations: 2, hesitationMs: 800, jitterMs: 10 } },
  { id: 'late', label: 'Playing behind', description: 'Every onset 90 ms late — the signature of uncalibrated latency.', faults: { latencyMs: 90 } },
  { id: 'wobble', label: 'Wandering pulse', description: 'The beat speeds and slows without ever stopping. Should read as unsteadiness, not as drift.', faults: { tempoWobble: 0.4, wobblePeriodBeats: 8, jitterMs: 8 } },
  { id: 'entrained', label: 'Hands sticking together', description: 'Left hand pulled toward the right. The fingerprint of poor independence.', faults: { entrainment: 0.7, jitterMs: 10 } },
  { id: 'messy', label: 'A realistic bad take', description: 'Everything at once, the way a real attempt goes wrong.', faults: { dropped: 1, wrongNotes: 1, extraNotes: 1, tempoDrift: 0.08, hesitations: 1, jitterMs: 25 } },
];
