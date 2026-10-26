import { describe, expect, it } from 'vitest'
import {
  addMonths,
  applicationDeleteAfterOutcome,
  applicationDeleteAfterReceipt,
  emailLogDeleteAfter,
  helloDeleteAfterReceipt,
  helloDeleteAfterReply,
  nowSeconds,
} from '../../../../server/utils/retention'

const at = (iso: string) => nowSeconds(new Date(iso))

describe('retention dates', () => {
  it('adds calendar months in UTC', () => {
    expect(addMonths(at('2026-10-25T21:30:00Z'), 12)).toBe(at('2027-10-25T21:30:00Z'))
    expect(addMonths(at('2026-10-25T00:00:00Z'), 6)).toBe(at('2027-04-25T00:00:00Z'))
  })

  it('clamps to the last day of a shorter month', () => {
    expect(addMonths(at('2026-08-31T12:00:00Z'), 6)).toBe(at('2027-02-28T12:00:00Z'))
    expect(addMonths(at('2027-08-31T12:00:00Z'), 6)).toBe(at('2028-02-29T12:00:00Z'))
    expect(addMonths(at('2028-02-29T12:00:00Z'), 12)).toBe(at('2029-02-28T12:00:00Z'))
  })

  it('keeps say hello messages 12 months after receipt, then after each reply', () => {
    expect(helloDeleteAfterReceipt(at('2026-11-01T09:00:00Z'))).toBe(at('2027-11-01T09:00:00Z'))
    expect(helloDeleteAfterReply(at('2027-01-15T09:00:00Z'))).toBe(at('2028-01-15T09:00:00Z'))
  })

  it('keeps applications until 6 months after the round closes by default', () => {
    const received = at('2026-11-01T09:00:00Z')
    const roundCloses = at('2027-01-31T23:59:59Z')
    expect(applicationDeleteAfterReceipt(received, roundCloses)).toBe(at('2027-07-31T23:59:59Z'))
  })

  it('counts from receipt if the round has already closed', () => {
    const received = at('2027-02-10T09:00:00Z')
    const roundCloses = at('2027-01-31T23:59:59Z')
    expect(applicationDeleteAfterReceipt(received, roundCloses)).toBe(at('2027-08-10T09:00:00Z'))
  })

  it('keeps applications 6 months after the outcome is told', () => {
    expect(applicationDeleteAfterOutcome(at('2027-02-01T10:00:00Z'))).toBe(
      at('2027-08-01T10:00:00Z'),
    )
  })

  it('keeps the email log for 30 days', () => {
    expect(emailLogDeleteAfter(at('2026-11-01T09:00:00Z'))).toBe(at('2026-12-01T09:00:00Z'))
  })
})
