/**
 * A small builder for writing bundled pieces as data.
 *
 * Hand-writing MusicXML for real repertoire is long and easy to get subtly
 * wrong. Encoding the notes and running them through the tested serialiser
 * means these pieces exercise the same path a generated drill does, and a
 * mistake shows up as a wrong note rather than as malformed XML.
 */

import {
  type Key, type Measure, type Provenance, type Score, type ScoreNote,
  type TimeSignature, makeMeasure, makeNote, parsePitch, toMidi,
} from '@etude/core';

export interface NoteSpec {
  /** Scientific pitch notation, or `null` for a rest. */
  readonly pitch: string | null;
  /** Length in quarter-note beats. */
  readonly beats: number;
  readonly staff?: number;
  readonly fingering?: number;
  readonly tie?: 'start' | 'stop';
}

/** Turn a flat run of notes into bars, filling each to the time signature. */
export function barsFrom(
  notes: readonly NoteSpec[],
  signature: TimeSignature,
  staff = 1,
): ScoreNote[][] {
  const perBar = signature.beats * (4 / signature.beatType);
  const bars: ScoreNote[][] = [];
  let current: ScoreNote[] = [];
  let onset = 0;

  for (const spec of notes) {
    const spelled = spec.pitch ? parsePitch(spec.pitch) : null;
    if (spec.pitch && !spelled) throw new Error(`bad pitch in bundled score: ${spec.pitch}`);

    current.push(
      makeNote({
        midi: spelled ? toMidi(spelled) : null,
        spelled,
        onsetBeats: onset,
        durationBeats: spec.beats,
        staff: spec.staff ?? staff,
        voice: (spec.staff ?? staff) === 2 ? 2 : 1,
        fingering: spec.fingering ?? null,
        tie: spec.tie ?? null,
      }),
    );

    onset += spec.beats;
    if (onset >= perBar - 1e-6) {
      bars.push(current);
      current = [];
      onset = 0;
    }
  }
  if (current.length > 0) bars.push(current);
  return bars;
}

export interface PieceSpec {
  readonly id: string;
  readonly title: string;
  readonly composer: string | null;
  readonly key: Key;
  readonly timeSignature: TimeSignature;
  readonly tempo: number;
  readonly provenance: Provenance;
  readonly rightHand: readonly NoteSpec[];
  readonly leftHand?: readonly NoteSpec[];
  /** What this piece is for, shown in the library. */
  readonly teaches: string;
}

export function buildPiece(spec: PieceSpec): Score {
  const rhBars = barsFrom(spec.rightHand, spec.timeSignature, 1);
  const lhBars = spec.leftHand ? barsFrom(spec.leftHand, spec.timeSignature, 2) : [];
  const count = Math.max(rhBars.length, lhBars.length);

  const measures: Measure[] = [];
  for (let i = 0; i < count; i++) {
    measures.push(
      makeMeasure({
        number: i + 1,
        notes: [...(rhBars[i] ?? []), ...(lhBars[i] ?? [])],
        timeSignature: i === 0 ? spec.timeSignature : null,
        key: i === 0 ? spec.key : null,
        tempo: i === 0 ? { bpm: spec.tempo, beatUnit: 1 } : null,
      }),
    );
  }

  return {
    id: spec.id,
    title: spec.title,
    composer: spec.composer,
    parts: [
      {
        id: 'P1',
        name: 'Piano',
        staffCount: spec.leftHand ? 2 : 1,
        measures,
      },
    ],
    provenance: spec.provenance,
  };
}
