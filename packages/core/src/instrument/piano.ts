/** The piano: the degenerate, bijective case of the instrument abstraction. */

import { PIANO_HIGHEST, PIANO_LOWEST, isBlackKey, type MidiNote } from '../theory/pitch.js';
import type { Fingering, HandId, Instrument, Position } from './types.js';

export const piano: Instrument = {
  id: 'piano',
  name: 'Piano',
  pitchRange: [PIANO_LOWEST, PIANO_HIGHEST],

  positionToPitch(position: Position): MidiNote {
    if (position.kind !== 'key') throw new Error('piano positions are keys');
    return position.midi;
  },

  pitchToPositions(pitch: MidiNote): Position[] {
    // Exactly one place to play any pitch. This is what makes piano the easy case.
    return [{ kind: 'key', midi: pitch }];
  },

  transitionCost(from: Fingering, to: Fingering): number {
    if (from.position.kind !== 'key' || to.position.kind !== 'key') return Infinity;
    const semitones = Math.abs(to.position.midi - from.position.midi);
    const digitSpan = Math.abs(to.digit - from.digit);

    // Moving a long way is costly; moving a long way on adjacent fingers more so.
    let cost = semitones * 0.5;
    if (digitSpan === 0 && semitones > 0) cost += 6; // same finger, different key
    if (semitones > 12) cost += 8; // a leap needs a visual check

    // Thumb on a black key is awkward and worth discouraging in fingering search.
    if (to.digit === 1 && isBlackKey(to.position.midi)) cost += 3;
    return cost;
  },

  isPlayableSimultaneously(positions: readonly Position[]): boolean {
    const midi = positions
      .filter((p): p is Extract<Position, { kind: 'key' }> => p.kind === 'key')
      .map((p) => p.midi)
      .sort((a, b) => a - b);
    if (midi.length === 0) return true;

    const lowest = midi[0];
    const highest = midi[midi.length - 1];
    if (lowest === undefined || highest === undefined) return true;

    // One hand spans roughly a tenth; two hands can cover the instrument, so
    // this only rejects spans no pair of hands could reach at once.
    return highest - lowest <= 40 && midi.length <= 10;
  },

  handOf(note: { midi: MidiNote; staff?: number }): HandId | null {
    // Staff assignment is authoritative. Without it, per-hand metrics are
    // reported as unavailable rather than guessed — an honest gap beats a
    // confident wrong number.
    if (note.staff === 1) return 'right';
    if (note.staff === 2) return 'left';
    return null;
  },

  supportedMetrics: [
    'onsetDeviation', 'chordOnsetSpread', 'ioiCoefficientOfVariation',
    'velocityMean', 'velocitySpread', 'articulationRatio', 'tempoStability',
    'hesitationCount', 'pedalTiming', 'rhythmicEntrainment', 'dynamicIndependence',
  ],

  notation: { clefs: ['treble', 'bass'], staffCount: 2, tabSupported: false },
};
