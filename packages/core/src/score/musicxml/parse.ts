/**
 * MusicXML → `Score`.
 *
 * Handles the subset that matters for practice: divisions, key and time,
 * pitched notes and rests, chords, ties, staves, voices, fingering, slurs,
 * articulations and arpeggios. Deliberately not a complete implementation.
 *
 * Parsed with `preserveOrder`, which is not optional here. A measure is a
 * *stream of events over a cursor*, not a set of positioned notes: `<note>`
 * advances the cursor, `<chord/>` means "same onset as the previous note",
 * `<backup>` rewinds it so the other staff can be written, `<forward>` skips.
 * The parser's default output groups children by tag name and throws document
 * order away, which processes every note before any backup and stacks both
 * hands onto beat one.
 *
 * Uses `fast-xml-parser` rather than `DOMParser` so this runs in node, which is
 * what lets the parser be tested without a browser. It must survive
 * **MuseScore's dialect**, since exporting from MuseScore is the authoring
 * workflow this project expects.
 */

import { XMLParser } from 'fast-xml-parser';
import { type SpelledPitch, type Step, toMidi } from '../../theory/pitch';
import { type Key, allKeys, keyFifths } from '../../theory/scale';
import {
  type Articulation, type Measure, type Part, type Provenance, type Score,
  type ScoreNote, type TieState, type TimeSignature,
  makeMeasure, makeNote,
} from '../model';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  preserveOrder: true,
  parseTagValue: true,
  trimValues: true,
});

/**
 * A node in the ordered representation: one tag key whose value is an array of
 * children, plus an optional `:@` attribute bag. Leaves carry `#text`.
 */
type Node = Record<string, unknown>;

function tagOf(node: Node): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key;
  }
  return null;
}

function childrenOf(node: Node | null): Node[] {
  if (!node) return [];
  const tag = tagOf(node);
  if (!tag) return [];
  const value = node[tag];
  return Array.isArray(value) ? (value as Node[]) : [];
}

function attributes(node: Node | null): Record<string, unknown> {
  if (!node) return {};
  const attrs = node[':@'];
  return attrs && typeof attrs === 'object' ? (attrs as Record<string, unknown>) : {};
}

function findChild(node: Node | null, tag: string): Node | null {
  return childrenOf(node).find((c) => tagOf(c) === tag) ?? null;
}

function findChildren(node: Node | null, tag: string): Node[] {
  return childrenOf(node).filter((c) => tagOf(c) === tag);
}

function hasChild(node: Node | null, tag: string): boolean {
  return findChild(node, tag) !== null;
}

function textOf(node: Node | null): string | null {
  if (!node) return null;
  for (const child of childrenOf(node)) {
    if ('#text' in child) return String(child['#text']);
  }
  return null;
}

function numOf(node: Node | null, tag: string, fallback: number): number {
  const raw = textOf(findChild(node, tag));
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function attrNum(node: Node | null, name: string, fallback: number): number {
  const raw = attributes(node)[name];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function keyFromFifths(fifths: number, mode: string | null): Key | null {
  const wanted = mode === 'minor' ? 'minor' : 'major';
  return allKeys(wanted).find((k) => keyFifths(k) === fifths) ?? null;
}

const ARTICULATION_TAGS: Record<string, Articulation> = {
  staccato: 'staccato',
  accent: 'accent',
  tenuto: 'tenuto',
  'strong-accent': 'marcato',
};

export interface ParseOptions {
  readonly id?: string;
  readonly provenance?: Provenance;
}

export class MusicXmlParseError extends Error {}

/**
 * Parse a MusicXML document.
 *
 * Compressed `.mxl` is not handled here: unzipping belongs at the import
 * boundary where the platform's decompression is available, rather than pulling
 * a zip library into core.
 */
export function parseMusicXml(xml: string, options: ParseOptions = {}): Score {
  let roots: Node[];
  try {
    roots = parser.parse(xml) as Node[];
  } catch (err) {
    throw new MusicXmlParseError(`Could not read the file as XML: ${(err as Error).message}`);
  }
  if (!Array.isArray(roots)) throw new MusicXmlParseError('Document is not valid XML.');

  const root = roots.find((n) => tagOf(n) === 'score-partwise');
  if (!root) {
    if (roots.some((n) => tagOf(n) === 'score-timewise')) {
      throw new MusicXmlParseError(
        'This is a timewise MusicXML file. Re-export it as partwise — every notation program can.',
      );
    }
    throw new MusicXmlParseError('No <score-partwise> element found.');
  }

  const title =
    textOf(findChild(findChild(root, 'work'), 'work-title')) ??
    textOf(findChild(root, 'movement-title')) ??
    'Untitled';

  let composer: string | null = null;
  for (const creator of findChildren(findChild(root, 'identification'), 'creator')) {
    if (attributes(creator)['@type'] === 'composer') composer = textOf(creator);
  }

  const partNames = new Map<string, string>();
  for (const sp of findChildren(findChild(root, 'part-list'), 'score-part')) {
    const id = String(attributes(sp)['@id'] ?? '');
    partNames.set(id, textOf(findChild(sp, 'part-name')) ?? id);
  }

  const parts = findChildren(root, 'part').map((partNode, index) => {
    const id = String(attributes(partNode)['@id'] ?? `P${index + 1}`);
    return parsePart(partNode, id, partNames.get(id) ?? id);
  });

  if (parts.length === 0) throw new MusicXmlParseError('The file contains no parts.');

  return {
    id: options.id ?? `score-${Date.now()}`,
    title,
    composer,
    parts,
    provenance: options.provenance ?? {
      source: 'userImported',
      license: 'unknown',
      attribution: composer,
      isPrivate: true,
    },
  };
}

function parsePart(partNode: Node, id: string, name: string): Part {
  const measures: Measure[] = [];
  let divisions = 1;
  let staffCount = 1;

  for (const measureNode of findChildren(partNode, 'measure')) {
    const attrs = findChild(measureNode, 'attributes');
    if (attrs) {
      divisions = numOf(attrs, 'divisions', divisions);
      staffCount = Math.max(staffCount, numOf(attrs, 'staves', 1));
    }
    measures.push(parseMeasure(measureNode, divisions, measures.length + 1));
  }

  return { id, name, staffCount, measures };
}

function parseMeasure(measureNode: Node, divisions: number, fallbackNumber: number): Measure {
  const attrs = findChild(measureNode, 'attributes');

  let timeSignature: TimeSignature | null = null;
  const timeNode = findChild(attrs, 'time');
  if (timeNode) {
    timeSignature = {
      beats: numOf(timeNode, 'beats', 4),
      beatType: numOf(timeNode, 'beat-type', 4),
    };
  }

  let key: Key | null = null;
  const keyNode = findChild(attrs, 'key');
  if (keyNode) {
    key = keyFromFifths(numOf(keyNode, 'fifths', 0), textOf(findChild(keyNode, 'mode')));
  }

  let tempo: { bpm: number; beatUnit: number } | null = null;
  for (const direction of findChildren(measureNode, 'direction')) {
    const sound = findChild(direction, 'sound');
    if (sound && attributes(sound)['@tempo'] !== undefined) {
      tempo = { bpm: attrNum(sound, '@tempo', 80), beatUnit: 1 };
    }
  }
  const directSound = findChild(measureNode, 'sound');
  if (!tempo && directSound && attributes(directSound)['@tempo'] !== undefined) {
    tempo = { bpm: attrNum(directSound, '@tempo', 80), beatUnit: 1 };
  }

  const repeat = findChild(findChild(measureNode, 'barline'), 'repeat');
  const repeatDirection = repeat ? String(attributes(repeat)['@direction'] ?? '') : '';

  // Walk the measure in document order, maintaining the cursor. This is the
  // whole reason the parser preserves order.
  const notes: ScoreNote[] = [];
  let cursor = 0;
  let previousOnset = 0;

  for (const child of childrenOf(measureNode)) {
    const tag = tagOf(child);

    if (tag === 'note') {
      const duration = numOf(child, 'duration', 0) / divisions;
      const isChordTone = hasChild(child, 'chord');
      const onset = isChordTone ? previousOnset : cursor;

      notes.push(parseNote(child, onset, duration));

      if (!isChordTone) {
        previousOnset = cursor;
        cursor += duration;
      }
    } else if (tag === 'backup') {
      cursor -= numOf(child, 'duration', 0) / divisions;
    } else if (tag === 'forward') {
      cursor += numOf(child, 'duration', 0) / divisions;
    }
  }

  return makeMeasure({
    number: attrNum(measureNode, '@number', fallbackNumber),
    notes,
    timeSignature,
    key,
    tempo,
    repeatStart: repeatDirection === 'forward',
    repeatEnd: repeatDirection === 'backward',
  });
}

function parseNote(noteNode: Node, onsetBeats: number, durationBeats: number): ScoreNote {
  const isRest = hasChild(noteNode, 'rest');
  const pitchNode = findChild(noteNode, 'pitch');

  let spelled: SpelledPitch | null = null;
  if (!isRest && pitchNode) {
    const step = textOf(findChild(pitchNode, 'step'));
    if (step) {
      spelled = {
        step: step.toUpperCase() as Step,
        alter: numOf(pitchNode, 'alter', 0),
        octave: numOf(pitchNode, 'octave', 4),
      };
    }
  }

  const notations = findChild(noteNode, 'notations');

  const articulations: Articulation[] = [];
  for (const node of childrenOf(findChild(notations, 'articulations'))) {
    const mapped = ARTICULATION_TAGS[tagOf(node) ?? ''];
    if (mapped) articulations.push(mapped);
  }

  let slurStart = false;
  let slurStop = false;
  for (const slur of findChildren(notations, 'slur')) {
    const type = attributes(slur)['@type'];
    if (type === 'start') slurStart = true;
    if (type === 'stop') slurStop = true;
  }

  // Ties live in two places: <tie> is the sound, <tied> the notation. Files in
  // the wild use either, so accept both.
  const tieTypes = new Set(
    [...findChildren(noteNode, 'tie'), ...findChildren(notations, 'tied')].map((t) =>
      String(attributes(t)['@type'] ?? ''),
    ),
  );
  let tie: TieState = null;
  if (tieTypes.has('start') && tieTypes.has('stop')) tie = 'continue';
  else if (tieTypes.has('start')) tie = 'start';
  else if (tieTypes.has('stop')) tie = 'stop';

  const fingeringRaw = textOf(findChild(findChild(notations, 'technical'), 'fingering'));
  const fingering = fingeringRaw !== null ? Number(fingeringRaw) : null;

  return makeNote({
    midi: spelled ? toMidi(spelled) : null,
    spelled,
    staff: numOf(noteNode, 'staff', 1),
    voice: numOf(noteNode, 'voice', 1),
    onsetBeats,
    durationBeats,
    tie,
    slurStart,
    slurStop,
    articulations,
    fingering: fingering !== null && Number.isFinite(fingering) ? fingering : null,
    arpeggiate: hasChild(notations, 'arpeggiate'),
    ornament: hasChild(noteNode, 'grace') || hasChild(notations, 'ornaments'),
    dynamic: null,
  });
}
