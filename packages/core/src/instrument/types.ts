/**
 * The instrument abstraction — the seam that lets guitar arrive later without
 * a rewrite.
 *
 * The temptation is to model piano keys as the primitive, since piano is the
 * first instrument. That would be a one-way door: a piano key maps to exactly
 * one pitch, but a guitar pitch maps to *several* (string, fret) positions, and
 * retrofitting that asymmetry later means touching everything.
 *
 * So positions are set-valued from day one. Piano is simply the degenerate case
 * where `pitchToPositions` always returns exactly one element.
 */

import type { MidiNote } from '../theory/pitch';

export type InstrumentId = 'piano' | 'guitar';

/** Where a pitch is physically produced. */
export type Position =
  | { readonly kind: 'key'; readonly midi: MidiNote }
  | { readonly kind: 'fret'; readonly string: number; readonly fret: number };

export interface Fingering {
  readonly position: Position;
  /** 1-5 on piano (thumb to little finger); 0-4 on guitar (0 = open). */
  readonly digit: number;
  readonly hand?: HandId;
}

/**
 * Piano has a left and a right hand. Guitar has a fretting hand and a picking
 * hand, which are not the same concept at all — which is exactly why `handOf`
 * and `supportedMetrics` belong on the instrument rather than being global.
 */
export type HandId = 'left' | 'right' | 'fretting' | 'picking';

export interface Instrument {
  readonly id: InstrumentId;
  readonly name: string;
  readonly pitchRange: readonly [MidiNote, MidiNote];

  /** Total: every position produces exactly one pitch. */
  positionToPitch(position: Position): MidiNote;
  /** Set-valued: piano returns one, guitar returns several. */
  pitchToPositions(pitch: MidiNote): Position[];

  /** Cost of moving between two fingerings. Drives fingering search. */
  transitionCost(from: Fingering, to: Fingering): number;
  /** Whether a set of positions can physically sound together. */
  isPlayableSimultaneously(positions: readonly Position[]): boolean;

  /**
   * Which hand plays a note. On piano this comes from the score's staff
   * assignment, never from a pitch threshold — the left hand crosses above
   * middle C and the right hand plays below it constantly, so a pitch split
   * would silently corrupt every per-hand metric.
   */
  handOf(note: { midi: MidiNote; staff?: number }): HandId | null;

  /** Metrics that are meaningful on this instrument. */
  readonly supportedMetrics: readonly string[];
  readonly notation: {
    readonly clefs: readonly ('treble' | 'bass')[];
    readonly staffCount: number;
    readonly tabSupported: boolean;
  };
}
