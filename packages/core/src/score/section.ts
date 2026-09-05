/**
 * Taking a passage out of a piece so it can be looped.
 *
 * Practising a whole piece to fix bar 7 is the single most common waste of
 * practice time, and the grader already knows which bar keeps failing —
 * `errorLocations` clusters errors by measure, and `worstBar` is persisted on
 * every graded attempt. A section is what turns that finding into work: play
 * those four bars, at a tempo you can hold, until they stop being the worst
 * ones.
 *
 * The extraction is deliberately a real `Score` rather than a range passed
 * alongside one. Everything downstream — the serialiser, OSMD, the timeline,
 * the grader — then needs no notion of sections at all, and a section grades
 * through exactly the code path a whole piece does. The alternative, threading
 * a bar range through five layers, is where the bugs would live.
 */

import type { Key } from '../theory/scale';
import {
  measureCount,
  type Measure, type Part, type Score, type Tempo, type TimeSignature,
} from './model';

// Re-exported so a caller working with sections has one place to import from.
// `measureCount` is defined on the model because a bar count is a fact about a
// score, not about slicing one.
export { measureCount };

export interface SectionRange {
  /** 1-based, inclusive, matching the measure numbers printed on the staff. */
  readonly fromMeasure: number;
  readonly toMeasure: number;
}

export interface Section extends SectionRange {
  readonly score: Score;
  readonly measureCount: number;
}

/** The measure numbers a score actually contains, in order. */
export function measureNumbers(score: Score): number[] {
  const seen = new Set<number>();
  for (const part of score.parts) {
    for (const measure of part.measures) seen.add(measure.number);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Clamp a requested range to what the piece contains.
 *
 * A section that ran past the end would render blank bars and grade the player
 * against silence, so an out-of-range request is narrowed rather than refused —
 * the caller usually got it from a diagnostic, not from the user.
 */
export function clampRange(score: Score, range: SectionRange): SectionRange {
  const numbers = measureNumbers(score);
  const first = numbers[0] ?? 1;
  const last = numbers[numbers.length - 1] ?? first;

  const from = Math.min(Math.max(range.fromMeasure, first), last);
  const to = Math.min(Math.max(range.toMeasure, from), last);
  return { fromMeasure: from, toMeasure: to };
}

/**
 * A bar range as a standalone score.
 *
 * Two things have to be carried forward or the section is unplayable:
 *
 *  - **Key, time signature and tempo.** These are written once, on the measure
 *    that introduces them, so a section starting at bar 12 would otherwise have
 *    no key at all. The last value in force at the section's start is copied
 *    onto its first measure.
 *  - **Ties reaching across the boundary.** A note tied to one outside the
 *    range has nothing to tie to. The tie is dropped so the note sounds as
 *    written rather than being absorbed by `flattenScore` into a note that is
 *    no longer there.
 *
 * Measure numbers are preserved, not renumbered. "Bar 7" has to mean the same
 * thing in the section as in the piece, or a diagnostic pointing at it would
 * name a bar the player cannot find in their score.
 */
export function extractSection(score: Score, range: SectionRange): Section {
  const { fromMeasure, toMeasure } = clampRange(score, range);

  const parts: Part[] = score.parts.map((part) => {
    // What is in force at the section's start, gathered from everything before
    // it. A section beginning mid-piece inherits rather than guesses.
    let key: Key | null = null;
    let timeSignature: TimeSignature | null = null;
    let tempo: Tempo | null = null;
    for (const measure of part.measures) {
      if (measure.number >= fromMeasure) break;
      if (measure.key) key = measure.key;
      if (measure.timeSignature) timeSignature = measure.timeSignature;
      if (measure.tempo) tempo = measure.tempo;
    }

    const kept = part.measures.filter(
      (m) => m.number >= fromMeasure && m.number <= toMeasure,
    );

    const measures: Measure[] = kept.map((measure, index) => {
      const notes = measure.notes.map((note) => {
        if (note.tie === null) return note;
        // A tie whose other end is outside the section has nothing to join to.
        const danglingStart = note.tie === 'start' && measure.number === toMeasure;
        const danglingStop = note.tie === 'stop' && measure.number === fromMeasure;
        if (danglingStart || danglingStop) return { ...note, tie: null };
        if (note.tie === 'continue'
          && (measure.number === fromMeasure || measure.number === toMeasure)) {
          return { ...note, tie: null };
        }
        return note;
      });

      if (index > 0) return { ...measure, notes };
      return {
        ...measure,
        notes,
        key: measure.key ?? key,
        timeSignature: measure.timeSignature ?? timeSignature,
        tempo: measure.tempo ?? tempo,
      };
    });

    return { ...part, measures };
  });

  const bars = toMeasure - fromMeasure + 1;
  return {
    fromMeasure,
    toMeasure,
    measureCount: bars,
    score: {
      ...score,
      id: `${score.id}#${fromMeasure}-${toMeasure}`,
      title: bars === measureCount(score)
        ? score.title
        : `${score.title}, bars ${fromMeasure}–${toMeasure}`,
      parts,
    },
  };
}

/**
 * A window of bars centred on the one that keeps going wrong.
 *
 * Practising the failing bar alone teaches it in isolation, which is not how it
 * has to be played — the approach into it and the exit out of it are usually
 * where the problem actually is. So the loop includes its neighbours, and is
 * pulled inside the piece rather than truncated when the bar is near an end.
 */
export function sectionAroundBar(
  score: Score,
  bar: number,
  span = 4,
): SectionRange {
  const numbers = measureNumbers(score);
  const first = numbers[0] ?? 1;
  const last = numbers[numbers.length - 1] ?? first;
  const width = Math.min(Math.max(1, span), last - first + 1);

  const before = Math.floor((width - 1) / 2);
  let from = bar - before;
  if (from < first) from = first;
  if (from + width - 1 > last) from = last - width + 1;

  return { fromMeasure: from, toMeasure: from + width - 1 };
}
