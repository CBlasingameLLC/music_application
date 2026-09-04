# Étude

Piano training that works the way a teacher would teach it.

A free, offline-capable PWA for a tablet on a music stand next to a MIDI
keyboard. Built for one person, with a framework that admits guitar later.

## Why this exists

Falling-note apps (SimplyPiano, Synthesia) train reactive pattern-matching
against a scrolling target. The player watches the screen — never the score,
never their hands — and learns no notation, no fingering, no counted rhythm and
no dynamics. The habits are real and hard to unlearn.

Étude replaces that with what a competent teacher actually does: interval-based
reading, functional ear training, applied theory, and hand independence trained
directly rather than hoped for as a byproduct.

## Design decisions worth knowing

**Seven skill domains, tracked separately.** Reading, Rhythm, Ear, Theory,
Technique, Independence, Repertoire. One number would hide the thing that
matters most — that you can be a strong reader and weak at hands-together.
Domains 1–4 are instrument-agnostic and carry to guitar unchanged.

**Ear training is functional, not absolute.** A cadence establishes the key,
then you name the *scale degree*. "That's the flat seventh" is what lets you
work out a song by ear; "that's a minor seventh" is trivia.

**Mastery decays.** Every skill fades on a forgetting curve, and the decay is
what puts it back in the review queue. Declarative material uses FSRS; motor
skills get a tempo ladder with a much flatter decay timer, because motor memory
consolidates with sleep rather than review and has a continuous outcome
(accuracy at a tempo) rather than a recall event. Forcing both through one
scheduler would look principled and produce nonsense.

**XP measures quality, never time.** Scaffolds are priced rather than banned —
the keyboard hint stays available, and leaning on it visibly costs XP, so the
choice is yours and the cost is legible.

**Streaks have freeze tokens.** The daily minimum is 10 minutes and you earn a
freeze per unbroken week. A streak you can only keep on a good day is one you
will break, and the day after the break is when habit apps lose people.

**Everything is local.** IndexedDB is the source of truth; there is no server.
All writes are an append-only event log, so mastery, streaks, XP and the due
queue are projections, and adding sync later means shipping the log rather than
migrating a schema.

## Layout

```
apps/web/        Next.js 15 PWA — the tablet client
packages/core/   Pure TypeScript domain logic: no DOM, no framework
packages/content/  Curriculum and public-domain scores
```

`packages/core` holds everything musically interesting — the theory engine,
grading, scheduling, projections — and is unit-tested without a browser.

## Running it

```bash
pnpm install
pnpm test          # 123 unit tests over the theory and progression engines
pnpm dev           # http://localhost:3000

pnpm --filter @etude/web build
pnpm --filter @etude/web start -p 3311
BASE_URL=http://localhost:3311 pnpm --filter @etude/web test:e2e
```

The end-to-end test drives a real browser at tablet size and plays a chord on
the on-screen keyboard. It is not ceremonial: it has already caught two
failures that typechecked cleanly and passed every unit test — a keyboard that
silently swallowed every tap, and a diagnostics page that hung forever.

## Device notes

Target is an Amazon Fire HD 10 (13th gen, Fire OS 8, Silk) with an 88-key
digital piano. Two things follow from that:

- **The piano makes its own sound**, so the app never voices what you play and
  Android's output latency never affects playing feel. It still has to be
  subtracted when grading against a click, because you play in time with the
  click you *hear*.
- **Web MIDI on Fire OS is unverified.** Chromium implements it over
  `android.media.midi` and Amazon does not document whether the tablet declares
  that feature. Visit `/diagnostics` on the device to find out — and prefer a
  **Bluetooth** MIDI adapter, since USB MIDI has a documented defect on this
  tablet family.

## Content and copyright

Compositions in the bundled library are public domain, with each file's
transcription licence recorded in its metadata. Anything you import yourself
lives **only in OPFS/IndexedDB on the device** and never enters git — the
architecture, not a `.gitignore` rule, is what keeps private arrangements out
of a public release.
