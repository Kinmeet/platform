import { describe, expect, it } from 'vitest'
import tokens from '../../../../../app/assets/css/tokens.css?raw'

// Every text and background pairing the patch language uses, with the WCAG 2.2
// AA minimum it must meet: 4.5 for body text, 3 for large text (24px and up,
// or 18.66px bold) and for outlines such as the focus ring (1.4.11).
const pairings: { what: string; text: string; background: string; minimum: number }[] = [
  { what: 'body text on cream', text: 'bark', background: 'cream', minimum: 4.5 },
  { what: 'body text on patches and inputs', text: 'bark', background: 'elevated', minimum: 4.5 },
  { what: 'body text on sand', text: 'bark', background: 'sand', minimum: 4.5 },
  { what: 'text on a selected choice', text: 'bark', background: 'selected', minimum: 4.5 },
  { what: 'text on primary buttons', text: 'bark', background: 'sunwarm', minimum: 4.5 },
  { what: 'text on meadow bands and tags', text: 'bark', background: 'meadow', minimum: 4.5 },
  { what: 'hints on cream', text: 'bark-muted', background: 'cream', minimum: 4.5 },
  { what: 'hints on patches', text: 'bark-muted', background: 'elevated', minimum: 4.5 },
  { what: 'cancelled tag', text: 'bark-muted', background: 'sand', minimum: 4.5 },
  { what: 'headings and links on cream', text: 'wilder-green', background: 'cream', minimum: 4.5 },
  { what: 'links on patches', text: 'wilder-green', background: 'elevated', minimum: 4.5 },
  { what: 'links on sand', text: 'wilder-green', background: 'sand', minimum: 4.5 },
  { what: 'link hover on cream', text: 'wilder-green-deep', background: 'cream', minimum: 4.5 },
  { what: 'footer and paid tag text', text: 'cream', background: 'wilder-green', minimum: 4.5 },
  { what: 'error messages on cream', text: 'error', background: 'cream', minimum: 4.5 },
  { what: 'error messages on patches', text: 'error', background: 'elevated', minimum: 4.5 },
  // Disabled controls are exempt from 1.4.3, but we keep them readable anyway.
  { what: 'disabled button text', text: 'disabled-text', background: 'disabled', minimum: 4.5 },
  { what: 'focus ring on cream', text: 'bark', background: 'cream', minimum: 3 },
  { what: 'focus ring on sunwarm buttons', text: 'bark', background: 'sunwarm', minimum: 3 },
  { what: 'focus ring on wilder-green', text: 'cream', background: 'wilder-green', minimum: 3 },
  { what: 'invalid field border on patches', text: 'error', background: 'elevated', minimum: 3 },
]

// Pairings the design rules out. If one of these starts passing, the rule can
// be relaxed; until then nothing should use it.
const ruledOut: { what: string; text: string; background: string; below: number }[] = [
  { what: 'sunwarm focus ring on cream', text: 'sunwarm', background: 'cream', below: 3 },
  { what: 'wilder-green text on meadow', text: 'wilder-green', background: 'meadow', below: 4.5 },
  { what: 'bark focus ring on wilder-green', text: 'bark', background: 'wilder-green', below: 3 },
]

function palette(css: string): Map<string, string> {
  const colours = new Map<string, string>()
  for (const match of css.matchAll(/--colour-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    colours.set(match[1]!, match[2]!)
  }
  return colours
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const colours = palette(tokens)

function colour(name: string): string {
  const value = colours.get(name)
  if (!value) throw new Error(`--colour-${name} is not defined in tokens.css`)
  return value
}

describe('design token contrast', () => {
  it('reads the palette from tokens.css', () => {
    expect(colours.size).toBeGreaterThanOrEqual(10)
  })

  it.each(pairings)('$what meets $minimum:1', ({ text, background, minimum }) => {
    expect(contrast(colour(text), colour(background))).toBeGreaterThanOrEqual(minimum)
  })

  it.each(ruledOut)(
    '$what is below $below:1, so stays ruled out',
    ({ text, background, below }) => {
      expect(contrast(colour(text), colour(background))).toBeLessThan(below)
    },
  )
})
