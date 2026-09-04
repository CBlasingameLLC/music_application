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

import { type Key, allKeys, keyId, type Provenance } from '@etude/core';
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
 * Hands move in mirror image from a shared middle C. This is the gentlest real
 * entry into hand independence: both hands play the same rhythm and the same
 * finger numbers at the same time, so the only new demand is that they move in
 * opposite directions. It is the step most method books skip.
 */
const contraryMotion: PieceSpec = {
  id: 'contrary-motion-study',
  title: 'Contrary Motion Study',
  composer: null,
  key: K('C-major'),
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 72,
  provenance: ORIGINAL,
  teaches: 'Mirror-image movement from a shared middle C. Same rhythm, same fingers, opposite directions.',
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
    { pitch: 'C4', beats: 1, staff: 2, fingering: 1 }, { pitch: 'B3', beats: 1, staff: 2, fingering: 2 },
    { pitch: 'A3', beats: 1, staff: 2, fingering: 3 }, { pitch: 'G3', beats: 1, staff: 2, fingering: 4 },
    { pitch: 'F3', beats: 2, staff: 2, fingering: 5 }, { pitch: 'G3', beats: 1, staff: 2, fingering: 4 },
    { pitch: 'A3', beats: 1, staff: 2, fingering: 3 },
    { pitch: 'B3', beats: 1, staff: 2, fingering: 2 }, { pitch: 'A3', beats: 1, staff: 2, fingering: 3 },
    { pitch: 'G3', beats: 1, staff: 2, fingering: 4 }, { pitch: 'B3', beats: 1, staff: 2, fingering: 2 },
    { pitch: 'C4', beats: 4, staff: 2, fingering: 1 },
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

export const BUNDLED_PIECES: readonly PieceSpec[] = [
  odeToJoy,
  contraryMotion,
  twoAgainstOne,
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
