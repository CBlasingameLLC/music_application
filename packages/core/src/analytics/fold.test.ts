import { describe, expect, it } from 'vitest';
import { emptyAppState, foldEvents, type SkillAccumulator } from './fold';
import { LADDERS } from '../generators/modes';
import { WINDOW } from '../progression/ladder';
import { makeEvent, type EtudeEvent } from '../events/types';
import { SKILLS } from '../skills/taxonomy';

const CONTEXT = { deviceId: 'test', appVersion: '0.0.0', streamId: 'practice' };

let clock = 0;
function event<T extends EtudeEvent['type']>(
  type: T,
  payload: unknown,
  at: string,
): EtudeEvent {
  clock += 1;
  const made = makeEvent(type as never, payload as never, {
    ...CONTEXT,
    seq: clock,
  } as never) as EtudeEvent;
  return { ...made, at } as EtudeEvent;
}

const MOTOR = SKILLS.find((s) => s.kind === 'motor')!;
const DECLARATIVE = SKILLS.find((s) => s.kind === 'declarative')!;

/**
 * The three events a real attempt writes, in the order `appendMany` writes
 * them. The ladder window can only be rebuilt by joining across all three, so a
 * fixture that skipped `Presented` would not exercise the thing under test.
 */
function attempt(opts: {
  modeId: string;
  skillId: string;
  correctness: number;
  day?: string;
  activityId?: string;
  diagnostics?: Record<string, number>;
}): EtudeEvent[] {
  const at = `${opts.day ?? '2026-03-01'}T12:00:00.000Z`;
  const attemptId = `att-${(clock + 1).toString(36)}`;
  const activityId = opts.activityId ?? `act-${(clock + 1).toString(36)}`;
  const ladder = LADDERS[opts.modeId as keyof typeof LADDERS];
  const rungId = ladder?.rungs[0]?.id ?? 'r0';

  return [
    event('Activity.Presented', {
      sessionId: null,
      activityId,
      modeId: opts.modeId,
      rungId,
      skillIds: [opts.skillId],
      seed: 1,
    }, at),
    event('Activity.Attempted', {
      attemptId, activityId, sessionId: null, responseMs: 2000,
      response: null, scaffolds: [],
    }, at),
    event('Activity.Graded', {
      attemptId,
      correctness: opts.correctness,
      latencyMs: 2000,
      diagnostics: opts.diagnostics ?? {},
      skillEvidence: [{ skillId: opts.skillId, correctness: opts.correctness, weight: 1 }],
      xpAwarded: 10,
      graderVersion: 1,
    }, at),
  ];
}

function fold(events: readonly EtudeEvent[]) {
  const skills = new Map<string, SkillAccumulator>();
  const state = foldEvents(emptyAppState, skills, events);
  return { state, skills };
}

describe('the ladder window', () => {
  it('accumulates recent correctness so a window can fill', () => {
    // The defect this exists to catch: the fold rebuilt `rungIndex` from
    // `Ladder.Moved` but always wrote `recent: []`. With the window always empty,
    // `windowFull` was never true, so no move was ever decided, so
    // `Ladder.Moved` was never appended — a cycle that pinned every mode to
    // rung 1 permanently.
    const events = Array.from({ length: WINDOW }, () =>
      attempt({ modeId: 'chord-sprint', skillId: DECLARATIVE.id, correctness: 1 }),
    ).flat();

    const { state } = fold(events);
    expect(state.ladders['chord-sprint']?.recent).toHaveLength(WINDOW);
  });

  it('keeps only the last WINDOW attempts', () => {
    const events = Array.from({ length: WINDOW + 5 }, (_, i) =>
      attempt({ modeId: 'degrees', skillId: DECLARATIVE.id, correctness: i / 100 }),
    ).flat();

    const recent = fold(events).state.ladders['degrees']?.recent ?? [];
    expect(recent).toHaveLength(WINDOW);
    // Oldest first, so the tail of the input is what survives.
    expect(recent[recent.length - 1]).toBeCloseTo((WINDOW + 4) / 100, 6);
  });

  it('keeps each mode’s window separate', () => {
    const events = [
      ...attempt({ modeId: 'chord-sprint', skillId: DECLARATIVE.id, correctness: 1 }),
      ...attempt({ modeId: 'degrees', skillId: DECLARATIVE.id, correctness: 0 }),
      ...attempt({ modeId: 'chord-sprint', skillId: DECLARATIVE.id, correctness: 1 }),
    ];
    const { state } = fold(events);
    expect(state.ladders['chord-sprint']?.recent).toEqual([1, 1]);
    expect(state.ladders['degrees']?.recent).toEqual([0]);
  });

  it('clears the window when the rung moves', () => {
    // Judging a new rung on evidence from the old one would promote on stale
    // results and oscillate.
    const ladder = LADDERS['chord-sprint'];
    const events = [
      ...attempt({ modeId: 'chord-sprint', skillId: DECLARATIVE.id, correctness: 1 }),
      ...attempt({ modeId: 'chord-sprint', skillId: DECLARATIVE.id, correctness: 1 }),
      event('Ladder.Moved', {
        modeId: 'chord-sprint',
        fromRungId: ladder.rungs[0]!.id,
        toRungId: ladder.rungs[1]!.id,
        direction: 'promote',
      }, '2026-03-01T12:00:00.000Z'),
    ];
    const { state } = fold(events);
    expect(state.ladders['chord-sprint']?.recent).toEqual([]);
    expect(state.ladders['chord-sprint']?.rungIndex).toBe(1);
  });

  it('drops an attempt it cannot attribute rather than guessing', () => {
    // The three events are written in one transaction and the projection
    // cursor advances in the same one, so a batch cannot be split. If that
    // ever stops holding, undercounting the window merely delays a promotion;
    // attributing a grade to the wrong mode would corrupt one.
    const orphan = attempt({
      modeId: 'chord-sprint', skillId: DECLARATIVE.id, correctness: 1,
    }).slice(2); // the Graded alone

    const { state } = fold(orphan);
    expect(state.ladders['chord-sprint']).toBeUndefined();
  });

  it('ignores a mode this build no longer defines', () => {
    const events = attempt({
      modeId: 'mode-that-was-removed', skillId: DECLARATIVE.id, correctness: 1,
    });
    expect(() => fold(events)).not.toThrow();
  });
});

describe('the tempo ladder', () => {
  it('rises with the tempo actually played', () => {
    // The defect: the fold passed `motor.achievedTempo` as `reviewMotor`'s
    // `tempoPlayed`, so its success branch was `Math.max(a, a)` — a no-op.
    // Every motor skill sat at the 60 BPM default forever and could only fall.
    const events = [60, 72, 84, 96].flatMap((bpm) =>
      attempt({
        modeId: 'independence',
        skillId: MOTOR.id,
        correctness: 1,
        diagnostics: { tempoBpm: bpm },
      }),
    );

    const { skills } = fold(events);
    expect(skills.get(MOTOR.id)?.motor?.achievedTempo).toBe(96);
  });

  it('keeps the best tempo held, not the last one attempted', () => {
    const events = [
      ...attempt({
        modeId: 'independence', skillId: MOTOR.id, correctness: 1,
        diagnostics: { tempoBpm: 96 },
      }),
      ...attempt({
        modeId: 'independence', skillId: MOTOR.id, correctness: 1,
        diagnostics: { tempoBpm: 72 },
      }),
    ];
    expect(fold(events).skills.get(MOTOR.id)?.motor?.achievedTempo).toBe(96);
  });

  it('drops a rung when the tempo is not held', () => {
    const events = [
      ...attempt({
        modeId: 'independence', skillId: MOTOR.id, correctness: 1,
        diagnostics: { tempoBpm: 96 },
      }),
      ...attempt({
        modeId: 'independence', skillId: MOTOR.id, correctness: 0.5,
        diagnostics: { tempoBpm: 96 },
      }),
    ];
    // Failure drops one step rather than resetting: a missed rep at a stretch
    // tempo means the tempo was too high, not that the skill evaporated.
    expect(fold(events).skills.get(MOTOR.id)?.motor?.achievedTempo).toBe(88);
  });

  it('holds rather than invents a tempo when none was measured', () => {
    // The same rule the per-hand metrics follow when staff data is absent: an
    // honest gap beats a confident wrong number. A drill that reports no tempo
    // is not evidence that the skill was held at any particular speed.
    const events = [
      ...attempt({
        modeId: 'independence', skillId: MOTOR.id, correctness: 1,
        diagnostics: { tempoBpm: 88 },
      }),
      ...attempt({ modeId: 'independence', skillId: MOTOR.id, correctness: 1 }),
    ];
    expect(fold(events).skills.get(MOTOR.id)?.motor?.achievedTempo).toBe(88);
  });

  it('does not drop the tempo on a failure whose tempo was not measured', () => {
    // Symmetry with the case above. A drill that reports no tempo is not
    // evidence that a tempo was missed either, so a poor result there must not
    // walk the ladder down a rung it was never tested at.
    const events = [
      ...attempt({
        modeId: 'independence', skillId: MOTOR.id, correctness: 1,
        diagnostics: { tempoBpm: 88 },
      }),
      ...attempt({ modeId: 'independence', skillId: MOTOR.id, correctness: 0.2 }),
    ];
    expect(fold(events).skills.get(MOTOR.id)?.motor?.achievedTempo).toBe(88);
  });
});
