import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  addChoice,
  addField,
  addStep,
  changeType,
  emptyDraft,
  freeBodies,
  moveChoice,
  moveField,
  problemTarget,
  purposesFor,
  removeChoice,
  removeField,
  removeStep,
  showIfTargets,
  startingDraft,
  toSaveBody,
} from '../../../../app/utils/form-builder'
import type { AdminFormDetail } from '../../../../shared/admin'
import { definitionSchema, type FormDefinition } from '../../../../shared/forms/definition'
import { checkPublish } from '../../../../shared/forms/publish'

// The form builder's helpers (ADR-0010, B3, #160). The server's checks decide
// what can publish; these tests prove the helpers hand those checks a draft
// in the shape they expect, so a form built on the page can publish.

/** A seeded form's current version, as `GET /api/admin/forms/<id>` returns it. */
async function seeded(slug: string): Promise<AdminFormDetail> {
  const row = await env.DB.prepare(
    `SELECT f.id, f.slug, f.kind, v.version, v.purpose, v.definition, v.text, v.published_at
     FROM forms AS f JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version
     WHERE f.slug = ?`,
  )
    .bind(slug)
    .first<{
      id: string
      slug: string
      kind: 'form' | 'application'
      version: number
      purpose: string
      definition: string
      text: string
      published_at: number
    }>()
  if (!row) throw new Error(`no form ${slug}`)
  return {
    form: {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      status: 'open',
      version: row.version,
      p3Row: null,
      retentionMonths: null,
      readers: [],
      title: null,
      hasDraft: false,
    },
    current: {
      purpose: row.purpose,
      definition: JSON.parse(row.definition),
      text: JSON.parse(row.text),
      version: row.version,
      publishedAt: row.published_at,
    },
    draft: null,
    versions: [{ version: row.version, publishedAt: row.published_at }],
  }
}

const previousOf = (detail: AdminFormDetail) => ({
  purpose: detail.current!.purpose,
  definition: definitionSchema.parse(detail.current!.definition),
  text: detail.current!.text,
})

describe('form builder helpers', () => {
  it('saves a published version unchanged, so it passes every check', async () => {
    const detail = await seeded('hello')
    const body = toSaveBody(startingDraft(detail))
    expect(body.definition).toEqual(detail.current!.definition)
    expect(body.text).toEqual(detail.current!.text)
    const check = checkPublish({ slug: 'hello', kind: 'form', ...body }, previousOf(detail))
    expect(check).toEqual({ ok: true, problems: [], needsSecondApproval: false })
  })

  it('saves the trustee application unchanged, which still needs a second approval', async () => {
    // Its wording names DBS checks, a sensitive term, so every version of it
    // needs a second person, whatever changed (Ezra, #160).
    const detail = await seeded('trustee')
    const body = toSaveBody(startingDraft(detail))
    expect(body.definition).toEqual(detail.current!.definition)
    expect(body.text).toEqual(detail.current!.text)
    const check = checkPublish(
      { slug: 'trustee', kind: 'application', ...body },
      previousOf(detail),
    )
    expect(check.problems).toEqual([{ code: 'second_approval_needed', path: 'definition' }])
  })

  it('copies the stored version, so editing never changes what the API returned', async () => {
    const detail = await seeded('hello')
    const draft = startingDraft(detail)
    draft.definition.steps[0]!.fields.pop()
    draft.text.title = 'Changed'
    expect(definitionSchema.parse(detail.current!.definition).steps[0]!.fields).toHaveLength(1)
    expect((detail.current!.text as Record<string, Record<string, string>>)['en-GB']!.title).toBe(
      'Say hello',
    )
  })

  it('builds a new message form that passes every check but the second approval', () => {
    const draft = emptyDraft('form')
    expect(draft.purpose).toBe('say_hello')
    const id = addField(draft.definition, 0)!
    changeType(draft.definition, id, 'long_text')
    draft.definition.actions = ['reply', 'pass_to_safeguarding']
    Object.assign(draft.text, {
      title: 'Sample form',
      [`fields.${id}.label`]: 'Your made-up message',
      [`fields.${id}.summary`]: 'Your message',
    })
    // Only say hello has a submit route with a body limit so far; a message
    // form at any other address waits for the generic form route.
    const check = checkPublish({ slug: 'hello', kind: 'form', ...toSaveBody(draft) }, null)
    // A new form always needs a second person, who doesn't exist in Phase 1.
    expect(check.problems).toEqual([{ code: 'second_approval_needed', path: 'definition' }])
    expect(check.needsSecondApproval).toBe(true)
  })

  it('starts a new form with the purpose of its kind and all its readers', () => {
    expect(purposesFor('application').map((each) => each.id)).toEqual(['trustee_application'])
    const draft = emptyDraft('application')
    expect(draft.purpose).toBe('trustee_application')
    expect(draft.definition.readers).toEqual(['secretary', 'safeguarding_lead', 'chair'])
  })

  it('leaves out words the definition no longer uses, and empty ones', () => {
    const draft = emptyDraft('form')
    const id = addField(draft.definition, 0)!
    draft.text[`fields.${id}.label`] = 'A made-up question'
    draft.text[`fields.${id}.hint`] = '   '
    draft.text['fields.gone.label'] = 'A removed question'
    expect(toSaveBody(draft).text).toEqual({
      'en-GB': { [`fields.${id}.label`]: 'A made-up question' },
    })
  })

  it('moves questions within their step and says where they went', () => {
    const definition = emptyDraft('form').definition
    const first = addField(definition, 0)!
    const second = addField(definition, 0)!
    expect(moveField(definition, first, -1)).toBeUndefined()
    expect(moveField(definition, first, 1)).toEqual({ step: 1, position: 2, count: 2 })
    expect(definition.steps[0]!.fields.map((field) => field.id)).toEqual([second, first])
    expect(moveField(definition, first, 1)).toBeUndefined()
  })

  it('gives each new question an id no other question has', () => {
    const definition = emptyDraft('application').definition
    addField(definition, 0)
    addStep(definition)
    const ids = definition.steps.flatMap((step) => step.fields.map((field) => field.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stops adding questions at the limit', () => {
    const definition = emptyDraft('form').definition
    for (let n = 0; n < 10; n++) expect(addField(definition, 0)).toBeDefined()
    expect(addField(definition, 0)).toBeUndefined()
  })

  it('gives each step a different body key, and stops when none is left', () => {
    const definition = emptyDraft('application').definition
    expect(freeBodies(definition)).toEqual(['checks', 'answers'])
    expect(addStep(definition)).toBe(2)
    expect(addStep(definition)).toBe(3)
    expect(definition.steps.map((step) => step.body)).toEqual([null, 'checks', 'answers'])
    expect(addStep(definition)).toBeUndefined()
  })

  it('removes a step with its questions, and keeps "About you" in range', () => {
    const definition = emptyDraft('application').definition
    addStep(definition)
    definition.aboutYou = 2
    removeStep(definition, 1)
    expect(definition.steps).toHaveLength(1)
    expect(definition.aboutYou).toBe(1)
    removeStep(definition, 0)
    expect(definition.steps).toHaveLength(1)
  })

  it('keeps words, required and show-if when the answer type changes', () => {
    const definition = choiceForm()
    changeType(definition, 'later', 'long_text')
    const later = definition.steps[0]!.fields[1]!
    expect(later).toMatchObject({ type: 'long_text', required: false, showIf: { field: 'pick' } })
    changeType(definition, 'later', 'confirm')
    expect(definition.steps[0]!.fields[1]).toMatchObject({ type: 'confirm', required: true })
  })

  it('drops show-if conditions that can no longer work', () => {
    const definition = choiceForm()
    changeType(definition, 'pick', 'short_text')
    expect(definition.steps[0]!.fields[1]!.showIf).toBeUndefined()

    const removed = choiceForm()
    removeField(removed, 'pick')
    expect(removed.steps[0]!.fields[0]!.showIf).toBeUndefined()
  })

  it('adds, moves and removes choices, keeping outcomes and conditions in step', () => {
    const definition = choiceForm()
    const pick = definition.steps[0]!.fields[0]!
    const added = addChoice(pick)
    expect(added).toBe('choice_1')
    expect(moveChoice(pick, added!, -1)).toBe(2)
    removeChoice(definition, pick, 'b')
    expect(pick).toMatchObject({ choices: ['a', 'choice_1'] })
    expect(pick.type === 'single_choice' && pick.outcomes).toBeFalsy()
    // The condition showed only for "b", so it goes with it.
    expect(definition.steps[0]!.fields[1]!.showIf).toBeUndefined()
    // Two choices is the least a question can have.
    removeChoice(definition, pick, 'a')
    expect(pick).toMatchObject({ choices: ['a', 'choice_1'] })
  })

  it('offers only earlier choice questions for show-if', () => {
    const definition = choiceForm()
    expect(showIfTargets(definition, 'pick')).toEqual([])
    expect(showIfTargets(definition, 'later').map((field) => field.id)).toEqual(['pick'])
  })

  it('links each problem to the thing to fix on the page', () => {
    const definition = choiceForm()
    expect(problemTarget(definition, 'text.en-GB.fields.later.label')).toBe('edit-later')
    expect(problemTarget(definition, 'text.en-GB.title')).toBe('text-title')
    expect(problemTarget(definition, 'text.en-GB.steps.one.heading')).toBe('text-steps-one-heading')
    expect(problemTarget(definition, 'definition.steps.0.fields.1.showIf')).toBe('edit-later')
    expect(problemTarget(definition, 'definition.fields.pick')).toBe('edit-pick')
    expect(problemTarget(definition, 'definition.steps.0')).toBe('step-1')
    expect(problemTarget(definition, 'definition.readers')).toBe('settings-heading')
    expect(problemTarget(definition, 'purpose')).toBe('settings-heading')
    expect(problemTarget(definition, 'text')).toBe('questions-heading')
  })
})

/** A one-step form: a choice, then a question shown for one of its answers. */
function choiceForm(): FormDefinition {
  return {
    steps: [
      {
        id: 'one',
        body: null,
        fields: [
          {
            id: 'pick',
            type: 'single_choice',
            required: true,
            choices: ['a', 'b'],
            outcomes: { b: { note: true } },
          },
          {
            id: 'later',
            type: 'short_text',
            required: false,
            maxLength: 50,
            showIf: { field: 'pick', in: ['b'] },
          },
        ],
      },
    ],
    aboutYou: 0,
    note: false,
    receipt: 'none',
    actions: [],
    readers: ['secretary'],
  }
}
