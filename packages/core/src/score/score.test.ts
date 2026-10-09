import { describe, expect, it } from 'vitest';
import { parseMusicXml, MusicXmlParseError } from './musicxml/parse';
import { serializeMusicXml } from './musicxml/serialize';
import { generateSightReading, type SightReadingParams } from './generate/sightReading';
import {
  flattenScore, onsetClusters, scoreDurationBeats, notesOnStaff,
} from './timeline';
import {
  keyboardSpan, makeMeasure, makeNote, pitchRange, GENERATED_PROVENANCE,
  type Score,
} from './model';
import { allKeys, keyId, keyScale, type Key } from '../theory/scale';
import { parsePitch, toMidi } from '../theory/pitch';
import { makeRng } from '../generators/rng';

const K = (id: string): Key => {
  const k = [...allKeys('major'), ...allKeys('minor')].find((x) => keyId(x) === id);
  if (!k) throw new Error(`no key ${id}`);
  return k;
};
const P = (s: string) => {
  const p = parsePitch(s);
  if (!p) throw new Error(`bad pitch ${s}`);
  return p;
};

/**
 * A MuseScore-dialect export. Deliberately hand-written rather than produced by
 * our own serialiser: a parser tested only against its own writer proves
 * nothing about the files it will actually meet.
 */
const MUSESCORE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Minuet fragment</work-title></work>
  <identification>
    <creator type="composer">J. S. Bach</creator>
    <encoding><software>MuseScore 4.4.2</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>1</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above"><sound tempo="96"/></direction>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations>
          <slur type="start" number="1"/>
          <technical><fingering>5</fingering></technical>
        </notations>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>240</duration><voice>1</voice><type>eighth</type><staff>1</staff>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>240</duration><voice>1</voice><type>eighth</type><staff>1</staff>
        <notations>
          <slur type="stop" number="1"/>
          <articulations><staccato/></articulations>
        </notations>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff>
      </note>
      <backup><duration>1440</duration></backup>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>1440</duration><voice>5</voice><type>half</type><dot/><staff>2</staff>
        <tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>1440</duration><voice>5</voice><type>half</type><dot/><staff>2</staff>
        <tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
      <backup><duration>1440</duration></backup>
      <note>
        <pitch><step>C</step><alter>1</alter><octave>5</octave></pitch>
        <duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff>
      </note>
      <note><rest/><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><arpeggiate/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

describe('MusicXML parsing (MuseScore dialect)', () => {
  const score = parseMusicXml(MUSESCORE_FIXTURE, { id: 'fixture' });

  it('reads metadata', () => {
    expect(score.title).toBe('Minuet fragment');
    expect(score.composer).toBe('J. S. Bach');
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0]!.staffCount).toBe(2);
  });

  it('scales durations by the divisions value', () => {
    // 480 divisions per quarter: a 480-tick note is one beat, not 480.
    const first = score.parts[0]!.measures[0]!.notes[0]!;
    expect(first.durationBeats).toBe(1);
    expect(first.midi).toBe(toMidi(P('D5')));
  });

  it('reads key, time and tempo', () => {
    const m1 = score.parts[0]!.measures[0]!;
    expect(keyId(m1.key!)).toBe('G-major');
    expect(m1.timeSignature).toEqual({ beats: 3, beatType: 4 });
    expect(m1.tempo?.bpm).toBe(96);
  });

  it('advances the cursor across notes and rewinds on backup', () => {
    const m1 = score.parts[0]!.measures[0]!;
    const rh = m1.notes.filter((n) => n.staff === 1);
    expect(rh.map((n) => n.onsetBeats)).toEqual([0, 1, 1.5, 2]);

    // The left-hand note follows a <backup>, so it starts at beat 0 again —
    // not stacked after the right hand.
    const lh = m1.notes.filter((n) => n.staff === 2);
    expect(lh).toHaveLength(1);
    expect(lh[0]!.onsetBeats).toBe(0);
  });

  it('keeps staff assignment, which is authoritative for hand attribution', () => {
    const m1 = score.parts[0]!.measures[0]!;
    expect(m1.notes.filter((n) => n.staff === 1)).toHaveLength(4);
    expect(m1.notes.filter((n) => n.staff === 2)).toHaveLength(1);
  });

  it('reads fingering, slurs, articulations and arpeggios', () => {
    const m1 = score.parts[0]!.measures[0]!;
    expect(m1.notes[0]!.fingering).toBe(5);
    expect(m1.notes[0]!.slurStart).toBe(true);
    expect(m1.notes[2]!.slurStop).toBe(true);
    expect(m1.notes[2]!.articulations).toContain('staccato');

    const m2 = score.parts[0]!.measures[1]!;
    expect(m2.notes.some((n) => n.arpeggiate)).toBe(true);
  });

  it('reads ties from both <tie> and <tied>', () => {
    const m1 = score.parts[0]!.measures[0]!;
    expect(m1.notes.find((n) => n.staff === 2)!.tie).toBe('start');
    const m2 = score.parts[0]!.measures[1]!;
    expect(m2.notes.find((n) => n.staff === 2)!.tie).toBe('stop');
  });

  it('reads accidentals', () => {
    const m2 = score.parts[0]!.measures[1]!;
    const cSharp = m2.notes.find((n) => n.spelled?.step === 'C');
    expect(cSharp?.spelled?.alter).toBe(1);
    expect(cSharp?.midi).toBe(toMidi(P('C#5')));
  });

  it('keeps rests, which beginners under-hold and nobody measures', () => {
    const m2 = score.parts[0]!.measures[1]!;
    expect(m2.notes.filter((n) => n.midi === null)).toHaveLength(1);
  });

  it('rejects unusable input with a message that says what to do', () => {
    expect(() => parseMusicXml('<nonsense/>')).toThrow(MusicXmlParseError);
    expect(() => parseMusicXml('<score-timewise></score-timewise>')).toThrow(/partwise/i);
  });
});

describe('timeline', () => {
  const score = parseMusicXml(MUSESCORE_FIXTURE);

  it('places notes at absolute positions across bar lines', () => {
    const flat = flattenScore(score);
    const rh = notesOnStaff(flat, 1).sort((a, b) => a.absoluteBeats - b.absoluteBeats);
    // Bar 1 is 3 beats, so bar 2 starts at beat 3. The rest at beat 4 is
    // included: rests are events, and observing them is separately gradeable.
    expect(rh.map((n) => n.absoluteBeats)).toEqual([0, 1, 1.5, 2, 3, 4, 5]);
    expect(rh.filter((n) => n.midi === null)).toHaveLength(1);
  });

  it('joins a tie into one sounding note rather than two attacks', () => {
    const flat = flattenScore(score);
    const lh = notesOnStaff(flat, 2);
    expect(lh).toHaveLength(1);
    expect(lh[0]!.soundingBeats).toBe(6); // 3 + 3 across the bar line
  });

  it('groups simultaneous notes into onset clusters', () => {
    const flat = flattenScore(score);
    const clusters = onsetClusters(flat);
    const first = clusters[0]!;
    // D5 in the right hand and G3 in the left both start at beat 0.
    expect(first.absoluteBeats).toBe(0);
    expect(first.pitches).toHaveLength(2);
    expect(first.pitches).toEqual([toMidi(P('G3')), toMidi(P('D5'))]);
  });

  it('marks a cluster arpeggiated so a notated roll is not scored as error', () => {
    const clusters = onsetClusters(flattenScore(score));
    expect(clusters.some((c) => c.arpeggiated)).toBe(true);
  });

  it('reports total duration', () => {
    expect(scoreDurationBeats(score)).toBeGreaterThan(5);
  });
});

describe('MusicXML round-trip', () => {
  it('survives serialize then parse unchanged', () => {
    const original = parseMusicXml(MUSESCORE_FIXTURE);
    const reparsed = parseMusicXml(serializeMusicXml(original));

    const flatten = (s: Score) =>
      flattenScore(s).map((n) => ({
        midi: n.midi,
        beats: Math.round(n.absoluteBeats * 1000) / 1000,
        dur: Math.round(n.soundingBeats * 1000) / 1000,
        staff: n.staff,
      }));

    expect(flatten(reparsed)).toEqual(flatten(original));
  });

  it('preserves fingering, slurs and articulations through a round-trip', () => {
    const original = parseMusicXml(MUSESCORE_FIXTURE);
    const reparsed = parseMusicXml(serializeMusicXml(original));
    const note = reparsed.parts[0]!.measures[0]!.notes[0]!;
    expect(note.fingering).toBe(5);
    expect(note.slurStart).toBe(true);
    expect(
      reparsed.parts[0]!.measures[0]!.notes.some((n) => n.articulations.includes('staccato')),
    ).toBe(true);
  });

  it('round-trips generated material too', () => {
    const params = baseParams(K('F-major'));
    const generated = generateSightReading(params, 4242);
    const reparsed = parseMusicXml(serializeMusicXml(generated));
    expect(flattenScore(reparsed).map((n) => n.midi))
      .toEqual(flattenScore(generated).map((n) => n.midi));
  });

  it('rewinds between staves by what was written, not by a nominal bar', () => {
    // The bug this pins: `<backup>` read the measure's own `timeSignature`,
    // which is written only on the bar that introduces it. Every later bar of a
    // 3/4 piece therefore rewound a quarter-note too far and landed the lower
    // staff at onset -1 — silently, because a 4/4 piece is unaffected and every
    // fixture was in four.
    // `spelled` is what the serialiser writes `<pitch>` from; a note without it
    // is a rest, so the fixture has to be spelled to test anything.
    const at = (name: string, onsetBeats: number, durationBeats: number, staff: number) => {
      const spelled = parsePitch(name)!;
      return makeNote({
        midi: toMidi(spelled), spelled, onsetBeats, durationBeats,
        staff, voice: staff === 2 ? 2 : 1,
      });
    };

    const bar = (number: number) => makeMeasure({
      number,
      timeSignature: number === 1 ? { beats: 3, beatType: 4 } : null,
      notes: [
        at('C5', 0, 2, 1), at('D5', 2, 1, 1),
        at('C3', 0, 1, 2), at('G3', 1, 1, 2), at('C4', 2, 1, 2),
      ],
    });

    const waltz: Score = {
      id: 'three-four', title: 'Three Four', composer: null,
      provenance: GENERATED_PROVENANCE,
      parts: [{ id: 'P1', name: 'Piano', staffCount: 2, measures: [bar(1), bar(2), bar(3)] }],
    };

    const reparsed = parseMusicXml(serializeMusicXml(waltz));
    for (const measure of reparsed.parts[0]!.measures) {
      for (const note of measure.notes) {
        expect(note.onsetBeats, `bar ${measure.number}`).toBeGreaterThanOrEqual(0);
        expect(note.onsetBeats, `bar ${measure.number}`).toBeLessThan(3);
      }
    }
    expect(flattenScore(reparsed).map((n) => n.midi))
      .toEqual(flattenScore(waltz).map((n) => n.midi));
  });

  it('rewinds correctly when a staff does not fill its bar', () => {
    // A pickup bar, or a lower staff that rests through part of a measure.
    // Rewinding by the bar length rather than by what was written would put the
    // second staff before the barline.
    const measure = makeMeasure({
      number: 1,
      timeSignature: { beats: 4, beatType: 4 },
      notes: [
        makeNote({
          midi: 72, spelled: parsePitch('C5'), onsetBeats: 0, durationBeats: 1, staff: 1,
        }),
        makeNote({
          midi: 48, spelled: parsePitch('C3'), onsetBeats: 0, durationBeats: 1,
          staff: 2, voice: 2,
        }),
      ],
    });
    const pickup: Score = {
      id: 'pickup', title: 'Pickup', composer: null,
      provenance: GENERATED_PROVENANCE,
      parts: [{ id: 'P1', name: 'Piano', staffCount: 2, measures: [measure] }],
    };

    const reparsed = parseMusicXml(serializeMusicXml(pickup));
    expect(reparsed.parts[0]!.measures[0]!.notes.map((n) => n.onsetBeats)).toEqual([0, 0]);
  });
});

function baseParams(key: Key, over: Partial<SightReadingParams> = {}): SightReadingParams {
  return {
    key,
    bars: 4,
    timeSignature: { beats: 4, beatType: 4 },
    range: [60, 79],
    hands: 1,
    rhythmUnits: [1, 0.5],
    maxLeap: 3,
    stepBias: 0.75,
    allowRests: false,
    tempo: 72,
    ...over,
  };
}

describe('generated sight-reading', () => {
  const rng = makeRng(9);

  it('is deterministic from its seed', () => {
    const a = generateSightReading(baseParams(K('C-major')), 777);
    const b = generateSightReading(baseParams(K('C-major')), 777);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('never leaves the key, in any key, over many seeds', () => {
    for (const id of ['C-major', 'G-major', 'F-major', 'Eb-major', 'A-minor', 'D-major']) {
      const key = K(id);
      const inKey = new Set(
        [...Array(11).keys()].flatMap((o) =>
          keyPitchClasses(key).map((pc) => pc),
        ),
      );
      for (let i = 0; i < 25; i++) {
        const score = generateSightReading(baseParams(key), rng.int(0, 1e9));
        for (const note of flattenScore(score)) {
          if (note.midi === null) continue;
          expect(inKey.has(note.midi % 12), `${id} seed produced out-of-key note`).toBe(true);
        }
      }
    }
  });

  it('respects the range it is given', () => {
    for (let i = 0; i < 40; i++) {
      const score = generateSightReading(
        baseParams(K('C-major'), { range: [60, 72] }),
        rng.int(0, 1e9),
      );
      const range = pitchRange(score);
      expect(range![0]).toBeGreaterThanOrEqual(60);
      expect(range![1]).toBeLessThanOrEqual(72);
    }
  });

  it('respects the maximum leap', () => {
    for (let i = 0; i < 40; i++) {
      const score = generateSightReading(
        baseParams(K('C-major'), { maxLeap: 1, stepBias: 1 }),
        rng.int(0, 1e9),
      );
      const melody = notesOnStaff(flattenScore(score), 1)
        .filter((n) => n.midi !== null)
        .sort((a, b) => a.absoluteBeats - b.absoluteBeats);
      for (let j = 1; j < melody.length - 1; j++) {
        // Stepwise in a diatonic scale is at most a whole tone; the final note
        // is exempt because the phrase is pulled to the tonic to end.
        const delta = Math.abs(melody[j]!.midi! - melody[j - 1]!.midi!);
        expect(delta).toBeLessThanOrEqual(2);
      }
    }
  });

  it('fills every bar exactly', () => {
    for (let i = 0; i < 30; i++) {
      const score = generateSightReading(baseParams(K('G-major')), rng.int(0, 1e9));
      for (const measure of score.parts[0]!.measures) {
        const rh = measure.notes.filter((n) => n.staff === 1);
        const total = rh.reduce((a, n) => a + n.durationBeats, 0);
        expect(total).toBeCloseTo(4, 5);
      }
    }
  });

  it('ends on the tonic so the phrase sounds finished', () => {
    for (let i = 0; i < 30; i++) {
      const key = K('D-major');
      const score = generateSightReading(baseParams(key), rng.int(0, 1e9));
      const melody = notesOnStaff(flattenScore(score), 1).filter((n) => n.midi !== null);
      const last = melody[melody.length - 1]!;
      expect(last.midi! % 12).toBe(toMidi(key.tonic) % 12);
    }
  });

  it('adds a second staff when asked, and not otherwise', () => {
    const one = generateSightReading(baseParams(K('C-major'), { hands: 1 }), 5);
    expect(notesOnStaff(flattenScore(one), 2)).toHaveLength(0);

    const two = generateSightReading(baseParams(K('C-major'), { hands: 2 }), 5);
    expect(notesOnStaff(flattenScore(two), 2).length).toBeGreaterThan(0);
    expect(two.parts[0]!.staffCount).toBe(2);
  });

  it('produces a renderable document', () => {
    const xml = serializeMusicXml(generateSightReading(baseParams(K('Bb-major')), 21));
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('<divisions>');
    expect(xml).toContain('</score-partwise>');
  });
});

function keyPitchClasses(key: Key): number[] {
  return keyScale(key).map((n) => toMidi(n) % 12);
}

describe('keyboard span', () => {
  it('covers every note a piece asks for', () => {
    // Found by playing a real piece: the default C3 keyboard missed Ode to
    // Joy's left-hand G2, so the piece could not be played on screen at all.
    const generated = generateSightReading(
      baseParams(K('C-major'), { hands: 2, range: [43, 79] }),
      31,
    );
    const [lowest, highest] = pitchRange(generated)!;
    const { low, octaves } = keyboardSpan(generated);

    expect(low).toBeLessThanOrEqual(lowest);
    expect(low + octaves * 12 - 1).toBeGreaterThanOrEqual(highest);
  });

  it('starts on a C, so the keyboard is readable at a glance', () => {
    for (let seed = 0; seed < 20; seed++) {
      const score = generateSightReading(
        baseParams(K('C-major'), { hands: 2, range: [45 + seed, 76 + seed] }),
        seed,
      );
      expect(keyboardSpan(score).low % 12, `seed ${seed}`).toBe(0);
    }
  });

  it('falls back rather than producing an empty keyboard for a silent score', () => {
    const silent: Score = {
      id: 'silent', title: 'Silent', composer: null,
      provenance: GENERATED_PROVENANCE,
      parts: [{ id: 'P1', name: 'Piano', staffCount: 1, measures: [] }],
    };
    expect(keyboardSpan(silent)).toEqual({ low: 48, octaves: 2 });
  });
});
