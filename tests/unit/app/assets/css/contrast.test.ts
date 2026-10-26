import { describe, expect, it } from 'vitest'
import components from '../../../../../app/assets/css/components.css?raw'
import tokens from '../../../../../app/assets/css/tokens.css?raw'

// WCAG 2.2 AA minimums: 4.5 for body text (1.4.3), 3 for outlines such as the
// focus ring and invalid-field borders (1.4.11).
const TEXT = 4.5
const OUTLINE = 3

/** Custom properties declared in one CSS block, values as written. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of block.matchAll(/--colour-([a-z-]+):\s*([^;]+);/gi)) {
    found.set(match[1]!, match[2]!.trim())
  }
  return found
}

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`No "${selector}" rule in components.css`)
  return css.slice(start, css.indexOf('}', start))
}

const root = declarations(tokens)

/** Resolves a token to a hex colour, following var() through a scope's overrides. */
function resolve(name: string, scope: Map<string, string> = new Map()): string {
  const value = scope.get(name) ?? root.get(name)
  if (!value) throw new Error(`--colour-${name} is not defined`)
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  const reference = value.match(/^var\(--colour-([a-z-]+)\)$/)
  if (!reference) throw new Error(`--colour-${name} has a value the test cannot read: ${value}`)
  // A scope's override points at a palette colour or root role, never at itself.
  return resolve(reference[1]!, reference[1] === name ? new Map() : scope)
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

// Each surface, with the role tokens it re-points. Every role colour must
// pass on its own surface, so nothing inside the footer or a band can turn
// green on green or cream on cream.
const surfaces = [
  { name: 'cream page', background: 'cream', scope: new Map<string, string>() },
  { name: 'sand band', background: 'sand', scope: new Map<string, string>() },
  {
    name: 'meadow band (.band)',
    background: 'meadow',
    scope: declarations(ruleBody(components, '.band')),
  },
  {
    name: 'wilder-green surface (.on-dark)',
    background: 'wilder-green',
    scope: declarations(ruleBody(components, '.on-dark')),
  },
  {
    name: 'patch, note, field or choice',
    background: 'elevated',
    scope: new Map([
      ...declarations(ruleBody(components, ':is(.patch, .note, .error-summary, .input, .choice)')),
      ...declarations(ruleBody(components, ':is(.patch, .note, .error-summary)')),
    ]),
  },
]

const roles = [
  { role: 'text', minimum: TEXT },
  { role: 'text-muted', minimum: TEXT },
  { role: 'heading', minimum: TEXT },
  { role: 'link', minimum: TEXT },
  { role: 'link-hover', minimum: TEXT },
  { role: 'error', minimum: TEXT },
  { role: 'focus', minimum: OUTLINE },
]

const roleChecks = surfaces.flatMap((surface) => roles.map((role) => ({ ...surface, ...role })))

// Fields and choices draw their focus ring outside themselves, on the surface
// around them, so it must take that surface's ring colour.
const fieldRings = surfaces
  .filter((surface) => surface.background !== 'elevated')
  .map((surface) => ({
    ...surface,
    scope: new Map([
      ...surface.scope,
      ...declarations(ruleBody(components, ':is(.patch, .note, .error-summary, .input, .choice)')),
    ]),
  }))

// Components that set their own colours, whatever surface they sit on.
const fixedPairings: { what: string; text: string; background: string; minimum: number }[] = [
  { what: 'primary button text', text: 'bark', background: 'sunwarm', minimum: TEXT },
  { what: 'secondary button text', text: 'bark', background: 'elevated', minimum: TEXT },
  { what: 'green button text', text: 'cream', background: 'wilder-green', minimum: TEXT },
  { what: 'disabled button text', text: 'disabled-text', background: 'disabled', minimum: TEXT },
  { what: 'selected choice text', text: 'bark', background: 'selected', minimum: TEXT },
  { what: 'paid tag', text: 'cream', background: 'wilder-green', minimum: TEXT },
  { what: 'step-free tag', text: 'bark', background: 'meadow', minimum: TEXT },
  { what: 'warning tag and sticker', text: 'bark', background: 'sunwarm', minimum: TEXT },
  { what: 'cancelled tag', text: 'bark-muted', background: 'sand', minimum: TEXT },
  { what: 'group tag', text: 'wilder-green', background: 'elevated', minimum: TEXT },
  { what: 'skip link', text: 'cream', background: 'wilder-green', minimum: TEXT },
  { what: 'focus ring on primary buttons', text: 'bark', background: 'sunwarm', minimum: OUTLINE },
  { what: 'invalid field border', text: 'error-base', background: 'elevated', minimum: OUTLINE },
  { what: 'error summary links', text: 'error-base', background: 'elevated', minimum: TEXT },
]

// Pairings the design rules out. If one starts passing, the rule can be
// relaxed; until then nothing should use it.
const ruledOut: { what: string; text: string; background: string; below: number }[] = [
  { what: 'sunwarm focus ring on cream', text: 'sunwarm', background: 'cream', below: OUTLINE },
  { what: 'wilder-green text on meadow', text: 'wilder-green', background: 'meadow', below: TEXT },
  { what: 'bark-muted text on meadow', text: 'bark-muted', background: 'meadow', below: TEXT },
  { what: 'error text on meadow', text: 'error-base', background: 'meadow', below: TEXT },
  {
    what: 'bark focus ring on wilder-green',
    text: 'bark',
    background: 'wilder-green',
    below: OUTLINE,
  },
]

describe('design token contrast', () => {
  it('reads the palette from tokens.css', () => {
    expect(root.size).toBeGreaterThanOrEqual(10)
  })

  it.each(roleChecks)(
    '$role on the $name meets $minimum:1',
    ({ role, minimum, background, scope }) => {
      expect(contrast(resolve(role, scope), resolve(background))).toBeGreaterThanOrEqual(minimum)
    },
  )

  it.each(fieldRings)(
    'a field or choice focus ring on the $name meets 3:1',
    ({ background, scope }) => {
      expect(contrast(resolve('focus', scope), resolve(background))).toBeGreaterThanOrEqual(OUTLINE)
    },
  )

  it.each(fixedPairings)('$what meets $minimum:1', ({ text, background, minimum }) => {
    expect(contrast(resolve(text), resolve(background))).toBeGreaterThanOrEqual(minimum)
  })

  it.each(ruledOut)(
    '$what is below $below:1, so stays ruled out',
    ({ text, background, below }) => {
      expect(contrast(resolve(text), resolve(background))).toBeLessThan(below)
    },
  )
})
