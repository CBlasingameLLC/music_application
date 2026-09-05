/**
 * Bundled repertoire.
 *
 * Two categories, and the distinction is legal as well as musical:
 *
 *  - **Public-domain compositions**, engraved here from scratch. The
 *    composition is out of copyright and the engraving is original work, so
 *    these can ship publicly without a licensing question.
 *  - **Original studies**, written for this app and released CC0. They exist
 *    because graded material aimed at a specific skill is hard to find and
 *    trivial to write, and because a study designed around one difficulty
 *    teaches faster than a piece that happens to contain it.
 *
 * Deliberately *not* transcriptions sourced from elsewhere: Mutopia has no
 * MusicXML, and CC-BY-SA typesets would attach share-alike terms to anything
 * derived from them.
 */

import {
  type Key, type RepertoireEntry, allKeys, keyId, type Provenance,
} from '@etude/core';
import { buildPiece, type PieceSpec } from './builder';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`unknown key ${id}`);
  return k;
};

const PUBLIC_DOMAIN: Provenance = {
  source: 'bundled',
  license: 'PD-composition; engraving CC0-1.0',
  attribution: null,
  isPrivate: false,
};

const ORIGINAL: Provenance = {
  source: 'bundled',
  license: 'CC0-1.0',
  attribution: null,
  isPrivate: false,
};

/**
 * Beethoven's Ninth Symphony theme, in C for five-finger position.
 *
 * The first real piece worth putting in front of an advanced beginner:
 * entirely stepwise apart from one third, it stays under a single hand
 * position, and it is recognisable enough that a wrong note is audible without
 * being told. Recognition matters — you cannot hear your own mistakes in music
 * you have never heard.
 */
const odeToJoy: PieceSpec = {
  id: 'ode-to-joy',
  level: 1,
  title: 'Ode to Joy',
  composer: 'Ludwig van Beethoven',
  key: K('C-major'),
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 84,
  provenance: PUBLIC_DOMAIN,
  teaches: 'Five-finger position, stepwise reading, a dotted rhythm at the end of each phrase.',
  rightHand: [
    { pitch: 'E4', beats: 1, fingering: 3 }, { pitch: 'E4', beats: 1 },
    { pitch: 'F4', beats: 1, fingering: 4 }, { pitch: 'G4', beats: 1, fingering: 5 },
    { pitch: 'G4', beats: 1 }, { pitch: 'F4', beats: 1 },
    { pitch: 'E4', beats: 1 }, { pitch: 'D4', beats: 1, fingering: 2 },
    { pitch: 'C4', beats: 1, fingering: 1 }, { pitch: 'C4', beats: 1 },
    { pitch: 'D4', beats: 1 }, { pitch: 'E4', beats: 1 },
    { pitch: 'E4', beats: 1.5 }, { pitch: 'D4', beats: 0.5 }, { pitch: 'D4', beats: 2 },

    { pitch: 'E4', beats: 1 }, { pitch: 'E4', beats: 1 },
    { pitch: 'F4', beats: 1 }, { pitch: 'G4', beats: 1 },
    { pitch: 'G4', beats: 1 }, { pitch: 'F4', beats: 1 },
    { pitch: 'E4', beats: 1 }, { pitch: 'D4', beats: 1 },
    { pitch: 'C4', beats: 1 }, { pitch: 'C4', beats: 1 },
    { pitch: 'D4', beats: 1 }, { pitch: 'E4', beats: 1 },
    { pitch: 'D4', beats: 1.5 }, { pitch: 'C4', beats: 0.5 }, { pitch: 'C4', beats: 2 },
  ],
  leftHand: [
    { pitch: 'C3', beats: 4, staff: 2 }, { pitch: 'C3', beats: 4, staff: 2 },
    { pitch: 'G2', beats: 4, staff: 2 }, { pitch: 'C3', beats: 4, staff: 2 },
    { pitch: 'C3', beats: 4, staff: 2 }, { pitch: 'C3', beats: 4, staff: 2 },
    { pitch: 'G2', beats: 4, staff: 2 }, { pitch: 'C3', beats: 4, staff: 2 },
  ],
};

/**
 * Contrary motion, written for this app.
 *
 * Hands move in mirror image, each thumb on a C an octave apart. This is the
 * gentlest real entry into hand independence: both hands play the same rhythm
 * and the same finger numbers at the same time, so the only new demand is that
 * they move in opposite directions. It is the step most method books skip.
 *
 * The octave gap is not decoration. This originally mirrored from a *shared*
 * middle C, which reads well on paper and cannot be played: two hands cannot
 * strike one key. A keyboard would send a single note-on where the score
 * expects two, so a perfect performance would have been marked down for a
 * missing note on the first beat, every take, forever.
 */
const contraryMotion: PieceSpec = {
  id: 'contrary-motion-study',
  level: 2,
  title: 'Contrary Motion Study',
  composer: null,
  key: K('C-major'),
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 72,
  provenance: ORIGINAL,
  teaches: 'Mirror-image movement, each thumb on a C an octave apart. Same rhythm, same fingers, opposite directions.',
  rightHand: [
    { pitch: 'C4', beats: 1, fingering: 1 }, { pitch: 'D4', beats: 1, fingering: 2 },
    { pitch: 'E4', beats: 1, fingering: 3 }, { pitch: 'F4', beats: 1, fingering: 4 },
    { pitch: 'G4', beats: 2, fingering: 5 }, { pitch: 'F4', beats: 1, fingering: 4 },
    { pitch: 'E4', beats: 1, fingering: 3 },
    { pitch: 'D4', beats: 1, fingering: 2 }, { pitch: 'E4', beats: 1, fingering: 3 },
    { pitch: 'F4', beats: 1, fingering: 4 }, { pitch: 'D4', beats: 1, fingering: 2 },
    { pitch: 'C4', beats: 4, fingering: 1 },
  ],
  leftHand: [
    { pitch: 'C3', beats: 1, staff: 2, fingering: 1 }, { pitch: 'B2', beats: 1, staff: 2, fingering: 2 },
    { pitch: 'A2', beats: 1, staff: 2, fingering: 3 }, { pitch: 'G2', beats: 1, staff: 2, fingering: 4 },
    { pitch: 'F2', beats: 2, staff: 2, fingering: 5 }, { pitch: 'G2', beats: 1, staff: 2, fingering: 4 },
    { pitch: 'A2', beats: 1, staff: 2, fingering: 3 },
    { pitch: 'B2', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A2', beats: 1, staff: 2, fingering: 3 },
    { pitch: 'G2', beats: 1, staff: 2, fingering: 4 }, { pitch: 'B2', beats: 1, staff: 2, fingering: 2 },
    { pitch: 'C3', beats: 4, staff: 2, fingering: 1 },
  ],
};

/**
 * A study in independent rhythm, written for this app.
 *
 * The left hand holds while the right hand moves — two against one, the first
 * genuine independence problem. Written in G so the reader also has to hold
 * one sharp in mind, which is where key signatures stop being decoration.
 */
const twoAgainstOne: PieceSpec = {
  id: 'two-against-one',
  level: 3,
  title: 'Two Against One',
  composer: null,
  key: K('G-major'),
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 66,
  provenance: ORIGINAL,
  teaches: 'The left hand holds while the right hand moves. One sharp to keep in mind throughout.',
  rightHand: [
    { pitch: 'G4', beats: 0.5 }, { pitch: 'A4', beats: 0.5 },
    { pitch: 'B4', beats: 0.5 }, { pitch: 'A4', beats: 0.5 },
    { pitch: 'G4', beats: 0.5 }, { pitch: 'A4', beats: 0.5 },
    { pitch: 'B4', beats: 0.5 }, { pitch: 'C5', beats: 0.5 },
    { pitch: 'D5', beats: 0.5 }, { pitch: 'C5', beats: 0.5 },
    { pitch: 'B4', beats: 0.5 }, { pitch: 'A4', beats: 0.5 },
    { pitch: 'B4', beats: 0.5 }, { pitch: 'G4', beats: 0.5 },
    { pitch: 'A4', beats: 0.5 }, { pitch: 'F#4', beats: 0.5 },
    { pitch: 'G4', beats: 4 },
  ],
  leftHand: [
    { pitch: 'G3', beats: 2, staff: 2 }, { pitch: 'D3', beats: 2, staff: 2 },
    { pitch: 'G3', beats: 2, staff: 2 }, { pitch: 'C3', beats: 2, staff: 2 },
    { pitch: 'D3', beats: 4, staff: 2 },
    { pitch: 'G3', beats: 4, staff: 2 },
  ],
};

/**
 * A waltz in A minor, written for this app.
 *
 * Two things arrive here that no piece before it asks for. The first is triple
 * metre: a bar of three does not divide evenly the way four does, and counting
 * it is a different skill rather than a smaller one. The second is a real
 * accompaniment — the left hand plays three notes to the right hand's one, so
 * the hands are genuinely doing different things rather than the same thing in
 * different registers.
 *
 * Natural minor throughout, with no raised seventh. That is deliberate: the
 * leading tone is worth meeting on its own later, and mixing it in here would
 * make the piece about accidentals instead of about metre.
 */
const waltzInAMinor: PieceSpec = {
  id: 'waltz-in-a-minor',
  level: 3,
  title: 'Waltz in A Minor',
  composer: null,
  key: K('A-minor'),
  timeSignature: { beats: 3, beatType: 4 },
  tempo: 96,
  provenance: ORIGINAL,
  teaches: 'Triple metre, and a left-hand waltz figure moving three times for every note the right hand holds.',
  rightHand: [
    { pitch: 'A4', beats: 2, fingering: 1 }, { pitch: 'C5', beats: 1, fingering: 3 },
    { pitch: 'B4', beats: 2, fingering: 2 }, { pitch: 'D5', beats: 1, fingering: 4 },
    { pitch: 'C5', beats: 1, fingering: 3 }, { pitch: 'B4', beats: 1, fingering: 2 },
    { pitch: 'A4', beats: 1, fingering: 1 },
    { pitch: 'B4', beats: 3, fingering: 2 },

    { pitch: 'E5', beats: 2, fingering: 5 }, { pitch: 'D5', beats: 1, fingering: 4 },
    { pitch: 'C5', beats: 2, fingering: 3 }, { pitch: 'B4', beats: 1, fingering: 2 },
    { pitch: 'A4', beats: 1, fingering: 1 }, { pitch: 'B4', beats: 1, fingering: 2 },
    { pitch: 'C5', beats: 1, fingering: 3 },
    { pitch: 'A4', beats: 3, fingering: 1 },
  ],
  leftHand: [
    { pitch: 'A2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'E3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'G2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'D3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'G3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'A2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'E3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'E2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'B2', beats: 1, staff: 2, fingering: 2 }, { pitch: 'E3', beats: 1, staff: 2, fingering: 1 },

    { pitch: 'A2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'E3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'G2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'D3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'G3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'A2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'E3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'A2', beats: 1, staff: 2, fingering: 5 }, { pitch: 'E3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A3', beats: 1, staff: 2, fingering: 1 },
  ],
};

/**
 * Thumb Under, written for this app.
 *
 * The one exercise aimed squarely at a metric the grader already computes.
 * Scale unevenness is systematic rather than random — it happens at the
 * crossing — so residuals keyed by fingering can say "your 3 to 1 is
 * consistently forty milliseconds late", which names something to fix. "Your
 * scale is uneven" names nothing.
 *
 * Every finger number is printed, because the diagnostic is only as good as
 * the fingering it is keyed to: play it with different fingers and the number
 * measures a different event. The left hand deliberately holds, so the whole
 * difficulty is in the right hand's crossings.
 */
const thumbUnder: PieceSpec = {
  id: 'thumb-under',
  level: 4,
  title: 'Thumb Under',
  composer: null,
  key: K('C-major'),
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 72,
  provenance: ORIGINAL,
  teaches: 'The 3-to-1 thumb crossing, up and down an octave, with every finger number printed.',
  rightHand: [
    { pitch: 'C4', beats: 1, fingering: 1 }, { pitch: 'D4', beats: 1, fingering: 2 },
    { pitch: 'E4', beats: 1, fingering: 3 }, { pitch: 'F4', beats: 1, fingering: 1 },
    { pitch: 'G4', beats: 1, fingering: 2 }, { pitch: 'A4', beats: 1, fingering: 3 },
    { pitch: 'B4', beats: 1, fingering: 4 }, { pitch: 'C5', beats: 1, fingering: 5 },
    { pitch: 'B4', beats: 1, fingering: 4 }, { pitch: 'A4', beats: 1, fingering: 3 },
    { pitch: 'G4', beats: 1, fingering: 2 }, { pitch: 'F4', beats: 1, fingering: 1 },
    { pitch: 'E4', beats: 1, fingering: 3 }, { pitch: 'D4', beats: 1, fingering: 2 },
    { pitch: 'C4', beats: 2, fingering: 1 },

    { pitch: 'C4', beats: 1, fingering: 1 }, { pitch: 'E4', beats: 1, fingering: 3 },
    { pitch: 'D4', beats: 1, fingering: 2 }, { pitch: 'F4', beats: 1, fingering: 1 },
    { pitch: 'E4', beats: 1, fingering: 2 }, { pitch: 'G4', beats: 1, fingering: 4 },
    { pitch: 'F4', beats: 1, fingering: 3 }, { pitch: 'A4', beats: 1, fingering: 5 },
    { pitch: 'G4', beats: 1, fingering: 2 }, { pitch: 'B4', beats: 1, fingering: 4 },
    { pitch: 'A4', beats: 1, fingering: 3 }, { pitch: 'C5', beats: 1, fingering: 5 },
    { pitch: 'B4', beats: 1, fingering: 4 }, { pitch: 'D5', beats: 1, fingering: 5 },
    { pitch: 'C5', beats: 2, fingering: 5 },
  ],
  leftHand: [
    { pitch: 'C3', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'G2', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'G2', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'C3', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'C3', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'F2', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'G2', beats: 4, staff: 2, fingering: 5 },
    { pitch: 'C3', beats: 4, staff: 2, fingering: 5 },
  ],
};

/**
 * Minuet in G, BWV Anh. 114 — the opening eight bars.
 *
 * Long attributed to Bach and now credited to Christian Petzold, this is the
 * piece almost every pianist learns first, and the one the roadmap named as the
 * target: read it from engraved notation, cursor following, and get a scored
 * diagnostic back.
 *
 * The composition is public domain. **This engraving is original work**, and
 * the left hand is a simplified harmonic outline rather than Petzold's own —
 * which is what a method-book arrangement does, and what makes an eight-bar
 * excerpt playable at this level. It is written down here so nobody later
 * mistakes it for the urtext.
 */
const minuetInG: PieceSpec = {
  id: 'minuet-in-g',
  level: 5,
  title: 'Minuet in G (opening)',
  composer: 'Christian Petzold',
  key: K('G-major'),
  timeSignature: { beats: 3, beatType: 4 },
  tempo: 108,
  provenance: PUBLIC_DOMAIN,
  teaches: 'Real repertoire: triple metre, running eighths against a held bass, and one sharp throughout.',
  rightHand: [
    { pitch: 'D5', beats: 1, fingering: 5 },
    { pitch: 'G4', beats: 0.5, fingering: 1 }, { pitch: 'A4', beats: 0.5, fingering: 2 },
    { pitch: 'B4', beats: 0.5, fingering: 3 }, { pitch: 'C5', beats: 0.5, fingering: 4 },

    { pitch: 'D5', beats: 1, fingering: 5 }, { pitch: 'G4', beats: 1, fingering: 1 },
    { pitch: 'G4', beats: 1, fingering: 1 },

    { pitch: 'E5', beats: 1, fingering: 5 },
    { pitch: 'C5', beats: 0.5, fingering: 1 }, { pitch: 'D5', beats: 0.5, fingering: 2 },
    { pitch: 'E5', beats: 0.5, fingering: 3 }, { pitch: 'F#5', beats: 0.5, fingering: 4 },

    { pitch: 'G5', beats: 1, fingering: 5 }, { pitch: 'G4', beats: 1, fingering: 1 },
    { pitch: 'G4', beats: 1, fingering: 1 },

    { pitch: 'C5', beats: 1, fingering: 1 },
    { pitch: 'D5', beats: 0.5, fingering: 2 }, { pitch: 'C5', beats: 0.5, fingering: 1 },
    { pitch: 'B4', beats: 0.5, fingering: 3 }, { pitch: 'A4', beats: 0.5, fingering: 2 },

    { pitch: 'B4', beats: 1, fingering: 3 },
    { pitch: 'C5', beats: 0.5, fingering: 4 }, { pitch: 'B4', beats: 0.5, fingering: 3 },
    { pitch: 'A4', beats: 0.5, fingering: 2 }, { pitch: 'G4', beats: 0.5, fingering: 1 },

    { pitch: 'F#4', beats: 1, fingering: 1 }, { pitch: 'G4', beats: 1, fingering: 2 },
    { pitch: 'A4', beats: 1, fingering: 3 },

    { pitch: 'G4', beats: 3, fingering: 1 },
  ],
  leftHand: [
    { pitch: 'G2', beats: 3, staff: 2, fingering: 5 },
    { pitch: 'B2', beats: 1, staff: 2, fingering: 3 }, { pitch: 'D3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'G3', beats: 1, staff: 2, fingering: 1 },
    { pitch: 'C3', beats: 3, staff: 2, fingering: 4 },
    { pitch: 'B2', beats: 3, staff: 2, fingering: 5 },
    { pitch: 'A2', beats: 3, staff: 2, fingering: 5 },
    { pitch: 'G2', beats: 3, staff: 2, fingering: 5 },
    { pitch: 'D3', beats: 3, staff: 2, fingering: 2 },
    { pitch: 'G2', beats: 3, staff: 2, fingering: 5 },
  ],
};

export const BUNDLED_PIECES: readonly PieceSpec[] = [
  odeToJoy,
  contraryMotion,
  waltzInAMinor,
  twoAgainstOne,
  thumbUnder,
  minuetInG,
];

export function bundledScores() {
  return BUNDLED_PIECES.map((spec) => ({
    spec,
    score: buildPiece(spec),
  }));
}

export function bundledScore(id: string) {
  const spec = BUNDLED_PIECES.find((p) => p.id === id);
  return spec ? buildPiece(spec) : null;
}

/**
 * The bundled library, in the shape the Repertoire mode reads.
 *
 * Core cannot import this package — content depends on core, not the other way
 * round — so the app hands the catalogue over at startup. Anything the user
 * imported is appended to it there, which is what lets a private arrangement be
 * practised through exactly the same mode without ever entering the build.
 */
export function bundledRepertoire(): RepertoireEntry[] {
  return BUNDLED_PIECES.map((spec) => ({
    id: spec.id,
    title: spec.title,
    composer: spec.composer,
    level: spec.level,
    teaches: spec.teaches,
    tempo: spec.tempo,
    score: buildPiece(spec),
  }));
}
