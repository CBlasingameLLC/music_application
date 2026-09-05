import { beforeEach, describe, expect, it } from 'vitest';
import {
  LADDERS, TEMPO_TOLERANCE, generateDrill, gradeDrill, type GenerateOptions,
} from './modes';
import {
  registerRepertoire, repertoire, repertoireAt, repertoireEntry,
  ungradedRepertoire, type RepertoireEntry,
} from '../score/repertoire';
import { generateSightReading } from '../score/generate/sightReading';
import { synthesizeTake, type SynthesisFaults } from '../grading/synthesize';
import { measureCount } from '../score/model';
import { flattenScore, onsetClusters } from '../score/timeline';
import { allKeys, keyId, type Key } from '../theory/scale';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};

function fixture(level: number, bars = 8): RepertoireEntry {
  return {
    id: `fixture-${level}`,
    title: `Fixture ${level}`,
    composer: level > 3 ? 'A. Composer' : null,
    level,
    teaches: `Level ${level}.`,
    tempo: 60 + level * 8,
    score: generateSightReading(
      {
        key: K('C-major'),
        bars,
        timeSignature: { beats: 4, beatType: 4 },
        range: [55, 79],
        hands: 2,
        rhythmUnits: [1, 0.5],
        maxLeap: 4,
        stepBias: 0.75,
        allowRests: true,
        tempo: 60 + level * 8,
      },
      200 + level,
    ),
  };
}

const CATALOGUE = [1, 2, 3, 4, 5].map((level) => fixture(level));

beforeEach(() => registerRepertoire(CATALOGUE));

describe('the catalogue', () => {
  it('is empty until something registers, rather than throwing', () => {
    // A fresh install and a server render both look like this.
    registerRepertoire([]);
    expect(repertoire()).toEqual([]);
    expect(repertoireAt(5)).toEqual([]);
    expect(repertoireEntry('anything')).toBeNull();
  });

  it('orders by difficulty, easiest first', () => {
    registerRepertoire([fixture(4), fixture(1), fixture(3)]);
    expect(repertoire().map((e) => e.level)).toEqual([1, 3, 4]);
  });

  it('offers everything at or below a tier, not only that tier', () => {
    // A ladder that offered only the current tier would retire a piece the
    // moment it was learned, and playing something you already have is how a
    // piece stays played.
    expect(repertoireAt(3).map((e) => e.level)).toEqual([1, 2, 3]);
    expect(repertoireAt(1).map((e) => e.level)).toEqual([1]);
  });

  it('never suggests a piece nothing has graded, but keeps it choosable', () => {
    // An imported file's difficulty is unknowable — nothing can read a MusicXML
    // document and say how hard it is to play. A guessed tier would be the
    // ladder claiming to know something it does not.
    const imported = { ...fixture(1), id: 'imported', level: 0 };
    registerRepertoire([...CATALOGUE, imported]);

    expect(repertoireAt(5).map((e) => e.id)).not.toContain('imported');
    expect(repertoire().map((e) => e.id)).toContain('imported');
    expect(ungradedRepertoire().map((e) => e.id)).toEqual(['imported']);
    // And it is still playable when asked for by name.
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 0, seed: 1, repertoire: { pieceId: 'imported' },
    });
    expect(drill.question.kind).toBe('play-piece');
  });

  it('says so plainly when a drill is asked for with nothing registered', () => {
    registerRepertoire([]);
    expect(() => generateDrill({ modeId: 'repertoire', rungIndex: 0, seed: 1 }))
      .toThrow(/registerRepertoire/);
  });
});

describe('generating a repertoire drill', () => {
  function question(over?: GenerateOptions['repertoire'], rungIndex = 4, seed = 3) {
    const drill = generateDrill({ modeId: 'repertoire', rungIndex, seed, repertoire: over });
    if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');
    return { drill, q: drill.question };
  }

  it('plays the piece it was asked for', () => {
    const { q } = question({ pieceId: 'fixture-2' });
    expect(q.pieceId).toBe('fixture-2');
    expect(q.title).toBe('Fixture 2');
  });

  it('never offers a piece above the rung’s tier', () => {
    for (let rungIndex = 0; rungIndex < LADDERS.repertoire.rungs.length; rungIndex++) {
      for (let seed = 0; seed < 40; seed++) {
        const drill = generateDrill({ modeId: 'repertoire', rungIndex, seed });
        if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');
        const entry = repertoireEntry(drill.question.pieceId)!;
        expect(entry.level, `rung ${rungIndex} seed ${seed}`)
          .toBeLessThanOrEqual(rungIndex + 1);
      }
    }
  });

  it('plays the whole piece unless a section is asked for', () => {
    const { q } = question({ pieceId: 'fixture-1' });
    expect(q.whole).toBe(true);
    expect(q.section).toEqual({ fromMeasure: 1, toMeasure: 8 });
    expect(measureCount(q.score)).toBe(8);
  });

  it('plays only the section it was asked for', () => {
    const { q } = question({
      pieceId: 'fixture-1',
      section: { fromMeasure: 3, toMeasure: 5 },
    });
    expect(q.whole).toBe(false);
    expect(measureCount(q.score)).toBe(3);
    // And the expected notes are exactly those bars of the whole piece.
    const whole = repertoireEntry('fixture-1')!.score;
    const inPiece = onsetClusters(flattenScore(whole))
      .filter((c) => c.measureNumber >= 3 && c.measureNumber <= 5);
    expect(onsetClusters(flattenScore(q.score)).length).toBe(inPiece.length);
  });

  it('never asks for a tempo above what the piece is written at', () => {
    // The ladder's job is to reach the marked tempo cleanly, not to turn a
    // minuet into a race.
    const entry = repertoireEntry('fixture-3')!;
    const { q } = question({ pieceId: 'fixture-3', tempoTarget: 999 });
    expect(q.tempoTarget).toBe(entry.tempo);
    expect(q.tempoGoal).toBe(entry.tempo);
  });

  it('starts conservatively when no tempo is supplied', () => {
    const { q } = question({ pieceId: 'fixture-5' });
    expect(q.tempoTarget).toBeLessThan(q.tempoGoal);
  });

  it('identifies a drill by the passage, not by the seed', () => {
    // Playing the same passage again is the point of the mode. A seed-based id
    // would make every take a different activity, and the per-bar clustering
    // and first-versus-later comparison would have nothing to group.
    const a = question({ pieceId: 'fixture-2' }, 4, 1);
    const b = question({ pieceId: 'fixture-2' }, 4, 999);
    expect(a.drill.id).toBe(b.drill.id);

    // A loop is a different thing to practise than the whole piece.
    const loop = question({
      pieceId: 'fixture-2', section: { fromMeasure: 5, toMeasure: 8 },
    });
    expect(loop.drill.id).not.toBe(a.drill.id);
  });

  it('renders to MusicXML that carries the section', () => {
    const { q } = question({
      pieceId: 'fixture-2',
      section: { fromMeasure: 2, toMeasure: 4 },
    });
    expect(q.musicXml).toContain('<measure number="2"');
    expect(q.musicXml).toContain('<measure number="4"');
    expect(q.musicXml).not.toContain('<measure number="5"');
  });
});

describe('grading a repertoire take', () => {
  function play(faults: SynthesisFaults, pieceId = 'fixture-3') {
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 4, seed: 1, repertoire: { pieceId },
    });
    if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');
    const take = synthesizeTake(drill.question.score, {
      tempo: drill.question.tempoTarget, seed: 7, faults,
    });
    return gradeDrill(drill, { kind: 'take', take });
  }

  it('scores a mechanically exact take as correct', () => {
    const grade = play({});
    expect(grade.correctness).toBeGreaterThan(0.95);
    expect(grade.correct).toBe(true);
  });

  it('persists the tempo held, which is what the motor ladder climbs', () => {
    // Without this the tempo ladder has nothing to read and "clean at 96 BPM"
    // cannot be measured at all.
    const grade = play({});
    expect(grade.diagnostics.tempoBpm).toBeGreaterThan(0);
    expect(grade.diagnostics.tempoTarget).toBeGreaterThan(0);
  });

  it('persists the bar that went worst, so the next take can loop it', () => {
    const grade = play({ dropped: 3, wrongNotes: 2 });
    expect(grade.diagnostics.worstBar).toBeGreaterThan(0);
    expect(grade.diagnostics.worstBarErrors).toBeGreaterThan(0);
  });

  it('records which bars were played, so a section score is not read as a whole one', () => {
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 4, seed: 1,
      repertoire: { pieceId: 'fixture-3', section: { fromMeasure: 2, toMeasure: 4 } },
    });
    if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');
    const take = synthesizeTake(drill.question.score, {
      tempo: drill.question.tempoTarget, seed: 7,
    });
    const grade = gradeDrill(drill, { kind: 'take', take });
    expect(grade.diagnostics.fromMeasure).toBe(2);
    expect(grade.diagnostics.toMeasure).toBe(4);
  });

  it('drops with dropped notes, and does not cascade', () => {
    // The anti-cascade property the affine-gap aligner exists for: a handful
    // of omissions costs those notes, not everything after them.
    const clean = play({});
    const missed = play({ dropped: 3 });
    expect(missed.correctness).toBeLessThan(clean.correctness);
    expect(missed.correctness).toBeGreaterThan(0.6);
  });

  it('does not credit a take played at the wrong tempo', () => {
    // The defect this exists to catch, found by looking at the screen rather
    // than at a test: a take hammered out at twice the target hit every note,
    // scored 100%, and was recorded as "best held clean: 233" — which then set
    // the next target to the marked tempo. The tempo map absorbs a uniform
    // tempo change by design, so the performance score alone cannot see this.
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 4, seed: 1,
      repertoire: { pieceId: 'fixture-3', tempoTarget: 60 },
    });
    if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');

    // Note-perfect, but played at twice the tempo it was asked for.
    const rushed = synthesizeTake(drill.question.score, { tempo: 120, seed: 7 });
    const grade = gradeDrill(drill, { kind: 'take', take: rushed });

    expect(grade.correct).toBe(false);
    // Zero means "no tempo demonstrated", which the fold reads as a reason to
    // hold `achievedTempo` rather than to move it.
    expect(grade.diagnostics.tempoBpm).toBe(0);
    expect(grade.diagnostics.tempoPlayedBpm).toBeGreaterThan(100);
    expect(grade.detail).toMatch(/target of 60/);
  });

  it('credits the target when the take was actually played at it', () => {
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 4, seed: 1,
      repertoire: { pieceId: 'fixture-3', tempoTarget: 60 },
    });
    if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');

    const take = synthesizeTake(drill.question.score, { tempo: 60, seed: 7 });
    const grade = gradeDrill(drill, { kind: 'take', take });

    expect(grade.correct).toBe(true);
    // The target, not the measured median: what the take demonstrates you can
    // hold is the tempo you were asked for and met.
    expect(grade.diagnostics.tempoBpm).toBe(60);
  });

  it('tolerates the drift of an unaccompanied take', () => {
    // Narrow enough that holding one rung cannot be satisfied by playing the
    // one below it, wide enough that a take without a click still counts.
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 4, seed: 1,
      repertoire: { pieceId: 'fixture-3', tempoTarget: 60 },
    });
    if (drill.question.kind !== 'play-piece') throw new Error('wrong kind');

    const slightly = synthesizeTake(drill.question.score, {
      tempo: 60 * (1 + TEMPO_TOLERANCE * 0.6), seed: 7,
    });
    expect(gradeDrill(drill, { kind: 'take', take: slightly }).diagnostics.tempoBpm)
      .toBe(60);
  });

  it('rejects a response that is not a take', () => {
    const drill = generateDrill({
      modeId: 'repertoire', rungIndex: 0, seed: 1, repertoire: { pieceId: 'fixture-1' },
    });
    expect(gradeDrill(drill, { kind: 'notes', midi: [60] }).correct).toBe(false);
    expect(gradeDrill(drill, { kind: 'skipped' }).correctness).toBe(0);
  });
});
