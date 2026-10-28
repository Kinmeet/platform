import { describe, expect, it } from 'vitest'
import {
  FORM_BODY_CAP_MAX,
  LIMITS,
  definitionSchema,
  type FormDefinition,
} from '../../../../shared/forms/definition'
import {
  TEXT_LIMITS,
  checkPublish,
  copyProblems,
  needsSecondApproval,
  type PublishCandidate,
} from '../../../../shared/forms/publish'
import { ROLE_SLUG_MAX, bodyCapFor } from '../../../../shared/forms/runtime'
import { bodyLimitFor, submitPathFor } from '../../../../shared/routes'

// The publish checks (ADR-0010, #156): every limit has a refused case, so an
// admin can never publish past what reviewed code allows (Nadia). Made-up
// test wording only.

type Json = Record<string, unknown>

function baseDefinition(): Json {
  return {
    steps: [
      {
        id: 'about_the_group',
        body: 'answers',
        fields: [
          {
            id: 'has_group',
            type: 'single_choice',
            required: true,
            choices: ['yes', 'no'],
            outcomes: { no: { note: true } },
          },
          {
            id: 'group_name',
            type: 'short_text',
            required: true,
            maxLength: 80,
            showIf: { field: 'has_group', in: ['yes'] },
          },
          { id: 'message', type: 'long_text', required: true, maxLength: 1000 },
        ],
      },
    ],
    aboutYou: 0,
    note: false,
    receipt: 'none',
    actions: ['outcome_told', 'pass_to_safeguarding'],
    readers: ['secretary', 'chair'],
  }
}

function baseText(): Json {
  return {
    'en-GB': {
      title: 'Sample form',
      'fields.has_group.label': 'Do you already run a group?',
      'fields.has_group.summary': 'Runs a group',
      'fields.has_group.choices.yes': 'Yes',
      'fields.has_group.choices.no': 'No',
      'fields.has_group.notes.no': 'That is fine.',
      'fields.group_name.label': 'What is the group called?',
      'fields.group_name.summary': 'Group name',
      'fields.message.label': 'Your message',
      'fields.message.summary': 'Your message',
    },
  }
}

function candidate(
  change: (c: PublishCandidate & { definition: Json; text: Json }) => void = () => {},
) {
  const c = {
    slug: 'sample-form',
    kind: 'application' as 'form' | 'application',
    purpose: 'trustee_application',
    definition: baseDefinition(),
    text: baseText(),
  }
  change(c)
  return c
}

const fields = (c: { definition: Json }) => (c.definition.steps as { fields: Json[] }[])[0]!.fields
const text = (c: { text: Json }) => c.text['en-GB'] as Record<string, string>

function codes(c: PublishCandidate) {
  return checkPublish(c, null)
    .problems.map((problem) => problem.code)
    .filter((code) => code !== 'second_approval_needed')
}

describe('a version within every limit', () => {
  it('passes, apart from the second approval a new form always needs', () => {
    const check = checkPublish(candidate(), null)
    expect(check.problems).toEqual([{ code: 'second_approval_needed', path: 'definition' }])
    expect(check.ok).toBe(false)
    expect(check.needsSecondApproval).toBe(true)
  })

  it('publishes a wording change alone', () => {
    const previous = {
      purpose: 'trustee_application',
      definition: definitionSchema.parse(baseDefinition()),
      text: baseText(),
    }
    const reworded = candidate((c) => {
      text(c).title = 'Tell us about a sample group'
    })
    expect(checkPublish(reworded, previous)).toEqual({
      ok: true,
      problems: [],
      needsSecondApproval: false,
    })
  })
})

describe('refused: limits on the definition', () => {
  const steps = (count: number) =>
    [...Array(count)].map((_, i) => ({
      id: `step_${i}`,
      body: i === 0 ? null : ['checks', 'answers'][i % 2],
      fields: [{ id: `text_${i}`, type: 'long_text', required: true, maxLength: 10 }],
    }))

  it.each<[string, (c: { definition: Json; text: Json }) => void, string]>([
    ['more than 4 steps', (c) => void (c.definition.steps = steps(5)), 'definition_too_big'],
    ['no steps', (c) => void (c.definition.steps = []), 'definition_too_small'],
    [
      'more than 10 fields in a step',
      (c) =>
        fields(c).push(
          ...[...Array(8)].map((_, i) => ({
            id: `extra_${i}`,
            type: 'short_text',
            required: false,
            maxLength: 10,
          })),
        ),
      'definition_too_big',
    ],
    [
      'more than 10 choices',
      (c) => void (fields(c)[0]!.choices = [...Array(11)].map((_, i) => `choice_${i}`)),
      'definition_too_big',
    ],
    ['fewer than 2 choices', (c) => void (fields(c)[0]!.choices = ['yes']), 'definition_too_small'],
    [
      'an id over 40 characters',
      (c) => void (fields(c)[2]!.id = 'a'.repeat(41)),
      'definition_too_big',
    ],
    [
      'an id that is not plain',
      (c) => void (fields(c)[2]!.id = 'Message!'),
      'definition_invalid_format',
    ],
    ['an id the request already uses', (c) => void (fields(c)[2]!.id = 'email'), 'reserved_id'],
    [
      'a short text over its hard maximum',
      (c) => void (fields(c)[1]!.maxLength = LIMITS.maxLength.short_text + 1),
      'definition_too_big',
    ],
    [
      'a long text over its hard maximum',
      (c) => void (fields(c)[2]!.maxLength = LIMITS.maxLength.long_text + 1),
      'definition_too_big',
    ],
    [
      'a type not in the library',
      (c) => void (fields(c)[2]!.type = 'date'),
      'definition_invalid_union',
    ],
    [
      'a stop reason not on the fixed list',
      (c) => void (fields(c)[0]!.outcomes = { no: { stop: 'too_tall' } }),
      'definition_invalid_union',
    ],
    [
      'every choice stopping',
      (c) =>
        void (fields(c)[0]!.outcomes = { yes: { stop: 'under_18' }, no: { stop: 'under_18' } }),
      'every_choice_stops',
    ],
    [
      'an outcome for no choice',
      (c) => void (fields(c)[0]!.outcomes = { maybe: { note: true } }),
      'unknown_choice',
    ],
    ['two fields with one id', (c) => void (fields(c)[2]!.id = 'group_name'), 'duplicate_field'],
    [
      'a show-if on a later field',
      (c) => void (fields(c)[1]!.showIf = { field: 'message', in: ['yes'] }),
      'show_if_target',
    ],
    [
      'a show-if on a text field',
      (c) => {
        fields(c)[2]!.showIf = { field: 'group_name', in: ['yes'] }
      },
      'show_if_target',
    ],
    [
      'a show-if question away from its trigger on the same step',
      (c) => {
        const [choice, revealed, message] = fields(c)
        c.definition.steps = [
          { id: 'about_the_group', body: 'answers', fields: [choice, message, revealed] },
        ]
      },
      'show_if_not_next',
    ],
    [
      'a show-if on a choice the field does not have',
      (c) => void (fields(c)[1]!.showIf = { field: 'has_group', in: ['maybe'] }),
      'show_if_choice',
    ],
    [
      'a link to anywhere but GOV.UK',
      (c) =>
        void fields(c).push({
          id: 'read_rules',
          type: 'confirm',
          required: true,
          link: 'https://example.com/rules',
        }),
      'link_not_allowed',
    ],
    [
      'a GOV.UK link over plain HTTP',
      (c) =>
        void fields(c).push({
          id: 'read_rules',
          type: 'confirm',
          required: true,
          link: 'http://www.gov.uk/rules',
        }),
      'link_not_allowed',
    ],
    [
      'an optional tick',
      (c) => void fields(c).push({ id: 'read_rules', type: 'confirm', required: false }),
      'definition_invalid_value',
    ],
    ['an unknown key', (c) => void (c.definition.script = 'x'), 'definition_unrecognized_keys'],
    [
      'a reader not in P4',
      (c) => void (c.definition.readers = ['everyone']),
      'definition_invalid_value',
    ],
    ['"About you" past the end', (c) => void (c.definition.aboutYou = 2), 'about_you_position'],
  ])('%s', (_name, change, code) => {
    expect(codes(candidate(change))).toContain(code)
  })

  it('a definition over its size limit', () => {
    const big = candidate((c) => void (c.definition.padding = 'x'.repeat(LIMITS.definitionJson)))
    expect(codes(big)).toEqual(['definition_too_large'])
  })
})

describe('refused: the purpose, readers, retention and SG6', () => {
  it.each<[string, (c: PublishCandidate & { definition: Json; text: Json }) => void, string]>([
    ['an unknown purpose', (c) => void (c.purpose = 'mailing_list'), 'purpose_unknown'],
    ['a purpose for another kind of form', (c) => void (c.purpose = 'say_hello'), 'purpose_kind'],
    [
      'a field type the purpose does not allow',
      (c) => void fields(c).push({ id: 'contact', type: 'email', required: false }),
      'field_type_not_allowed',
    ],
    [
      'a wider set of readers',
      (c) => void (c.definition.readers = ['trustee']),
      'reader_not_allowed',
    ],
    ['a longer retention', (c) => void (c.definition.retentionMonths = 7), 'retention_too_long'],
    [
      'free text without "pass to safeguarding"',
      (c) => void (c.definition.actions = ['outcome_told']),
      'safeguarding_action_missing',
    ],
    [
      'an action the purpose has no date for',
      (c) => void (c.definition.actions = ['reply', 'pass_to_safeguarding']),
      'action_not_allowed',
    ],
    [
      'an application receipt on a form',
      (c) => {
        c.kind = 'form'
        c.definition.receipt = 'application_receipt'
      },
      'receipt_not_allowed',
    ],
    ['a slug that is not plain', (c) => void (c.slug = 'Sample Form'), 'slug_invalid'],
    ['a slug over 32 characters', (c) => void (c.slug = 'a'.repeat(33)), 'slug_invalid'],
    ['a reserved slug', (c) => void (c.slug = 'admin'), 'slug_reserved'],
  ])('%s', (_name, change, code) => {
    expect(codes(candidate(change))).toContain(code)
  })

  it('accepts a shorter retention and fewer readers', () => {
    const narrower = candidate((c) => {
      c.definition.retentionMonths = 3
      c.definition.readers = ['chair']
    })
    expect(codes(narrower)).toEqual([])
  })
})

describe('refused: the body cap', () => {
  /** A form whose text fields add up to `total` code points. */
  function withAnswerTotal(total: number) {
    // An application, since only `/api/apply` takes the largest cap.
    return candidate((c) => {
      c.definition.steps = [...Array(4)].map((_, s) => ({
        id: `step_${s}`,
        body: [null, 'checks', 'answers'][s] ?? null,
        fields: [],
      }))
      const ids: string[] = []
      let left = total
      for (let s = 0; s < 3; s++) {
        const step = (c.definition.steps as { fields: Json[] }[])[s]!
        for (let f = 0; f < LIMITS.fieldsPerStep && left > 0; f++) {
          const size = Math.min(LIMITS.maxLength.long_text, left)
          left -= size
          const id = `text_${s}_${f}`
          ids.push(id)
          step.fields.push({ id, type: 'long_text', required: true, maxLength: size })
        }
      }
      c.definition.steps = (c.definition.steps as { fields: Json[] }[]).filter(
        (step) => step.fields.length > 0,
      )
      c.text = {
        'en-GB': Object.fromEntries([
          ['title', 'Sample form'],
          ...ids.flatMap((id) => [
            [`fields.${id}.label`, `A made-up question ${id}`],
            [`fields.${id}.summary`, `Answer ${id}`],
          ]),
        ]),
      }
    })
  }

  // The fixed parts of every body: the submission id, role, call name, email and token.
  const fixed = 36 + ROLE_SLUG_MAX + 60 + 254 + 2048
  const largestAllowed = (FORM_BODY_CAP_MAX - 4096) / 4 - fixed

  it('fits the largest allowed version inside the fixed cap and the entry limit', () => {
    const largest = withAnswerTotal(largestAllowed)
    expect(codes(largest)).toEqual([])
    const definition = definitionSchema.parse(largest.definition)
    expect(bodyCapFor(definition, 'application')).toBe(FORM_BODY_CAP_MAX)
    expect(FORM_BODY_CAP_MAX).toBeLessThanOrEqual(bodyLimitFor('POST', '/api/apply'))
  })

  it('refuses a version one character over', () => {
    expect(codes(withAnswerTotal(largestAllowed + 1))).toEqual([
      'body_cap_too_large',
      'body_cap_over_route_limit',
    ])
  })

  // A body over the route's entry limit gets a 413 before the route sees it
  // (ADR-0008), so publishing refuses it (Nadia, #158).
  it('refuses say hello over its own route limit', () => {
    const helloLimit = bodyLimitFor('POST', submitPathFor('hello', 'form'))
    const over = (helloLimit - 4096) / 4 - (36 + 60 + 254 + 2048) + 1
    const hello = candidate((c) => {
      c.slug = 'hello'
      c.kind = 'form'
      c.purpose = 'say_hello'
      c.definition.actions = ['reply', 'pass_to_safeguarding']
      c.definition.readers = ['central_team']
      const half = Math.ceil(over / 2)
      c.definition.steps = [
        {
          id: 'message',
          body: null,
          fields: [
            { id: 'message', type: 'long_text', required: true, maxLength: half },
            { id: 'more', type: 'long_text', required: false, maxLength: over - half },
          ],
        },
      ]
      c.text = {
        'en-GB': {
          title: 'Say hello',
          'fields.message.label': 'Your message',
          'fields.message.summary': 'Your message',
          'fields.more.label': 'Anything else to add',
          'fields.more.summary': 'Anything else',
        },
      }
    })
    expect(codes(hello)).toContain('body_cap_over_route_limit')
    expect(codes(hello)).not.toContain('body_cap_too_large')
  })

  it('refuses a form with no route of its own yet', () => {
    expect(submitPathFor('sample-form', 'form')).toBe('/api/forms/sample-form')
    expect(bodyLimitFor('POST', '/api/forms/sample-form')).toBe(1024)
    const form = withAnswerTotal(100)
    form.kind = 'form'
    form.purpose = 'say_hello'
    form.definition.actions = ['reply', 'pass_to_safeguarding']
    form.definition.readers = ['central_team']
    expect(codes(form)).toEqual(['body_cap_over_route_limit'])
  })
})

describe('refused: the text', () => {
  it.each<[string, (c: { text: Json }) => void, string]>([
    ['a missing label', (c) => void delete text(c)['fields.message.label'], 'text_missing'],
    ['a missing choice', (c) => void delete text(c)['fields.has_group.choices.no'], 'text_missing'],
    ['a missing note', (c) => void delete text(c)['fields.has_group.notes.no'], 'text_missing'],
    [
      'a key for nothing',
      (c) => void (text(c)['fields.nothing.label'] = 'Made up'),
      'text_unknown_key',
    ],
    ['an empty label', (c) => void (text(c)['fields.message.label'] = '   '), 'text_empty'],
    ['text that is not text', (c) => void ((text(c) as Json).title = 5), 'text_empty'],
    ['a locale we do not publish', (c) => void (c.text.cy = {}), 'locale_not_allowed'],
    ['no en-GB', (c) => void delete c.text['en-GB'], 'locale_missing'],
    [
      'a title over its limit',
      (c) => void (text(c).title = 'x'.repeat(TEXT_LIMITS.title + 1)),
      'text_too_long',
    ],
    [
      'a label over its limit',
      (c) => void (text(c)['fields.message.label'] = 'x'.repeat(TEXT_LIMITS.label + 1)),
      'text_too_long',
    ],
    [
      'a hint over its limit',
      (c) => void (text(c)['fields.message.hint'] = 'x'.repeat(TEXT_LIMITS.hint + 1)),
      'text_too_long',
    ],
    [
      'a choice over its limit',
      (c) => void (text(c)['fields.has_group.choices.no'] = 'x'.repeat(TEXT_LIMITS.choice + 1)),
      'text_too_long',
    ],
    ['a banned term', (c) => void (text(c).title = 'Join our local chapter'), 'banned_term'],
    ['a US spelling', (c) => void (text(c).title = 'Our favorite color'), 'us_spelling'],
    [
      'a label asking for a password',
      (c) => void (text(c)['fields.message.label'] = 'Enter your password'),
      'asks_for_credentials',
    ],
    [
      'a label asking for bank details',
      (c) => void (text(c)['fields.message.label'] = 'Your sort code and account number'),
      'asks_for_credentials',
    ],
    [
      'a label asking for a code',
      (c) => void (text(c)['fields.message.label'] = 'Type the verification code we sent'),
      'asks_for_credentials',
    ],
    // Nadia, #158: wider credential words, and text that hides a word.
    ...(
      [
        'Your sign-in details',
        'Your credit card',
        'Your bank account',
        'Your IBAN',
        'Answers to your security questions',
      ] as const
    ).map((label): [string, (c: { text: Json }) => void, string] => [
      `a label asking for "${label}"`,
      (c) => void (text(c)['fields.message.label'] = label),
      'asks_for_credentials',
    ]),
    [
      'a banned term split by a zero-width space',
      (c) => void (text(c).title = 'Join our local chap\u200Bter'),
      'banned_term',
    ],
    [
      'a credential word in full-width letters',
      (c) => void (text(c)['fields.message.label'] = 'Your ｐａｓｓｗｏｒｄ'),
      'asks_for_credentials',
    ],
    // Robin, #158: the commonest barriers an admin could make.
    [
      'two labels on one step that read the same',
      (c) => void (text(c)['fields.message.label'] = 'What is the group called'),
      'duplicate_label',
    ],
    [
      'two choices that read the same',
      (c) => void (text(c)['fields.has_group.choices.no'] = 'yes.'),
      'duplicate_choice_text',
    ],
    [
      'a hint that repeats its label',
      (c) => void (text(c)['fields.message.hint'] = 'Your message.'),
      'hint_repeats_label',
    ],
    [
      'a one-word summary',
      (c) => void (text(c)['fields.message.summary'] = 'Why'),
      'summary_too_short',
    ],
    [
      'two summaries that read the same',
      (c) => void (text(c)['fields.message.summary'] = 'group name'),
      'duplicate_summary',
    ],
  ])('%s', (_name, change, code) => {
    expect(codes(candidate(change))).toContain(code)
  })

  it.each(['here', 'Click here', 'read more', 'https://www.gov.uk/guidance', 'www.gov.uk'])(
    'link text that says nothing about where it goes: %s',
    (words) => {
      const linked = candidate((c) => {
        fields(c).push({
          id: 'rules_read',
          type: 'confirm',
          required: true,
          link: 'https://www.gov.uk/guidance/sample',
        })
        Object.assign(text(c), {
          'fields.rules_read.label': 'I have read the rules',
          'fields.rules_read.summary': 'Rules read',
          'fields.rules_read.choices.yes': 'Read',
          'fields.rules_read.link': words,
        })
      })
      expect(codes(linked)).toEqual(['vague_link_text'])
    },
  )

  it('needs a heading for a top-level step in a form with more than one step', () => {
    const twoSteps = candidate((c) => {
      c.definition.steps = [
        ...(c.definition.steps as Json[]),
        {
          id: 'more',
          body: null,
          fields: [{ id: 'anything_else', type: 'long_text', required: false, maxLength: 200 }],
        },
      ]
      Object.assign(text(c), {
        'fields.anything_else.label': 'Anything else to tell us?',
        'fields.anything_else.summary': 'Anything else',
      })
    })
    expect(codes(twoSteps)).toEqual(['text_missing'])
    text(twoSteps)['steps.more.heading'] = 'A little more'
    expect(codes(twoSteps)).toEqual([])
  })

  it('a text object over its size limit', () => {
    const big = candidate((c) => void (text(c).intro = 'x'.repeat(LIMITS.textJson)))
    expect(codes(big)).toContain('text_too_large')
  })

  it('passes plain British English with no problems', () => {
    expect(copyProblems('Tell us about your local group and its colours.')).toEqual([])
  })
})

describe('second approval (Ezra)', () => {
  const definition = (): FormDefinition => definitionSchema.parse(baseDefinition())
  const version = (change: (v: { definition: FormDefinition; text: Json }) => void = () => {}) => {
    const v = { purpose: 'trustee_application', definition: definition(), text: baseText() }
    change(v)
    return v
  }
  const previous = version()

  it('is needed for a new form', () => {
    expect(needsSecondApproval(null, version())).toBe(true)
  })

  it('is needed for a new or changed field, purpose or readers', () => {
    expect(
      needsSecondApproval(
        previous,
        version(({ definition }) =>
          definition.steps[0]!.fields.push({
            id: 'extra',
            type: 'short_text',
            required: false,
            maxLength: 5,
          }),
        ),
      ),
    ).toBe(true)
    expect(
      needsSecondApproval(
        previous,
        version(({ definition }) => {
          ;(definition.steps[0]!.fields[2] as { maxLength: number }).maxLength = 2000
        }),
      ),
    ).toBe(true)
    expect(needsSecondApproval(previous, { ...version(), purpose: 'say_hello' })).toBe(true)
    expect(
      needsSecondApproval(
        previous,
        version(({ definition }) => void (definition.readers = ['chair'])),
      ),
    ).toBe(true)
  })

  // Ezra, #160: anything that tells someone what to put in an answer.
  it.each([
    ['a label', 'fields.message.label', 'What would you like to say?'],
    ['a hint', 'fields.message.hint', 'A few made-up sentences is plenty.'],
    ['a summary', 'fields.message.summary', 'Your made-up message'],
    ['a choice', 'fields.has_group.choices.yes', 'Yes, a sample group'],
  ])('is needed when %s is reworded', (_, key, words) => {
    expect(
      needsSecondApproval(
        previous,
        version(({ text }) => void ((text['en-GB'] as Record<string, string>)[key] = words)),
      ),
    ).toBe(true)
  })

  it('is needed when a hint is added or removed', () => {
    const withHint = version(
      ({ text }) =>
        void ((text['en-GB'] as Record<string, string>)['fields.message.hint'] = 'Made up.'),
    )
    expect(needsSecondApproval(previous, withHint)).toBe(true)
    expect(needsSecondApproval(withHint, previous)).toBe(true)
  })

  it.each([
    ['the title', 'title', 'A made-up form title'],
    ['the intro', 'intro', 'A made-up introduction to a sample group.'],
    ['a note', 'fields.has_group.notes.no', 'A made-up note about a sample group.'],
  ])('is not needed when only %s is reworded', (_, key, words) => {
    expect(
      needsSecondApproval(
        previous,
        version(({ text }) => void ((text['en-GB'] as Record<string, string>)[key] = words)),
      ),
    ).toBe(false)
  })

  it.each([
    'Tell us about your health',
    'Any criminal record',
    'A DBS check',
    'Your religion',
    'Your bank',
    'Any ｃｏｎｖｉｃｔｉｏｎｓ',
  ])('is needed when any text has a sensitive term: "%s"', (words) => {
    expect(
      needsSecondApproval(
        previous,
        version(({ text }) => void ((text['en-GB'] as Json).title = words)),
      ),
    ).toBe(true)
  })

  it('blocks publishing in Phase 1 when it is needed', () => {
    const check = checkPublish(
      candidate((c) => void (c.definition.readers = ['chair'])),
      previous,
    )
    expect(check.ok).toBe(false)
    expect(check.problems).toEqual([{ code: 'second_approval_needed', path: 'definition' }])
  })
})
