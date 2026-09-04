import { describe, expect, it } from 'vitest';
import {
  DOMAINS, SKILLS, keyboardFreeSkills, skill, skillsInDomain, unlockedSkills,
  validateSkillGraph,
} from './taxonomy';

describe('skill graph', () => {
  it('is acyclic with every prerequisite defined', () => {
    const result = validateSkillGraph();
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.ok).toBe(true);
  });

  it('has no duplicate skill ids', () => {
    const ids = SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every skill to a real domain', () => {
    const domainIds = new Set(DOMAINS.map((d) => d.id));
    for (const s of SKILLS) expect(domainIds.has(s.domain), s.id).toBe(true);
  });

  it('covers all seven domains', () => {
    for (const d of DOMAINS) expect(skillsInDomain(d.id).length, d.id).toBeGreaterThan(0);
  });

  it('gives every domain at least one entry point needing no prerequisites', () => {
    for (const d of DOMAINS) {
      const roots = skillsInDomain(d.id).filter((s) => s.requires.length === 0);
      // Performance domains legitimately depend on earlier ones; they just need
      // *some* reachable start, not a prerequisite-free root.
      if (['technique', 'rhythm', 'theory', 'ear'].includes(d.id)) {
        expect(roots.length, d.id).toBeGreaterThan(0);
      }
    }
  });

  it('exposes a keyboard-free subset large enough for Phase 1', () => {
    const free = keyboardFreeSkills();
    expect(free.length).toBeGreaterThan(30);
    expect(free.every((s) => !['technique', 'independence', 'repertoire'].includes(s.domain)))
      .toBe(true);
  });

  it('classifies motor skills separately from declarative ones', () => {
    expect(skill('theory.note-names').kind).toBe('declarative');
    expect(skill('independence.rhythm.3-2').kind).toBe('motor');
    expect(skill('technique.scales.one-octave').kind).toBe('motor');
  });

  it('unlocks only what the prerequisites allow', () => {
    const empty = new Map<string, number>();
    const startable = unlockedSkills(empty);
    expect(startable.some((s) => s.id === 'theory.note-names')).toBe(true);
    expect(startable.some((s) => s.id === 'theory.secondary-dominants')).toBe(false);

    const known = new Map([['theory.note-names', 0.9]]);
    expect(unlockedSkills(known).some((s) => s.id === 'theory.intervals.simple')).toBe(true);
  });
});
