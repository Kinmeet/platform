import { describe, expect, it } from 'vitest'
import { requestedByProblems } from '../../../scripts/pr-body'

// Firm rule 3 in PR descriptions (#168). The names here are made up.

const thread = '[project thread](https://example.org/thread)'

describe('the "Requested by" line in a PR description', () => {
  it('accepts the founder, as the tooling writes the line', () => {
    expect(requestedByProblems(`_Requested by **the founder** · ${thread}_`)).toEqual([])
    expect(requestedByProblems('Requested by the founder')).toEqual([])
  })

  it('accepts another role title', () => {
    expect(requestedByProblems('Requested by the Head of Delivery.')).toEqual([])
    expect(requestedByProblems('Requested by: the founder')).toEqual([])
    expect(requestedByProblems('Requested by — the founder')).toEqual([])
  })

  it('refuses a first name in the tooling line', () => {
    const body = `<!-- attribution -->\n_Requested by **Testname** · ${thread}_\n\nBuilt by Test Persona`
    expect(requestedByProblems(body)).toEqual([
      'line 2: "Requested by" must name a role, such as "the founder", never a person',
    ])
  })

  it('refuses a name however it is formatted', () => {
    for (const line of [
      'Requested by Testname',
      '**Requested by** Testname Example',
      '> Requested by `Testname`',
      `requested by Testname ${thread}`,
      'Requested by: Testname',
      'Requested by — Testname',
      'Requested by - Testname',
      '_Requested by:_ **Testname**',
    ]) {
      expect(requestedByProblems(line)).toHaveLength(1)
    }
  })

  it('refuses a line with no one named', () => {
    expect(requestedByProblems(`_Requested by ** ** · ${thread}_`)).toHaveLength(1)
  })

  it('leaves prose further into a line, and descriptions without the line, alone', () => {
    expect(requestedByProblems('Built by Test Persona\n\nCloses #1')).toEqual([])
    expect(requestedByProblems('This was requested by Testname last week.')).toEqual([])
    expect(requestedByProblems('')).toEqual([])
  })

  it('counts lines in a description with Windows line endings', () => {
    expect(requestedByProblems('Built by Test Persona\r\nRequested by Testname')[0]).toMatch(
      /^line 2:/,
    )
  })
})
