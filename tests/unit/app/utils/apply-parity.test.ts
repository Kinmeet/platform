import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDraft, readSendResponse, stepErrors } from '../../../../app/utils/apply-flow'
import { RATE_LIMIT_PERIOD_SECONDS } from '../../../../server/utils/forms/rate-limit'
import { toFieldErrors } from '../../../../shared/forms/errors'
import { helloSchema } from '../../../../shared/forms/hello'
import type { PublicForm } from '../../../../shared/forms/view'
import { loadPublicForm } from '../../helpers/stored-forms'

// The page and the API must agree exactly (ADR-0005, Theo on #78). Step 2
// uses the shared field schemas from #44; this table runs the same inputs
// through the page and the server's schema, so they can never drift.
const serverFields = helloSchema.pick({ callName: true, email: true })

let trustee: PublicForm
beforeAll(async () => {
  trustee = await loadPublicForm('trustee')
})

function serverCodes(callName: string, email: string) {
  const result = serverFields.safeParse({ callName, email })
  if (result.success) return []
  const mapped = toFieldErrors(result.error.issues, { callName, email })
  return mapped.ok ? mapped.errors : 'bad_request'
}

function pageCodes(callName: string, email: string) {
  const draft = createDraft(trustee, '00000000-0000-4000-8000-000000000000')
  draft.callName = callName
  draft.email = email
  return stepErrors(draft, trustee, 2)
}

describe('step 2 matches the API', () => {
  it.each([
    ['Test Applicant', 'test.applicant@example.com'],
    ['  Sample Group  ', ' sample+group@mail.example.org '],
    ['', ''],
    ['   ', 'test@example'],
    ['x'.repeat(60), 'a@b.co'],
    ['x'.repeat(61), `${'a'.repeat(250)}@b.co`],
    ['🦊'.repeat(60), 'test@@example.com'],
    ['Test Applicant', 'test @example.com'],
    ['Test Applicant', 'test@example.com\r\nBcc: someone@example.com'],
    ['Test Applicant', 'test@exa\u0000mple.com'],
    ['Test Applicant', '@example.com'],
    ['Test Applicant', 'test@example..com'],
  ])('%j and %j', (callName, email) => {
    expect(pageCodes(callName, email)).toEqual(serverCodes(callName, email))
  })
})

describe('the rate limit fallback', () => {
  it("waits the API's own period when it doesn't say", () => {
    expect(readSendResponse(429, null, trustee)).toEqual({
      kind: 'rate_limited',
      retryAfter: RATE_LIMIT_PERIOD_SECONDS,
    })
  })
})

describe('the shared schemas', () => {
  // Zod's eval test is a script-src violation in the browser (P5).
  it('never compile with eval', () => {
    expect(z.config().jitless).toBe(true)
  })
})
