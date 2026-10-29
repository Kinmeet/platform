import type { PublishedRole } from './types'

/**
 * Trustee: the only role open in Sprint 1 (Q3). Its application form, with
 * its questions and wording, is the stored `trustee` form (ADR-0010).
 */
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
} as const satisfies PublishedRole
