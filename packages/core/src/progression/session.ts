/**
 * The adaptive session builder.
 *
 * You tap a time budget; this allocates it. The shares below are a teacher's
 * default lesson shape, not an arbitrary split: a warmup that is always
 * present, real time on the weakest domain, reading on new material every day,
 * and repertoire that keeps old pieces alive.
 *
 * Two rules are deliberate and worth stating:
 *   - Slots are filled from the *due* queue, so review is driven by decay
 *     rather than by whim.
 *   - Activities are interleaved across skills rather than blocked by skill.
 *     Blocked practice feels more productive and produces less durable
 *     learning, which is precisely the trap this app exists to avoid.
 */

import type { DomainId } from '../skills/taxonomy';
import type { DueItem } from './scheduler';

export type SlotId = 'warmup' | 'weakest' | 'reading' | 'ear-theory' | 'repertoire';

export interface Slot {
  readonly id: SlotId;
  readonly name: string;
  readonly share: number;
  readonly domains: readonly DomainId[];
  readonly note: string;
}

export const SLOTS: readonly Slot[] = [
  {
    id: 'warmup', name: 'Warmup', share: 0.1,
    domains: ['technique', 'rhythm'],
    note: 'Always present. Cold hands make every other measurement a lie.',
  },
  {
    id: 'weakest', name: 'Weakest link', share: 0.25,
    domains: ['theory', 'ear', 'rhythm', 'reading', 'technique', 'independence'],
    note: 'Whatever is furthest behind, weighted by what is overdue.',
  },
  {
    id: 'reading', name: 'Reading', share: 0.2,
    domains: ['reading'],
    note: 'New material every time. Repeating it turns reading into memorising.',
  },
  {
    id: 'ear-theory', name: 'Ear and theory', share: 0.2,
    domains: ['ear', 'theory'],
    note: 'Functional listening, plus the theory that explains what you heard.',
  },
  {
    id: 'repertoire', name: 'Repertoire', share: 0.25,
    domains: ['repertoire', 'independence'],
    note: 'The current piece, plus one you already know, so it stays known.',
  },
];

export interface PlannedSlot {
  readonly slot: Slot;
  readonly seconds: number;
  readonly skillIds: readonly string[];
}

export interface SessionPlan {
  readonly budgetMinutes: number;
  readonly slots: readonly PlannedSlot[];
  readonly totalSeconds: number;
}

export interface PlanInput {
  readonly budgetMinutes: number;
  readonly due: readonly DueItem[];
  /** Domain lookup for a skill id. */
  readonly domainOf: (skillId: string) => DomainId | null;
  /** Domains with no usable activities yet, e.g. everything needing MIDI. */
  readonly unavailableDomains?: readonly DomainId[];
}

/**
 * Build a session plan for the available time.
 *
 * Slots whose domains have nothing available — the MIDI-dependent ones, before
 * the adapter arrives — are dropped and their share redistributed, so a
 * keyboard-free session still fills the whole budget instead of leaving gaps.
 */
export function buildSessionPlan(input: PlanInput): SessionPlan {
  const unavailable = new Set(input.unavailableDomains ?? []);
  const usable = SLOTS.filter((s) => s.domains.some((d) => !unavailable.has(d)));
  const totalShare = usable.reduce((acc, s) => acc + s.share, 0) || 1;
  const totalSeconds = input.budgetMinutes * 60;

  const byDomain = new Map<DomainId, DueItem[]>();
  for (const item of input.due) {
    const d = input.domainOf(item.skillId);
    if (!d || unavailable.has(d)) continue;
    const bucket = byDomain.get(d);
    if (bucket) bucket.push(item);
    else byDomain.set(d, [item]);
  }

  const slots: PlannedSlot[] = usable.map((slot) => {
    const seconds = Math.round((slot.share / totalShare) * totalSeconds);
    const candidates = slot.domains
      .filter((d) => !unavailable.has(d))
      .flatMap((d) => byDomain.get(d) ?? []);

    // Interleave: take the highest-priority item from each distinct skill in
    // turn rather than draining one skill before moving on.
    const seen = new Set<string>();
    const skillIds: string[] = [];
    for (const item of [...candidates].sort((a, b) => b.priority - a.priority)) {
      if (seen.has(item.skillId)) continue;
      seen.add(item.skillId);
      skillIds.push(item.skillId);
      // Roughly 45 seconds per skill keeps a slot varied without being frantic.
      if (skillIds.length >= Math.max(1, Math.round(seconds / 45))) break;
    }

    return { slot, seconds, skillIds };
  });

  return {
    budgetMinutes: input.budgetMinutes,
    slots,
    totalSeconds: slots.reduce((acc, s) => acc + s.seconds, 0),
  };
}

export const TIME_BUDGETS = [10, 20, 45] as const;
