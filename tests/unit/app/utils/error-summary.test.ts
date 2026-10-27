import { describe, expect, it } from 'vitest'
import { fieldId } from '../../../../app/utils/error-summary'

describe('error summary', () => {
  it('turns API field names into page ids', () => {
    expect(fieldId('callName')).toBe('field-callName')
    expect(fieldId('checks.over_18')).toBe('field-checks-over_18')
    expect(fieldId('answers.why_trustee')).toBe('field-answers-why_trustee')
  })
})
