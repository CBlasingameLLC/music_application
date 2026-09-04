/** Étude core: pure domain logic. No DOM, no React, no framework. */

export * from './theory/pitch';
export * from './theory/interval';
export * from './theory/scale';
export * from './theory/chord';
export * from './theory/harmony';
export * from './theory/detect';

export * from './score/model';
export * from './score/timeline';
export * from './score/musicxml/parse';
export * from './score/musicxml/serialize';
export * from './score/generate/sightReading';
export * from './score/generate/independence';

export * from './grading/take';
export * from './grading/align';
export * from './grading/tempoMap';
export * from './grading/metrics';
export * from './grading/grade';
export * from './grading/synthesize';
export * from './grading/independence';

export * from './input/types';

export * from './events/types';

export * from './skills/taxonomy';

export * from './progression/mastery';
export * from './progression/streak';
export * from './progression/xp';
export * from './progression/ladder';
export * from './progression/scheduler';
export * from './progression/session';

export * from './generators/rng';
export * from './generators/questions';
export * from './generators/modes';

export * from './instrument/types';
export * from './instrument/piano';
