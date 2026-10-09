import { describe, expect, it } from 'vitest';
import { clampRange, extractSection, sectionAroundBar } from './section';
import { measureCount } from './model';
import { flattenScore, onsetClusters } from './timeline';
import { gradePerformance } from '../grading/grade';
import { synthesizeTake } from '../grading/synthesize';
import { generateSightReading } from './generate/sightReading';
import { allKeys, keyId, type Key } from '../theory/scale';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};

function piece(seed: number, bars = 8) {
  return generateSightReading(
    {
      key: K('G-major'),
      bars,
      timeSignature: { beats: 4, beatType: 4 },
      range: [55, 79],
      hands: 2,
      rhythmUnits: [1, 0.5],
      maxLeap: 4,
      stepBias: 0.75,
      allowRests: true,
      tempo: 76,
    },
    seed,
  );
}

describe('extracting a section', () => {
  it('keeps exactly the bars asked for, with their own numbers', () => {
    // Numbers are preserved rather than reset: "bar 7" has to mean the same
    // thing in the loop as in the piece, or a diagnostic pointing at it names
    // a bar the player cannot find on the page.
    const section = extractSection(piece(1), { fromMeasure: 3, toMeasure: 6 });
    expect(section.measureCount).toBe(4);
    for (const part of section.score.parts) {
      expect(part.measures.map((m) => m.number)).toEqual([3, 4, 5, 6]);
    }
  });

  it('carries the key, time signature and tempo forward', () => {
    // These are written once, on the bar that introduces them, so a section
    // starting at bar 3 would otherwise render with no key at all.
    const whole = piece(2);
    const section = extractSection(whole, { fromMeasure: 3, toMeasure: 5 });
    const first = section.score.parts[0]!.measures[0]!;

    expect(first.key).not.toBeNull();
    expect(first.timeSignature).not.toBeNull();
    expect(first.tempo).not.toBeNull();
    expect(first.key).toEqual(whole.parts[0]!.measures[0]!.key);
  });

  it('grades a section exactly as those bars grade inside the piece', () => {
    // The load-bearing property. If a looped passage scored differently from
    // the same bars played in context, the loop would be teaching against a
    // different standard than the piece it is preparing.
    const whole = piece(5);
    const section = extractSection(whole, { fromMeasure: 2, toMeasure: 5 });

    const take = synthesizeTake(section.score, { tempo: 76, seed: 9 });
    const report = gradePerformance(section.score, take);

    expect(report.metrics.noteAccuracy).toBeCloseTo(1, 6);
    expect(report.findings).toEqual(['Clean take. Nothing to fix here.']);
    // And the notes it expects are precisely those bars of the original.
    const inPiece = onsetClusters(flattenScore(whole))
      .filter((c) => c.measureNumber >= 2 && c.measureNumber <= 5);
    expect(report.expected.length).toBe(inPiece.length);
    expect(report.expected.map((c) => [...c.pitches]))
      .toEqual(inPiece.map((c) => [...c.pitches]));
  });

  it('never leaves a tie pointing outside the section', () => {
    // A tie whose partner was cut away would be absorbed by `flattenScore`
    // into a note that no longer exists, silently lengthening or dropping it.
    const whole = piece(7, 12);
    for (let from = 1; from <= 9; from++) {
      const section = extractSection(whole, { fromMeasure: from, toMeasure: from + 2 });
      for (const part of section.score.parts) {
        const firstBar = part.measures[0];
        const lastBar = part.measures[part.measures.length - 1];
        expect(firstBar?.notes.some((n) => n.tie === 'stop')).toBeFalsy();
        expect(lastBar?.notes.some((n) => n.tie === 'start')).toBeFalsy();
      }
    }
  });

  it('narrows a range that runs past the end rather than rendering blanks', () => {
    const whole = piece(3);
    const bars = measureCount(whole);
    expect(clampRange(whole, { fromMeasure: 1, toMeasure: 999 }))
      .toEqual({ fromMeasure: 1, toMeasure: bars });
    expect(clampRange(whole, { fromMeasure: 0, toMeasure: 2 }))
      .toEqual({ fromMeasure: 1, toMeasure: 2 });
    // Backwards is not a range; it collapses to a single bar.
    expect(clampRange(whole, { fromMeasure: 6, toMeasure: 2 }))
      .toEqual({ fromMeasure: 6, toMeasure: 6 });
  });
});

describe('a loop around the failing bar', () => {
  const whole = piece(11, 12);

  it('includes the approach into the bar and the exit out of it', () => {
    // Practising the bad bar alone teaches it in isolation, which is not how it
    // has to be played: the run-up and the exit are usually where the fault is.
    const range = sectionAroundBar(whole, 7, 4);
    expect(range.fromMeasure).toBeLessThan(7);
    expect(range.toMeasure).toBeGreaterThan(7);
    expect(range.toMeasure - range.fromMeasure + 1).toBe(4);
  });

  it('slides inside the piece at either end instead of truncating', () => {
    const bars = measureCount(whole);
    const atStart = sectionAroundBar(whole, 1, 4);
    expect(atStart).toEqual({ fromMeasure: 1, toMeasure: 4 });

    const atEnd = sectionAroundBar(whole, bars, 4);
    expect(atEnd.toMeasure).toBe(bars);
    expect(atEnd.toMeasure - atEnd.fromMeasure + 1).toBe(4);
  });

  it('never asks for more bars than the piece has', () => {
    const short = piece(13, 2);
    const range = sectionAroundBar(short, 1, 8);
    expect(range).toEqual({ fromMeasure: 1, toMeasure: 2 });
  });

  it('always contains the bar it was asked about', () => {
    const bars = measureCount(whole);
    for (let bar = 1; bar <= bars; bar++) {
      const range = sectionAroundBar(whole, bar, 4);
      expect(range.fromMeasure).toBeLessThanOrEqual(bar);
      expect(range.toMeasure).toBeGreaterThanOrEqual(bar);
    }
  });
});
