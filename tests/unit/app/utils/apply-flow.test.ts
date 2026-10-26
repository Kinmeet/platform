import { describe, expect, it } from 'vitest'
import {
  allowedStep,
  clearDraft,
  createDraft,
  errorMessage,
  furthestStep,
  readSendResponse,
  redirectReason,
  stepErrors,
  stepForField,
  stopReason,
  toRequest,
  type ApplicationDraft,
} from '../../../../app/utils/apply-flow'
import en from '../../../../i18n/locales/en-GB.json'
import { trustee } from '../../../../shared/forms/roles/trustee'

const ID = '00000000-0000-4000-8000-000000000000'

/** A trustee draft filled to the end of a step, with made-up answers. */
function draftUpTo(step: 0 | 1 | 2 | 3): ApplicationDraft {
  const draft = createDraft(trustee, ID)
  if (step >= 1) {
    draft.checks = { over_18: 'yes', connection_to_founders: 'no', trustee_rules_confirmed: 'yes' }
  }
  if (step >= 2) {
    draft.callName = 'Test Applicant'
    draft.email = 'test.applicant@example.com'
  }
  if (step >= 3) draft.answers = { why_trustee: 'Made-up reason for testing.' }
  return draft
}

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en)
}

describe('apply flow: steps and guards', () => {
  it('starts at step 1 with a UUID v4 submission id', () => {
    const draft = createDraft(trustee)
    expect(draft.role).toBe('trustee')
    expect(draft.submissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(furthestStep(draft, trustee)).toBe(1)
  })

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
  ] as const)('after step %i is done, the furthest step is %i', (done, furthest) => {
    expect(furthestStep(draftUpTo(done), trustee)).toBe(furthest)
  })

  it('never opens a later step directly', () => {
    expect(allowedStep('4', draftUpTo(0), trustee)).toBe(1)
    expect(allowedStep('4', draftUpTo(1), trustee)).toBe(2)
    expect(allowedStep('3', draftUpTo(3), trustee)).toBe(3)
    expect(allowedStep('4', draftUpTo(3), trustee)).toBe(4)
  })

  it('treats a missing or odd step as step 1', () => {
    for (const asked of [undefined, '', '0', '5', '2.5', 'two', ['2'], null]) {
      expect(allowedStep(asked, draftUpTo(3), trustee)).toBe(1)
    }
  })

  it('stays on step 1 when an answer stops the flow', () => {
    const draft = draftUpTo(3)
    draft.checks.over_18 = 'no'
    expect(stopReason(draft, trustee)).toBe('under_18')
    expect(allowedStep('4', draft, trustee)).toBe(1)

    draft.checks.over_18 = 'yes'
    draft.checks.connection_to_founders = 'related_or_household'
    expect(stopReason(draft, trustee)).toBe('not_independent')
  })

  it('lets notes-only answers carry on', () => {
    const draft = draftUpTo(3)
    for (const answer of ['friend_or_acquaintance', 'not_sure']) {
      draft.checks.connection_to_founders = answer
      expect(stopReason(draft, trustee)).toBeUndefined()
      expect(furthestStep(draft, trustee)).toBe(4)
    }
  })
})

describe('apply flow: why the guard moved the visitor', () => {
  it('says nothing when the step asked for is shown', () => {
    expect(redirectReason(undefined, draftUpTo(0), trustee)).toBeUndefined()
    expect(redirectReason('3', draftUpTo(2), trustee)).toBeUndefined()
  })

  it('says the flow restarted when nothing is answered, as after a reload', () => {
    expect(redirectReason('3', draftUpTo(0), trustee)).toBe('restarted')
  })

  it('says a step needs finishing when some answers are there', () => {
    expect(redirectReason('4', draftUpTo(1), trustee)).toBe('earlier_step')
  })

  it('leaves a stopped flow to its stop message', () => {
    const draft = draftUpTo(1)
    draft.checks.over_18 = 'no'
    expect(redirectReason('2', draft, trustee)).toBeUndefined()
  })
})

describe('apply flow: checking each step', () => {
  it('asks for every step 1 answer and refuses choices that do not exist', () => {
    expect(stepErrors(draftUpTo(0), trustee, 1).map((error) => error.field)).toEqual([
      'checks.over_18',
      'checks.connection_to_founders',
      'checks.trustee_rules_confirmed',
    ])
    const draft = draftUpTo(1)
    draft.checks.over_18 = 'maybe'
    expect(stepErrors(draft, trustee, 1)).toEqual([
      { field: 'checks.over_18', code: 'invalid_choice' },
    ])
  })

  it('checks the name and email on step 2, after trimming', () => {
    const draft = draftUpTo(1)
    draft.callName = '   '
    draft.email = 'test.applicant@example'
    expect(stepErrors(draft, trustee, 2)).toEqual([
      { field: 'callName', code: 'required' },
      { field: 'email', code: 'invalid_email' },
    ])
    draft.callName = 'x'.repeat(61)
    draft.email = `${'x'.repeat(250)}@example.com`
    expect(stepErrors(draft, trustee, 2)).toEqual([
      { field: 'callName', code: 'too_long' },
      { field: 'email', code: 'too_long' },
    ])
  })

  it('counts a 60-character name in code points', () => {
    const draft = draftUpTo(2)
    draft.callName = '🦊'.repeat(60)
    expect(stepErrors(draft, trustee, 2)).toEqual([])
  })

  it('needs required answers on step 3 and caps every answer', () => {
    const draft = draftUpTo(2)
    expect(stepErrors(draft, trustee, 3)).toEqual([
      { field: 'answers.why_trustee', code: 'required' },
    ])
    draft.answers = { why_trustee: 'Fine.', experience: 'x'.repeat(2001) }
    expect(stepErrors(draft, trustee, 3)).toEqual([
      { field: 'answers.experience', code: 'too_long' },
    ])
  })
})

describe('apply flow: clearing', () => {
  it('empties every answer and starts a new submission id', () => {
    const draft = draftUpTo(3)
    clearDraft(draft, '11111111-1111-4111-8111-111111111111')
    expect(draft).toEqual({
      role: 'trustee',
      submissionId: '11111111-1111-4111-8111-111111111111',
      checks: {},
      callName: '',
      email: '',
      answers: {},
    })
    expect(furthestStep(draft, trustee)).toBe(1)
  })
})

describe('apply flow: sending', () => {
  it('builds the request the contract describes', () => {
    const draft = draftUpTo(3)
    draft.callName = '  Test Applicant  '
    draft.answers.experience = '   '
    expect(toRequest(draft, trustee, 'token-for-testing')).toEqual({
      submissionId: ID,
      role: 'trustee',
      checks: { over_18: 'yes', connection_to_founders: 'no', trustee_rules_confirmed: 'yes' },
      callName: 'Test Applicant',
      email: 'test.applicant@example.com',
      answers: { why_trustee: 'Made-up reason for testing.' },
      turnstileToken: 'token-for-testing',
    })
  })

  it('never sends answers to questions the role does not have', () => {
    const draft = draftUpTo(3)
    draft.answers.not_a_question = 'stray'
    draft.checks.not_a_check = 'stray'
    const body = toRequest(draft, trustee, 'token')
    expect(Object.keys(body.answers)).toEqual(['why_trustee'])
    expect(Object.keys(body.checks)).not.toContain('not_a_check')
  })

  it('keeps the same submission id on every attempt', () => {
    const draft = draftUpTo(3)
    expect(toRequest(draft, trustee, 'one').submissionId).toBe(
      toRequest(draft, trustee, 'two').submissionId,
    )
  })
})

describe('apply flow: reading the reply', () => {
  it('treats 201 and a repeat 200 as sent', () => {
    expect(readSendResponse(201, { ok: true, receipt: 'queued' })).toEqual({ kind: 'sent' })
    expect(readSendResponse(200, { ok: true, receipt: 'queued' })).toEqual({ kind: 'sent' })
  })

  it("sends 422 field errors back to the earliest step with a problem, keeping only that step's errors", () => {
    const outcome = readSendResponse(422, {
      ok: false,
      errors: [
        { field: 'answers.why_trustee', code: 'too_long' },
        { field: 'email', code: 'invalid_email' },
      ],
    })
    // Only step 2's error: the summary on step 2 can't link to a step 3 field.
    expect(outcome).toEqual({
      kind: 'invalid',
      step: 2,
      errors: [{ field: 'email', code: 'invalid_email' }],
    })
  })

  it('ends on the stop page for the server backstops', () => {
    expect(
      readSendResponse(422, { ok: false, errors: [{ field: 'checks.over_18', code: 'under_18' }] }),
    ).toEqual({ kind: 'stopped', reason: 'under_18' })
    expect(
      readSendResponse(422, {
        ok: false,
        errors: [{ field: 'checks.connection_to_founders', code: 'not_independent' }],
      }),
    ).toEqual({ kind: 'stopped', reason: 'not_independent' })
  })

  it('asks for a fresh spam check on 403 turnstile_failed', () => {
    expect(
      readSendResponse(403, {
        ok: false,
        errors: [{ field: 'turnstileToken', code: 'turnstile_failed' }],
      }),
    ).toEqual({ kind: 'turnstile_failed' })
  })

  it('passes on the wait for 429, with a minute if none is given', () => {
    expect(readSendResponse(429, { ok: false, error: 'rate_limited', retryAfter: 30 })).toEqual({
      kind: 'rate_limited',
      retryAfter: 30,
    })
    expect(readSendResponse(429, null)).toEqual({ kind: 'rate_limited', retryAfter: 60 })
  })

  it.each([
    [400, { ok: false, error: 'bad_request' }],
    [500, { ok: false, error: 'unavailable' }],
    [503, undefined],
    [0, undefined],
    [422, { ok: false, errors: [{ field: 'role', code: 'role_closed' }] }],
    [422, { ok: false, errors: [{ field: 'answers.extra', code: 'unknown_field' }] }],
    [422, { ok: false, errors: 'not a list' }],
    [422, { ok: false, errors: [{ field: 1, code: 'required' }] }],
    [403, { ok: false }],
  ])('treats %i %j as a failed send', (status, body) => {
    expect(readSendResponse(status, body)).toEqual({ kind: 'failed' })
  })

  it('knows which step holds each field', () => {
    expect(stepForField('checks.over_18')).toBe(1)
    expect(stepForField('callName')).toBe(2)
    expect(stepForField('email')).toBe(2)
    expect(stepForField('answers.experience')).toBe(3)
    expect(stepForField('turnstileToken')).toBe(4)
  })
})

describe('apply flow: error wording', () => {
  const fields: [string, string[]][] = [
    ...trustee.apply.checks.map((check): [string, string[]] => [
      `checks.${check.id}`,
      ['required', 'invalid_choice'],
    ]),
    ['callName', ['required', 'too_long']],
    ['email', ['required', 'too_long', 'invalid_email']],
    ...trustee.apply.questions.map((question): [string, string[]] => [
      `answers.${question.id}`,
      ['required', 'too_long'],
    ]),
  ]

  it('has a message and a question label for every error the page or the server can give', () => {
    expect(typeof lookup('apply.errors.summary_item')).toBe('string')
    for (const [field, codes] of fields) {
      for (const code of codes) {
        const { key, questionKey } = errorMessage({ field, code }, trustee)
        expect(typeof lookup(key), `${field} ${code} → ${key}`).toBe('string')
        expect(typeof lookup(questionKey), `${field} → ${questionKey}`).toBe('string')
      }
    }
  })

  it('names the question, so summary items are never identical', () => {
    const labels = trustee.apply.checks.map(
      (check) =>
        errorMessage({ field: `checks.${check.id}`, code: 'required' }, trustee).questionKey,
    )
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('uses the tick-box message for confirm questions', () => {
    expect(
      errorMessage({ field: 'checks.trustee_rules_confirmed', code: 'required' }, trustee).key,
    ).toBe('apply.errors.confirm_required')
    expect(errorMessage({ field: 'checks.over_18', code: 'required' }, trustee).key).toBe(
      'apply.errors.choice_required',
    )
  })

  it('gives the limit for answers and names that are too long', () => {
    const experience = trustee.apply.questions.find((question) => question.id === 'experience')
    expect(errorMessage({ field: 'answers.experience', code: 'too_long' }, trustee)).toEqual({
      key: 'apply.errors.answer_too_long',
      params: { max: experience?.maxLength },
      questionKey: 'roles.trustee.questions.experience.summary',
    })
    expect(errorMessage({ field: 'callName', code: 'too_long' }, trustee).params).toEqual({
      max: 60,
    })
  })
})
