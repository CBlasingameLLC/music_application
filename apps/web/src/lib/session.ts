/**
 * Turning a time budget into an actual queue of drills.
 *
 * `buildSessionPlan` in core allocates time across slots from the due queue;
 * this maps those slots onto the game modes that can actually drill them, and
 * interleaves the result so no single mode runs for long.
 */

import {
  type DomainId, type DueItem, type ModeId, type MasteryState, type SessionPlan,
  LADDERS, MODES, SKILLS, buildSessionPlan, newDeclarativeCard, newMotorState,
  buildDueQueue, skill,
} from '@etude/core';
import type { RunnerStep } from '@/components/DrillRunner';
import type { SkillRow } from '@/db/schema';

/** Domains with no keyboard-free drills yet. Everything here needs MIDI. */
export const MIDI_ONLY_DOMAINS: readonly DomainId[] = [
  'technique', 'independence', 'repertoire',
];

/**
 * Modes the shared drill runner can actually present.
 *
 * The take-based modes have their own screens — a performance needs a
 * metronome, a count-in and a report, none of which the runner has — so
 * scheduling one into a session would put an unanswerable drill in front of the
 * user. They are reached directly instead.
 */
const SCHEDULABLE = MODES.filter((m) => !m.standalone);

/** Which modes can provide evidence for a given skill. */
const MODES_BY_SKILL = (() => {
  const map = new Map<string, Set<ModeId>>();
  for (const mode of SCHEDULABLE) {
    for (const rung of LADDERS[mode.id].rungs) {
      for (const skillId of rung.skillIds) {
        const set = map.get(skillId) ?? new Set<ModeId>();
        set.add(mode.id);
        map.set(skillId, set);
      }
    }
  }
  return map;
})();

export function domainOf(skillId: string): DomainId | null {
  try {
    return skill(skillId).domain;
  } catch {
    return null;
  }
}

/** Reconstruct the scheduler inputs from stored rows, filling gaps for new skills. */
export function dueQueueFromRows(rows: readonly SkillRow[], now = new Date()): DueItem[] {
  const byId = new Map(rows.map((r) => [r.skillId, r]));
  const declarative = [];
  const motor = [];
  const mastery = new Map<string, MasteryState>();

  for (const s of SKILLS) {
    if (MIDI_ONLY_DOMAINS.includes(s.domain)) continue;
    // A skill nothing can drill yet would sit permanently at the front of the
    // queue and starve everything behind it.
    if (!MODES_BY_SKILL.has(s.id)) continue;

    const row = byId.get(s.id);
    const m = row?.mastery as MasteryState | undefined;
    if (m) mastery.set(s.id, m);

    if (s.kind === 'declarative') {
      declarative.push(
        (row?.declarative as ReturnType<typeof newDeclarativeCard> | undefined)
          ?? newDeclarativeCard(s.id),
      );
    } else {
      motor.push(
        (row?.motor as ReturnType<typeof newMotorState> | undefined)
          ?? newMotorState(s.id, 120),
      );
    }
  }

  return buildDueQueue({ declarative, motor, mastery }, now);
}

export function planFor(budgetMinutes: number, due: readonly DueItem[]): SessionPlan {
  return buildSessionPlan({
    budgetMinutes,
    due,
    domainOf,
    unavailableDomains: MIDI_ONLY_DOMAINS,
  });
}

/**
 * Convert a plan into the drill queue the runner executes.
 *
 * Modes are interleaved rather than blocked. Blocked practice — all the chords,
 * then all the intervals — feels more productive and produces measurably less
 * durable learning, so the queue deliberately shuffles between them.
 */
export function stepsFromPlan(plan: SessionPlan): RunnerStep[] {
  const perMode = new Map<ModeId, number>();
  const secondsPerDrill = 22;

  for (const planned of plan.slots) {
    const budget = Math.max(1, Math.round(planned.seconds / secondsPerDrill));
    const modes = planned.skillIds
      .flatMap((id) => [...(MODES_BY_SKILL.get(id) ?? [])]);

    // Fall back to the modes matching the slot's domains when nothing is due,
    // so an empty queue still produces a usable session rather than a blank one.
    const candidates = modes.length > 0
      ? modes
      : SCHEDULABLE.filter((m) =>
          LADDERS[m.id].rungs.some((r) =>
            r.skillIds.some((s) => {
              const d = domainOf(s);
              return d !== null && planned.slot.domains.includes(d);
            }),
          ),
        ).map((m) => m.id);

    if (candidates.length === 0) continue;
    for (let i = 0; i < budget; i++) {
      const modeId = candidates[i % candidates.length];
      if (!modeId) continue;
      perMode.set(modeId, (perMode.get(modeId) ?? 0) + 1);
    }
  }

  if (perMode.size === 0) {
    return [{ modeId: 'chord-sprint', count: 8 }];
  }

  // Interleave: emit short runs of each mode round-robin rather than one long
  // block per mode.
  const remaining = [...perMode.entries()];
  const steps: RunnerStep[] = [];
  const chunk = 3;
  while (remaining.some(([, n]) => n > 0)) {
    for (const entry of remaining) {
      const [modeId, count] = entry;
      if (count <= 0) continue;
      const take = Math.min(chunk, count);
      steps.push({ modeId, count: take });
      entry[1] = count - take;
    }
  }
  return steps;
}
