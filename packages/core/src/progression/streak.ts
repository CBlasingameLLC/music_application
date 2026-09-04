/**
 * Streaks, with freezes.
 *
 * The daily minimum is deliberately low. A streak you can only keep on a good
 * day is a streak you will break, and the single most common way habit apps
 * lose people is the day after the break — the counter reads zero, the sunk
 * cost is gone, and so is the user.
 *
 * Freeze tokens defuse that. You earn one per unbroken week, bank at most two,
 * and they are spent automatically to cover a missed day. The streak survives a
 * bad week without the number becoming a lie.
 */

export interface StreakState {
  readonly current: number;
  readonly longest: number;
  /** Local calendar day (YYYY-MM-DD) of the last qualifying session. */
  readonly lastQualifiedDay: string | null;
  readonly freezesBanked: number;
  readonly freezesUsedTotal: number;
  readonly totalQualifiedDays: number;
}

export const DAILY_MINIMUM_MINUTES = 10;
export const MAX_BANKED_FREEZES = 2;
const DAYS_PER_EARNED_FREEZE = 7;

export const initialStreak: StreakState = {
  current: 0,
  longest: 0,
  lastQualifiedDay: null,
  freezesBanked: 0,
  freezesUsedTotal: 0,
  totalQualifiedDays: 0,
};

/**
 * Local calendar day, not UTC. Practising at 11pm must count for that day, and
 * a UTC date would silently roll it into tomorrow for most of the world.
 */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayDifference(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export interface StreakUpdate {
  readonly state: StreakState;
  /** What happened, so the UI can celebrate or explain rather than just re-render. */
  readonly outcome:
    | 'already-counted'
    | 'extended'
    | 'started'
    | 'saved-by-freeze'
    | 'broken';
  readonly freezesSpent: number;
  readonly freezeEarned: boolean;
}

/**
 * Record a qualifying practice day.
 *
 * Call this once a session crosses the daily minimum. Calling it repeatedly on
 * the same day is safe and does nothing.
 */
export function recordQualifyingDay(
  state: StreakState,
  today: string = localDay(),
): StreakUpdate {
  if (state.lastQualifiedDay === today) {
    return { state, outcome: 'already-counted', freezesSpent: 0, freezeEarned: false };
  }

  if (!state.lastQualifiedDay) {
    const next: StreakState = {
      ...state,
      current: 1,
      longest: Math.max(state.longest, 1),
      lastQualifiedDay: today,
      totalQualifiedDays: state.totalQualifiedDays + 1,
    };
    return { state: next, outcome: 'started', freezesSpent: 0, freezeEarned: false };
  }

  const gap = dayDifference(state.lastQualifiedDay, today);

  // A clock change or a backdated import can produce a non-positive gap.
  // Treat it as already counted rather than corrupting the streak.
  if (gap <= 0) {
    return { state, outcome: 'already-counted', freezesSpent: 0, freezeEarned: false };
  }

  const missedDays = gap - 1;
  let outcome: StreakUpdate['outcome'];
  let freezesSpent = 0;
  let current: number;
  let freezesBanked = state.freezesBanked;

  if (missedDays === 0) {
    current = state.current + 1;
    outcome = 'extended';
  } else if (missedDays <= freezesBanked) {
    freezesSpent = missedDays;
    freezesBanked -= missedDays;
    current = state.current + 1;
    outcome = 'saved-by-freeze';
  } else {
    current = 1;
    outcome = 'broken';
  }

  // Earn a freeze for each completed week of unbroken practice.
  const crossedWeek =
    current > 0 && current % DAYS_PER_EARNED_FREEZE === 0 && outcome !== 'broken';
  const freezeEarned = crossedWeek && freezesBanked < MAX_BANKED_FREEZES;
  if (freezeEarned) freezesBanked += 1;

  return {
    state: {
      current,
      longest: Math.max(state.longest, current),
      lastQualifiedDay: today,
      freezesBanked,
      freezesUsedTotal: state.freezesUsedTotal + freezesSpent,
      totalQualifiedDays: state.totalQualifiedDays + 1,
    },
    outcome,
    freezesSpent,
    freezeEarned,
  };
}

/**
 * Whether the streak is still alive as of `today`, without recording anything.
 * Used to render the counter honestly on a day you have not practised yet.
 */
export function streakIsAlive(state: StreakState, today: string = localDay()): boolean {
  if (!state.lastQualifiedDay) return false;
  const gap = dayDifference(state.lastQualifiedDay, today);
  if (gap <= 0) return true;
  return gap - 1 <= state.freezesBanked;
}

/** True once today's practice has already been counted. */
export function practicedToday(state: StreakState, today: string = localDay()): boolean {
  return state.lastQualifiedDay === today;
}
