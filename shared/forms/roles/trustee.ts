import type { PublishedRole } from './types'

/** Trustee: the only role open in Sprint 1 (Q3). Ids from docs/api/forms.md. */
export const trustee = {
  slug: 'trustee',
  published: true,
  tags: [
    { id: 'volunteer', style: 'info' },
    { id: 'how_many', style: 'info' },
    { id: 'time', style: 'info' },
  ],
  page: {
    sections: ['involves', 'asks', 'gets', 'good_to_know'],
    glance: ['paid', 'how_many', 'time', 'checks', 'you_need'],
    next: ['reply', 'chat', 'references', 'yes'],
  },
  apply: {
    checks: [
      {
        id: 'over_18',
        type: 'single_choice',
        required: true,
        choices: ['yes', 'no'],
        outcomes: { no: { stop: 'under_18' } },
      },
      {
        // F3: trustees are independent of each other. Rowan decided the four
        // outcomes on 25 October (#16).
        id: 'connection_to_founders',
        type: 'single_choice',
        required: true,
        choices: ['no', 'related_or_household', 'friend_or_acquaintance', 'not_sure'],
        outcomes: {
          related_or_household: { stop: 'not_independent' },
          friend_or_acquaintance: { note: true },
          not_sure: { note: true },
        },
      },
      {
        id: 'trustee_rules_confirmed',
        type: 'confirm',
        required: true,
        choices: ['yes'],
        link: 'https://www.gov.uk/guidance/automatic-disqualification-rules-for-charity-trustees-and-charity-senior-positions',
      },
    ],
    questions: [
      { id: 'why_trustee', type: 'long_text', required: true, maxLength: 2000 },
      { id: 'experience', type: 'long_text', required: false, maxLength: 2000 },
    ],
    note: true,
  },
} as const satisfies PublishedRole
