/**
 * Reading a computed CSS colour well enough to answer one question: did the
 * theme resolve?
 *
 * When a browser does not understand `oklch()`, the custom property holding the
 * colour is still stored, but `background: var(--color-ground)` becomes invalid
 * at computed-value time and falls back to `initial` — transparent. So the check
 * is not "is this the right colour" (which would mean hard-coding the palette
 * into a probe) but "is the page background a real, dark colour at all". A
 * transparent or near-white body means the tokens did not resolve; a dark
 * opaque one means they did.
 *
 * Modern browsers serialise a computed colour in the space it was authored in,
 * so a theme written in OKLCH comes back as `oklch(0.155 0.008 265)`, not as
 * `rgb(...)`. A parser that only understood `rgb()` would read every working
 * theme as unreadable, so this handles the spaces a computed value can use.
 */

export interface ParsedColor {
  /** Perceptual lightness, 0 (black) to 1 (white) — OKLab L. */
  readonly lightness: number;
  /** 0 (fully transparent) to 1 (opaque). */
  readonly alpha: number;
}

function number(token: string, percentScale = 1): number | null {
  const trimmed = token.trim();
  if (trimmed === 'none') return 0;
  const isPercent = trimmed.endsWith('%');
  const value = Number.parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(value)) return null;
  return isPercent ? (value / 100) * percentScale : value;
}

/**
 * Split `a b c / d` or `a, b, c, d` into its components and optional alpha.
 *
 * The comma form puts alpha in a fourth position, but only for `rgb()` and
 * `rgba()`. Applied blindly it would swallow the last channel of
 * `color(srgb r g b)`, which also has four tokens and no alpha.
 */
function components(
  inner: string,
  legacyAlpha: boolean,
): { parts: string[]; alpha: number } | null {
  const [body, alphaToken] = inner.split('/');
  const parts = (body ?? '').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  let alpha = 1;
  if (alphaToken !== undefined) {
    const parsed = number(alphaToken);
    if (parsed === null) return null;
    alpha = parsed;
  } else if (legacyAlpha && parts.length === 4) {
    const parsed = number(parts.pop() ?? '');
    if (parsed === null) return null;
    alpha = parsed;
  }
  return { parts, alpha: Math.max(0, Math.min(1, alpha)) };
}

/** sRGB (0-1 per channel) to OKLab lightness. */
function srgbLightness(r: number, g: number, b: number): number {
  const linear = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)] as const;

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/**
 * Parse a computed CSS colour. Returns null for anything it cannot read, which
 * callers must treat as "unknown" rather than as dark or light.
 */
export function parseCssColor(value: string): ParsedColor | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { lightness: 0, alpha: 0 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex?.[1]) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((d) => d + d).join('');
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    const channel = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
    return {
      lightness: srgbLightness(channel(0), channel(2), channel(4)),
      alpha: digits.length === 8 ? channel(6) : 1,
    };
  }

  const fn = /^([a-z-]+)\(\s*(.*)\s*\)$/.exec(text);
  if (!fn?.[1] || fn[2] === undefined) return null;
  const parsed = components(fn[2], fn[1] === 'rgb' || fn[1] === 'rgba');
  if (!parsed) return null;
  const { parts, alpha } = parsed;

  switch (fn[1]) {
    case 'rgb':
    case 'rgba': {
      const [r, g, b] = parts.slice(0, 3).map((p) => number(p, 255));
      if (r == null || g == null || b == null) return null;
      return { lightness: srgbLightness(r / 255, g / 255, b / 255), alpha };
    }
    case 'oklch':
    case 'oklab': {
      const l = number(parts[0] ?? '', 1);
      return l === null ? null : { lightness: l, alpha };
    }
    case 'lab':
    case 'lch': {
      // CIE L* runs 0-100. Not the same scale as OKLab L, but monotonic with
      // it and close enough for a dark/light decision.
      const l = number(parts[0] ?? '', 100);
      return l === null ? null : { lightness: l / 100, alpha };
    }
    case 'color': {
      const space = parts[0];
      if (space !== 'srgb') return null;
      const [r, g, b] = parts.slice(1, 4).map((p) => number(p, 1));
      if (r == null || g == null || b == null) return null;
      return { lightness: srgbLightness(r, g, b), alpha };
    }
    default:
      return null;
  }
}

export interface ThemeVerdict {
  readonly ok: boolean;
  readonly detail: string;
}

/** Above this the background is not the dark ground the design is built on. */
export const DARK_GROUND_MAX_LIGHTNESS = 0.3;

/**
 * Did the dark theme resolve, judging from the page background alone?
 *
 * Unreadable counts as *not* resolved. The alternative — assuming fine — would
 * make the check pass on exactly the browsers it exists to catch.
 */
export function themeVerdict(backgroundColor: string): ThemeVerdict {
  const color = parseCssColor(backgroundColor);

  if (color === null) {
    return {
      ok: false,
      detail: `The page background (${backgroundColor || 'empty'}) could not be read as a colour.`,
    };
  }
  if (color.alpha < 0.5) {
    return {
      ok: false,
      detail:
        'The page background is transparent: the theme colours did not resolve, '
        + 'so the browser is painting its own default.',
    };
  }
  if (color.lightness > DARK_GROUND_MAX_LIGHTNESS) {
    return {
      ok: false,
      detail: `The page background is light (lightness ${color.lightness.toFixed(2)}), not the dark ground the design assumes.`,
    };
  }
  return {
    ok: true,
    detail: `Dark theme resolved (background lightness ${color.lightness.toFixed(2)}).`,
  };
}
