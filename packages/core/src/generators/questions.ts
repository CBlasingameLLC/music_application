/**
 * Question types and answer checking.
 *
 * Every game mode produces a `Question` and consumes a `Response`. Modes stay
 * shallow because the grading contract is shared: a question knows how to check
 * itself and how much evidence a result provides for which skills.
 */

import type { Chord } from '../theory/chord';
import type { Interval } from '../theory/interval';
import type { Key } from '../theory/scale';
import type { MidiNote } from '../theory/pitch';
import type { Articulation, Score } from '../score/model';
import type { PerformedTake } from '../grading/take';
import type { IndependenceAspect } from '../grading/independence';
import type { SkillEvidence } from '../events/types';

export type ModeId =
  | 'chord-sprint'
  | 'degrees'
  | 'interval-ladder'
  | 'progression-detective'
  | 'key-signature-blitz'
  | 'rhythm-gauntlet'
  | 'sight-read'
  | 'independence';

export interface RhythmEvent {
  /** Onset in beats from the start of the pattern. */
  readonly beat: number;
  /** Duration in beats. */
  readonly duration: number;
  readonly isRest: boolean;
}

export interface RhythmPattern {
  readonly events: readonly RhythmEvent[];
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly bpm: number;
}

export type Question =
  | {
      readonly kind: 'play-chord';
      readonly chord: Chord;
      readonly symbol: string;
      readonly requireInversion: boolean;
      /** Previous chord, when the rung imposes a voice-leading constraint. */
      readonly previous?: { chord: Chord; voicing: MidiNote[] };
      readonly maxVoiceLeadingDistance?: number;
    }
  | {
      readonly kind: 'identify-degree';
      readonly key: Key;
      /** Chords that establish the key before the target sounds. */
      readonly cadence: readonly Chord[];
      readonly target: MidiNote;
      readonly degree: number;
      readonly choices: readonly number[];
    }
  | {
      readonly kind: 'identify-interval';
      readonly from: MidiNote;
      readonly to: MidiNote;
      readonly interval: Interval;
      readonly harmonic: boolean;
      readonly choices: readonly string[];
    }
  | {
      readonly kind: 'identify-progression';
      readonly key: Key;
      readonly chords: readonly Chord[];
      readonly numerals: readonly string[];
      readonly choices: readonly string[];
    }
  | {
      readonly kind: 'key-signature';
      readonly key: Key;
      readonly ask: 'accidental-count' | 'name-from-signature' | 'relative' | 'scale-spelling';
      readonly answer: string;
      readonly choices: readonly string[];
    }
  | {
      readonly kind: 'tap-rhythm';
      readonly pattern: RhythmPattern;
    }
  | {
      readonly kind: 'read-notation';
      readonly score: Score;
      /** Serialised for the renderer; the model above is what grading reads. */
      readonly musicXml: string;
      /** Expected pitches in playing order, ties already resolved. */
      readonly expected: readonly MidiNote[];
      readonly key: Key;
      readonly tempo: number;
      readonly hands: 1 | 2;
    }
  | {
      /**
       * Two hands, deliberately disagreeing.
       *
       * Carries its own `splitPoint`: the generator guarantees the hands
       * occupy disjoint registers, which is what lets a live note be
       * attributed to a hand exactly rather than guessed at. That is safe
       * *because* the material is generated — the same trick on real
       * repertoire would be the middle-C threshold the grader refuses, since
       * there the left hand crosses over constantly.
       */
      readonly kind: 'play-independence';
      readonly score: Score;
      readonly musicXml: string;
      readonly splitPoint: MidiNote;
      readonly ratio: string;
      readonly aspect: IndependenceAspect;
      readonly articulation: { right: Articulation; left: Articulation } | null;
      readonly dynamics: { right: string; left: string } | null;
      readonly tempo: number;
    };

export type Response =
  | { readonly kind: 'notes'; readonly midi: readonly MidiNote[] }
  | { readonly kind: 'choice'; readonly value: string }
  | { readonly kind: 'sequence'; readonly values: readonly string[] }
  | { readonly kind: 'taps'; readonly offsetsMs: readonly number[] }
  | { readonly kind: 'take'; readonly take: PerformedTake }
  | { readonly kind: 'skipped' };

export interface Grade {
  /** 0-1. */
  readonly correctness: number;
  readonly correct: boolean;
  /** Short, specific feedback. Never just "wrong". */
  readonly detail: string;
  readonly diagnostics: Readonly<Record<string, number>>;
}

export interface Drill {
  readonly id: string;
  readonly modeId: ModeId;
  readonly rungId: string;
  readonly rungIndex: number;
  readonly skillIds: readonly string[];
  readonly seed: number;
  readonly question: Question;
  /** Base XP before accuracy, tempo, and scaffold modifiers. */
  readonly baseXp: number;
}

/** Turn a grade into per-skill evidence for the mastery projection. */
export function evidenceFor(drill: Drill, grade: Grade): SkillEvidence[] {
  // A drill with several skills splits its evidence rather than crediting each
  // one fully; otherwise a single broad drill would inflate everything at once.
  const weight = drill.skillIds.length > 1 ? 0.7 : 1;
  return drill.skillIds.map((skillId) => ({
    skillId,
    correctness: grade.correctness,
    weight,
  }));
}
