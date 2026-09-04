/**
 * The skill graph.
 *
 * Seven domains tracked independently, so the map can show "strong reader, weak
 * independence" rather than collapsing everything into one meaningless level.
 * Domains 1-4 are instrument-agnostic and carry over to guitar untouched;
 * 5-7 are piano-specific. That split is what makes the guitar expansion cheap.
 *
 * The SRS unit is the *skill*, never the activity. You never schedule
 * "Burgmüller No. 2"; you schedule skills, and the session builder picks
 * activities that cover whatever is due.
 */

export type DomainId =
  | 'reading' | 'rhythm' | 'ear' | 'theory'
  | 'technique' | 'independence' | 'repertoire';

export interface Domain {
  readonly id: DomainId;
  readonly name: string;
  readonly blurb: string;
  /** Instrument-agnostic domains transfer to a new instrument with no porting. */
  readonly agnostic: boolean;
  /** Accent hue (OKLCH degrees) so each domain reads distinctly on the map. */
  readonly hue: number;
}

export const DOMAINS: readonly Domain[] = [
  { id: 'reading', name: 'Reading', blurb: 'Interval-based notation fluency', agnostic: true, hue: 250 },
  { id: 'rhythm', name: 'Rhythm', blurb: 'Subdivision, steadiness, counting', agnostic: true, hue: 30 },
  { id: 'ear', name: 'Ear', blurb: 'Functional pitch and harmony recognition', agnostic: true, hue: 155 },
  { id: 'theory', name: 'Theory', blurb: 'Knowledge, applied at the keyboard', agnostic: true, hue: 300 },
  { id: 'technique', name: 'Technique', blurb: 'Evenness, control, dynamics', agnostic: false, hue: 200 },
  { id: 'independence', name: 'Independence', blurb: 'Hands together, and apart', agnostic: false, hue: 15 },
  { id: 'repertoire', name: 'Repertoire', blurb: 'Actual pieces, played whole', agnostic: false, hue: 85 },
];

export function domain(id: DomainId): Domain {
  const d = DOMAINS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown domain ${id}`);
  return d;
}

/**
 * How a skill decays. Declarative knowledge fades on a classic forgetting
 * curve; motor skills decay far more slowly and consolidate with sleep rather
 * than review. Scheduling them identically is the mistake — hence two tracks.
 */
export type SkillKind = 'declarative' | 'motor';

export interface Skill {
  readonly id: string;
  readonly domain: DomainId;
  readonly name: string;
  readonly kind: SkillKind;
  /** Skill ids that must reach working mastery before this unlocks. */
  readonly requires: readonly string[];
  /** Rough tier for map layout and ordering, 0-based. */
  readonly tier: number;
}

function s(
  id: string,
  domainId: DomainId,
  name: string,
  tier: number,
  requires: string[] = [],
  kind: SkillKind = 'declarative',
): Skill {
  return { id, domain: domainId, name, kind, requires, tier };
}

export const SKILLS: readonly Skill[] = [
  // --- Theory: knowledge, but always applied rather than quizzed -------------
  s('theory.note-names', 'theory', 'Note names', 0),
  s('theory.intervals.simple', 'theory', 'Intervals: 2nd-5th', 1, ['theory.note-names']),
  s('theory.intervals.all', 'theory', 'Intervals: all simple', 2, ['theory.intervals.simple']),
  s('theory.key-signatures.sharps', 'theory', 'Sharp key signatures', 1, ['theory.note-names']),
  s('theory.key-signatures.flats', 'theory', 'Flat key signatures', 2, ['theory.key-signatures.sharps']),
  s('theory.scales.major', 'theory', 'Major scales', 2, ['theory.intervals.simple']),
  s('theory.scales.minor', 'theory', 'Minor scales', 3, ['theory.scales.major']),
  s('theory.scales.modes', 'theory', 'Modes', 5, ['theory.scales.minor']),
  s('theory.triads.major-minor', 'theory', 'Major and minor triads', 2, ['theory.intervals.simple']),
  s('theory.triads.dim-aug', 'theory', 'Diminished and augmented', 3, ['theory.triads.major-minor']),
  s('theory.triads.inversions', 'theory', 'Triad inversions', 3, ['theory.triads.major-minor']),
  s('theory.sevenths.dominant', 'theory', 'Dominant sevenths', 4, ['theory.triads.dim-aug']),
  s('theory.sevenths.all', 'theory', 'All seventh chords', 5, ['theory.sevenths.dominant']),
  s('theory.diatonic.major', 'theory', 'Diatonic harmony: major', 4, ['theory.triads.major-minor', 'theory.scales.major']),
  s('theory.diatonic.minor', 'theory', 'Diatonic harmony: minor', 5, ['theory.diatonic.major', 'theory.scales.minor']),
  s('theory.roman-numerals', 'theory', 'Roman numerals', 5, ['theory.diatonic.major']),
  s('theory.cadences', 'theory', 'Cadences', 6, ['theory.roman-numerals']),
  s('theory.secondary-dominants', 'theory', 'Secondary dominants', 7, ['theory.cadences', 'theory.sevenths.dominant']),
  s('theory.voice-leading', 'theory', 'Voice leading', 7, ['theory.triads.inversions', 'theory.roman-numerals']),

  // --- Ear: functional, always in a key context ------------------------------
  s('ear.degrees.tonic-triad', 'ear', 'Degrees 1, 3, 5', 0),
  s('ear.degrees.pentatonic', 'ear', 'Degrees 1 2 3 5 6', 1, ['ear.degrees.tonic-triad']),
  s('ear.degrees.diatonic', 'ear', 'All seven degrees', 2, ['ear.degrees.pentatonic']),
  s('ear.degrees.chromatic', 'ear', 'Chromatic degrees', 5, ['ear.degrees.diatonic']),
  s('ear.intervals.ascending', 'ear', 'Ascending intervals', 2, ['ear.degrees.pentatonic']),
  s('ear.intervals.descending', 'ear', 'Descending intervals', 3, ['ear.intervals.ascending']),
  s('ear.intervals.harmonic', 'ear', 'Harmonic intervals', 4, ['ear.intervals.descending']),
  s('ear.quality.major-minor', 'ear', 'Major vs minor', 1, ['ear.degrees.tonic-triad']),
  s('ear.quality.triads', 'ear', 'All triad qualities', 3, ['ear.quality.major-minor']),
  s('ear.quality.sevenths', 'ear', 'Seventh qualities', 5, ['ear.quality.triads']),
  s('ear.progressions.primary', 'ear', 'I, IV, V by ear', 3, ['ear.quality.major-minor']),
  s('ear.progressions.diatonic', 'ear', 'All diatonic chords', 5, ['ear.progressions.primary', 'theory.roman-numerals']),
  s('ear.progressions.secondary', 'ear', 'Secondary dominants by ear', 7, ['ear.progressions.diatonic', 'theory.secondary-dominants']),

  // --- Rhythm: drilled without pitch, so the metric stays clean ---------------
  s('rhythm.quarter', 'rhythm', 'Quarter notes', 0, [], 'motor'),
  s('rhythm.eighth', 'rhythm', 'Eighth notes', 1, ['rhythm.quarter'], 'motor'),
  s('rhythm.rests', 'rhythm', 'Rests observed', 1, ['rhythm.quarter'], 'motor'),
  s('rhythm.sixteenth', 'rhythm', 'Sixteenth notes', 3, ['rhythm.eighth'], 'motor'),
  s('rhythm.dotted', 'rhythm', 'Dotted rhythms', 3, ['rhythm.eighth'], 'motor'),
  s('rhythm.triplet', 'rhythm', 'Triplets', 4, ['rhythm.eighth'], 'motor'),
  s('rhythm.syncopation', 'rhythm', 'Syncopation', 5, ['rhythm.sixteenth', 'rhythm.dotted'], 'motor'),
  s('rhythm.compound', 'rhythm', 'Compound metre', 5, ['rhythm.triplet'], 'motor'),
  s('rhythm.polyrhythm.2-3', 'rhythm', 'Two against three', 7, ['rhythm.triplet', 'rhythm.syncopation'], 'motor'),

  // --- Reading: intervals first, letter-naming never ------------------------
  s('reading.landmarks', 'reading', 'Landmark notes', 0, ['theory.note-names']),
  s('reading.treble.steps', 'reading', 'Treble staff', 1, ['reading.landmarks']),
  s('reading.bass.steps', 'reading', 'Bass staff', 1, ['reading.landmarks']),
  s('reading.intervals', 'reading', 'Reading by interval', 2, ['reading.treble.steps', 'reading.bass.steps', 'theory.intervals.simple']),
  s('reading.grand-staff', 'reading', 'Both staves at once', 3, ['reading.intervals']),
  s('reading.ledger-lines', 'reading', 'Ledger lines', 4, ['reading.grand-staff']),
  s('reading.accidentals', 'reading', 'Accidentals in context', 4, ['reading.grand-staff', 'theory.key-signatures.sharps']),
  s('reading.sight-reading', 'reading', 'Sight-reading', 6, ['reading.ledger-lines', 'reading.accidentals', 'rhythm.eighth'], 'motor'),

  // --- Technique (Phase 2+, MIDI required) -----------------------------------
  s('technique.five-finger', 'technique', 'Five-finger patterns', 0, [], 'motor'),
  s('technique.scales.one-octave', 'technique', 'One-octave scales', 2, ['technique.five-finger', 'theory.scales.major'], 'motor'),
  s('technique.thumb-under', 'technique', 'Thumb crossings', 3, ['technique.scales.one-octave'], 'motor'),
  s('technique.scales.two-octave', 'technique', 'Two-octave scales', 4, ['technique.thumb-under'], 'motor'),
  s('technique.arpeggios', 'technique', 'Arpeggios', 4, ['technique.scales.one-octave', 'theory.triads.inversions'], 'motor'),
  s('technique.evenness', 'technique', 'Evenness under tempo', 5, ['technique.scales.two-octave'], 'motor'),
  s('technique.dynamics', 'technique', 'Dynamic control', 5, ['technique.five-finger'], 'motor'),
  s('technique.pedal', 'technique', 'Legato pedalling', 6, ['technique.dynamics'], 'motor'),

  // --- Independence: the stated #1 goal, trained directly --------------------
  s('independence.hands-separate', 'independence', 'Each hand alone', 0, ['technique.five-finger'], 'motor'),
  s('independence.parallel', 'independence', 'Hands in parallel', 1, ['independence.hands-separate'], 'motor'),
  s('independence.contrary', 'independence', 'Contrary motion', 2, ['independence.parallel'], 'motor'),
  s('independence.rhythm.2-1', 'independence', 'Two against one', 3, ['independence.parallel', 'rhythm.eighth'], 'motor'),
  s('independence.rhythm.3-1', 'independence', 'Three against one', 4, ['independence.rhythm.2-1', 'rhythm.triplet'], 'motor'),
  s('independence.rhythm.3-2', 'independence', 'Three against two', 6, ['independence.rhythm.3-1'], 'motor'),
  s('independence.articulation', 'independence', 'Different articulation per hand', 5, ['independence.rhythm.2-1'], 'motor'),
  s('independence.dynamics', 'independence', 'Different dynamics per hand', 6, ['independence.articulation', 'technique.dynamics'], 'motor'),
  s('independence.ostinato', 'independence', 'Ostinato under a melody', 7, ['independence.dynamics'], 'motor'),

  // --- Repertoire ------------------------------------------------------------
  s('repertoire.first-pieces', 'repertoire', 'First pieces', 4, ['independence.parallel', 'reading.grand-staff'], 'motor'),
  s('repertoire.two-voice', 'repertoire', 'Two-voice counterpoint', 7, ['independence.rhythm.2-1', 'reading.sight-reading'], 'motor'),
  s('repertoire.performance', 'repertoire', 'Playing a piece whole', 8, ['repertoire.two-voice'], 'motor'),
];

const SKILL_INDEX = new Map(SKILLS.map((sk) => [sk.id, sk]));

export function skill(id: string): Skill {
  const sk = SKILL_INDEX.get(id);
  if (!sk) throw new Error(`unknown skill ${id}`);
  return sk;
}

export function skillsInDomain(domainId: DomainId): Skill[] {
  return SKILLS.filter((sk) => sk.domain === domainId);
}

/** Skills reachable without any MIDI hardware — everything Phase 1 can drill. */
export function keyboardFreeSkills(): Skill[] {
  return SKILLS.filter(
    (sk) => sk.domain === 'theory' || sk.domain === 'ear' ||
      sk.domain === 'rhythm' || sk.domain === 'reading',
  );
}

/**
 * Validate the graph: every prerequisite must exist, and there must be no
 * cycles. Run as a test, because a typo here would silently strand a skill
 * behind a prerequisite that can never be satisfied.
 */
export function validateSkillGraph(): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  for (const sk of SKILLS) {
    for (const req of sk.requires) {
      if (!SKILL_INDEX.has(req)) errors.push(`${sk.id} requires unknown skill ${req}`);
    }
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const walk = (id: string, path: string[]): void => {
    const st = state.get(id);
    if (st === 'done') return;
    if (st === 'visiting') {
      errors.push(`cycle: ${[...path, id].join(' -> ')}`);
      return;
    }
    state.set(id, 'visiting');
    const sk = SKILL_INDEX.get(id);
    if (sk) for (const req of sk.requires) walk(req, [...path, id]);
    state.set(id, 'done');
  };
  for (const sk of SKILLS) walk(sk.id, []);

  // A prerequisite should never sit at a higher tier than its dependent; that
  // would render the map with edges pointing backwards.
  for (const sk of SKILLS) {
    for (const req of sk.requires) {
      const r = SKILL_INDEX.get(req);
      if (r && r.tier > sk.tier) {
        errors.push(`${sk.id} (tier ${sk.tier}) requires ${req} at higher tier ${r.tier}`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Skills whose prerequisites are all at or above `threshold` mastery. */
export function unlockedSkills(
  mastery: ReadonlyMap<string, number>,
  threshold = 0.5,
): Skill[] {
  return SKILLS.filter((sk) =>
    sk.requires.every((req) => (mastery.get(req) ?? 0) >= threshold),
  );
}
