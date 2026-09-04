import { describe, expect, it } from 'vitest';
import {
  applyEvidence, currentMastery, dueAt, initialMastery, masteryBand,
} from './mastery.js';
import {
  initialStreak, localDay, practicedToday, recordQualifyingDay, streakIsAlive,
} from './streak.js';
import { computeXp, levelForXp, xpForLevel } from './xp.js';
import {
  DEMOTE_AT, PROMOTE_AT, WINDOW, currentRung, initialLadderState, recordAttempt,
  type Ladder,
} from './ladder.js';
import {
  buildDueQueue, gradeFromPerformance, motorDueAt, newDeclarativeCard, newMotorState,
  retrievability, reviewDeclarative, reviewMotor, Rating,
} from './scheduler.js';

const day = (n: number) => {
  const d = new Date('2026-03-01T12:00:00Z');
  d.setDate(d.getDate() + n);
  return d;
};

describe('mastery', () => {
  it('starts at zero and rises with correct evidence', () => {
    let m = initialMastery('theory.note-names', 'declarative');
    expect(currentMastery(m)).toBe(0);
    m = applyEvidence(m, 1, 1, day(0));
    expect(currentMastery(m, day(0))).toBeGreaterThan(0.5);
  });

  it('decays over time, which is what makes review honest', () => {
    let m = initialMastery('theory.note-names', 'declarative');
    m = applyEvidence(m, 1, 1, day(0));
    const atOnce = currentMastery(m, day(0));
    const laterSame = currentMastery(m, day(14));
    expect(laterSame).toBeLessThan(atOnce);
  });

  it('decays motor skills far more slowly than declarative ones', () => {
    let declarative = initialMastery('theory.note-names', 'declarative');
    let motor = initialMastery('technique.five-finger', 'motor');
    declarative = applyEvidence(declarative, 1, 1, day(0));
    motor = applyEvidence(motor, 1, 1, day(0));
    expect(currentMastery(motor, day(10)))
      .toBeGreaterThan(currentMastery(declarative, day(10)));
  });

  it('grows stability on success and cuts it on a lapse', () => {
    let m = initialMastery('theory.note-names', 'declarative');
    m = applyEvidence(m, 1, 1, day(0));
    const grown = m.stability;
    m = applyEvidence(m, 0.2, 1, day(1));
    expect(m.stability).toBeLessThan(grown);
    expect(m.lapses).toBe(1);
  });

  it('applies evidence against the decayed value, not the peak', () => {
    let m = initialMastery('theory.note-names', 'declarative');
    m = applyEvidence(m, 1, 1, day(0));
    const afterLongGap = applyEvidence(m, 1, 1, day(60));
    // Re-learning from near zero cannot leap straight back to the old peak.
    expect(afterLongGap.mastery).toBeLessThan(0.95);
  });

  it('reports a due date once mastery will decay past the threshold', () => {
    let m = initialMastery('theory.note-names', 'declarative');
    m = applyEvidence(m, 1, 1, day(0));
    const due = dueAt(m);
    expect(due).not.toBeNull();
    expect(due!.getTime()).toBeGreaterThan(day(0).getTime());
  });

  it('bands mastery for display', () => {
    expect(masteryBand(0)).toBe('untouched');
    expect(masteryBand(0.3)).toBe('learning');
    expect(masteryBand(0.6)).toBe('working');
    expect(masteryBand(0.95)).toBe('mastered');
  });
});

describe('streak', () => {
  it('starts on the first qualifying day', () => {
    const r = recordQualifyingDay(initialStreak, '2026-03-01');
    expect(r.outcome).toBe('started');
    expect(r.state.current).toBe(1);
  });

  it('is idempotent within a day', () => {
    const first = recordQualifyingDay(initialStreak, '2026-03-01');
    const second = recordQualifyingDay(first.state, '2026-03-01');
    expect(second.outcome).toBe('already-counted');
    expect(second.state.current).toBe(1);
  });

  it('extends on consecutive days', () => {
    let s = recordQualifyingDay(initialStreak, '2026-03-01').state;
    s = recordQualifyingDay(s, '2026-03-02').state;
    s = recordQualifyingDay(s, '2026-03-03').state;
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it('earns a freeze after a full week', () => {
    let s = initialStreak;
    let earned = false;
    for (let i = 1; i <= 7; i++) {
      const r = recordQualifyingDay(s, `2026-03-0${i}`);
      s = r.state;
      earned = earned || r.freezeEarned;
    }
    expect(s.current).toBe(7);
    expect(earned).toBe(true);
    expect(s.freezesBanked).toBe(1);
  });

  it('spends a banked freeze to survive a missed day', () => {
    let s = initialStreak;
    for (let i = 1; i <= 7; i++) s = recordQualifyingDay(s, `2026-03-0${i}`).state;
    expect(s.freezesBanked).toBe(1);

    // Skip 8 March, practise on the 9th.
    const r = recordQualifyingDay(s, '2026-03-09');
    expect(r.outcome).toBe('saved-by-freeze');
    expect(r.state.current).toBe(8);
    expect(r.state.freezesBanked).toBe(0);
  });

  it('breaks when there are not enough freezes', () => {
    let s = recordQualifyingDay(initialStreak, '2026-03-01').state;
    const r = recordQualifyingDay(s, '2026-03-10');
    expect(r.outcome).toBe('broken');
    expect(r.state.current).toBe(1);
    expect(r.state.longest).toBe(1);
  });

  it('never banks more than the cap', () => {
    let s = initialStreak;
    for (let i = 1; i <= 28; i++) {
      const iso = `2026-03-${String(i).padStart(2, '0')}`;
      s = recordQualifyingDay(s, iso).state;
    }
    expect(s.freezesBanked).toBeLessThanOrEqual(2);
  });

  it('knows whether the streak is still alive before today is logged', () => {
    let s = recordQualifyingDay(initialStreak, '2026-03-01').state;
    expect(streakIsAlive(s, '2026-03-02')).toBe(true);
    expect(streakIsAlive(s, '2026-03-05')).toBe(false);
    expect(practicedToday(s, '2026-03-01')).toBe(true);
  });

  it('uses local calendar days so a late-night session counts for that day', () => {
    const late = new Date(2026, 2, 1, 23, 30);
    expect(localDay(late)).toBe('2026-03-01');
  });

  it('ignores a backwards clock rather than corrupting the count', () => {
    const s = recordQualifyingDay(initialStreak, '2026-03-05').state;
    const r = recordQualifyingDay(s, '2026-03-04');
    expect(r.outcome).toBe('already-counted');
    expect(r.state.current).toBe(1);
  });
});

describe('xp', () => {
  it('rewards accuracy rather than time', () => {
    const good = computeXp({ base: 100, accuracy: 1 });
    const sloppy = computeXp({ base: 100, accuracy: 0.6 });
    expect(good.total).toBeGreaterThan(sloppy.total);
  });

  it('pays almost nothing for guessing', () => {
    expect(computeXp({ base: 100, accuracy: 0.2 }).total).toBeLessThan(15);
  });

  it('discounts scaffolds by how much they substitute for the skill', () => {
    const clean = computeXp({ base: 100, accuracy: 1 });
    const withFingering = computeXp({ base: 100, accuracy: 1, scaffolds: ['fingering'] });
    const withLetters = computeXp({ base: 100, accuracy: 1, scaffolds: ['letter-names'] });

    expect(withFingering.total).toBeLessThan(clean.total);
    // Fingering is standard editorial practice; letter names replace reading.
    expect(withLetters.total).toBeLessThan(withFingering.total);
  });

  it('compounds multiple scaffolds', () => {
    const one = computeXp({ base: 100, accuracy: 1, scaffolds: ['keyboard-highlight'] });
    const two = computeXp({
      base: 100, accuracy: 1, scaffolds: ['keyboard-highlight', 'letter-names'],
    });
    expect(two.total).toBeLessThan(one.total);
  });

  it('pays more for higher rungs', () => {
    const low = computeXp({ base: 100, accuracy: 1, rungIndex: 0 });
    const high = computeXp({ base: 100, accuracy: 1, rungIndex: 4 });
    expect(high.total).toBeGreaterThan(low.total);
  });

  it('scales by achieved tempo', () => {
    const full = computeXp({ base: 100, accuracy: 1, tempoRatio: 1 });
    const half = computeXp({ base: 100, accuracy: 1, tempoRatio: 0.5 });
    expect(half.total).toBeLessThan(full.total);
  });

  it('has a monotonic level curve', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(150).level).toBe(2);
    let last = -1;
    for (let lvl = 1; lvl <= 30; lvl++) {
      const need = xpForLevel(lvl);
      expect(need).toBeGreaterThan(last);
      last = need;
      expect(levelForXp(need).level).toBe(lvl);
    }
  });
});

describe('difficulty ladder', () => {
  const ladder: Ladder = {
    modeId: 'chord-sprint',
    rungs: [
      { id: 'r0', name: 'Root triads', params: {}, skillIds: ['theory.triads.major-minor'] },
      { id: 'r1', name: 'Inversions', params: {}, skillIds: ['theory.triads.inversions'] },
      { id: 'r2', name: 'Sevenths', params: {}, skillIds: ['theory.sevenths.dominant'] },
    ],
  };

  it('holds until the window is full', () => {
    let st = initialLadderState('chord-sprint');
    for (let i = 0; i < WINDOW - 1; i++) {
      const r = recordAttempt(st, ladder, 1);
      expect(r.move).toBe('hold');
      st = r.state;
    }
  });

  it('promotes on a full window of high accuracy', () => {
    let st = initialLadderState('chord-sprint');
    let moved = false;
    for (let i = 0; i < WINDOW; i++) {
      const r = recordAttempt(st, ladder, 1);
      st = r.state;
      moved = moved || r.move === 'promote';
    }
    expect(moved).toBe(true);
    expect(st.rungIndex).toBe(1);
    expect(currentRung(st, ladder).id).toBe('r1');
  });

  it('clears the window after moving, so the next rung is judged fresh', () => {
    let st = initialLadderState('chord-sprint');
    for (let i = 0; i < WINDOW; i++) st = recordAttempt(st, ladder, 1).state;
    expect(st.recent).toHaveLength(0);
  });

  it('demotes on a full window of failure', () => {
    let st = { ...initialLadderState('chord-sprint'), rungIndex: 2 };
    for (let i = 0; i < WINDOW; i++) st = recordAttempt(st, ladder, 0.3).state;
    expect(st.rungIndex).toBe(1);
    expect(st.demotions).toBe(1);
  });

  it('never moves past either end of the ladder', () => {
    let top = { ...initialLadderState('chord-sprint'), rungIndex: 2 };
    for (let i = 0; i < WINDOW * 2; i++) top = recordAttempt(top, ladder, 1).state;
    expect(top.rungIndex).toBe(2);

    let bottom = initialLadderState('chord-sprint');
    for (let i = 0; i < WINDOW * 2; i++) bottom = recordAttempt(bottom, ladder, 0).state;
    expect(bottom.rungIndex).toBe(0);
  });

  it('remembers the high-water rung even after demotion', () => {
    let st = initialLadderState('chord-sprint');
    for (let i = 0; i < WINDOW; i++) st = recordAttempt(st, ladder, 1).state;
    for (let i = 0; i < WINDOW; i++) st = recordAttempt(st, ladder, 0.2).state;
    expect(st.rungIndex).toBe(0);
    expect(st.highWater).toBe(1);
  });

  it('uses thresholds that leave a stable band between them', () => {
    expect(PROMOTE_AT).toBeGreaterThan(DEMOTE_AT);
  });
});

describe('schedulers', () => {
  it('derives an FSRS grade from accuracy and speed', () => {
    expect(gradeFromPerformance(0.2, 1000)).toBe(Rating.Again);
    expect(gradeFromPerformance(0.7, 1000)).toBe(Rating.Hard);
    expect(gradeFromPerformance(1, 1500)).toBe(Rating.Easy);
    // Correct but slow is not fluent.
    expect(gradeFromPerformance(1, 9000)).toBe(Rating.Hard);
  });

  it('schedules a declarative card further out after a good review', () => {
    const card = newDeclarativeCard('theory.note-names');
    const reviewed = reviewDeclarative(card, 1, 1500, day(0));
    expect(new Date(reviewed.card.due).getTime()).toBeGreaterThan(day(0).getTime());
    expect(reviewed.card.reps).toBe(1);
  });

  it('reports declining retrievability as time passes', () => {
    const reviewed = reviewDeclarative(newDeclarativeCard('s'), 1, 1200, day(0));
    expect(retrievability(reviewed, day(30)))
      .toBeLessThan(retrievability(reviewed, day(1)));
  });

  it('raises the motor tempo only when the criterion is held', () => {
    const st = newMotorState('technique.scales.one-octave', 120, 60);
    const held = reviewMotor(st, 0.98, 72, day(0));
    expect(held.achievedTempo).toBe(72);
    expect(held.intervalIndex).toBe(1);
  });

  it('drops one tempo rung on failure instead of resetting', () => {
    let st = newMotorState('technique.scales.one-octave', 120, 80);
    st = { ...st, intervalIndex: 3 };
    const failed = reviewMotor(st, 0.7, 80, day(0));
    expect(failed.achievedTempo).toBe(72); // one step down, not zero
    expect(failed.intervalIndex).toBe(2);
  });

  it('spaces motor review far more flatly than declarative review', () => {
    let motor = newMotorState('technique.scales.one-octave', 120, 60);
    for (let i = 0; i < 4; i++) motor = reviewMotor(motor, 1, 100, day(i));
    const motorGapDays =
      (motorDueAt(motor)!.getTime() - day(3).getTime()) / 86_400_000;
    expect(motorGapDays).toBeGreaterThanOrEqual(21);
  });

  it('puts never-practised skills at the front of the queue', () => {
    const q = buildDueQueue({
      declarative: [newDeclarativeCard('theory.note-names')],
      motor: [newMotorState('technique.five-finger', 100)],
      mastery: new Map(),
    }, day(0));
    expect(q.length).toBe(2);
    expect(q[0]?.reason).toBe('new');
  });

  it('omits declarative cards that are not yet due', () => {
    const reviewed = reviewDeclarative(newDeclarativeCard('s'), 1, 1200, day(0));
    const q = buildDueQueue(
      { declarative: [reviewed], motor: [], mastery: new Map() },
      day(0),
    );
    expect(q).toHaveLength(0);
  });

  it('keeps a motor skill queued while it is below target tempo', () => {
    let motor = newMotorState('technique.scales.one-octave', 160, 60);
    motor = reviewMotor(motor, 1, 70, day(0));
    const q = buildDueQueue(
      { declarative: [], motor: [motor], mastery: new Map() },
      day(0),
    );
    expect(q[0]?.reason).toBe('below-target-tempo');
  });
});
