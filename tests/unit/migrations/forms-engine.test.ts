import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import copyMigration from '../../../migrations/db/0006_copy_form_submissions.sql?raw'
import enGB from '../../../i18n/locales/en-GB.json'
import { definitionSchema } from '../../../shared/forms/definition'
import { checkPublish } from '../../../shared/forms/publish'
import { roles, trustee } from '../../../shared/forms/roles'
import { HELLO_MESSAGE_MAX } from '../../../shared/forms/hello'

// ADR-0010 phase A (#156): the forms tables, the seeded version 1 forms and
// the copy of existing rows. Made-up test data only.
const RECEIVED = 1_793_000_000
const DAY = 24 * 60 * 60

/** Runs a migration file's statements as they are, without its comments. */
async function run(sql: string) {
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)))
}

interface SeededVersion {
  slug: string
  kind: string
  status: string
  version: number
  purpose: string
  definition: string
  text: string
  published_by: string
}

/** A form's current version, or the one asked for. */
async function seeded(slug: string, version?: number): Promise<SeededVersion> {
  return (await env.DB.prepare(
    `SELECT f.slug, f.kind, f.status, v.version, v.purpose, v.definition, v.text, v.published_by
     FROM forms AS f JOIN form_versions AS v
       ON v.form_id = f.id AND v.version = coalesce(?, f.current_version)
     WHERE f.slug = ?`,
  )
    .bind(version ?? null, slug)
    .first<SeededVersion>())!
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM form_submissions'),
  ])
})

describe('the seeded version 1 forms', () => {
  it('seeds say hello from its old schema and copy', async () => {
    const hello = await seeded('hello')
    expect(hello).toMatchObject({
      kind: 'form',
      status: 'open',
      version: 1,
      purpose: 'say_hello',
      published_by: 'migration',
    })
    const definition = definitionSchema.parse(JSON.parse(hello.definition))
    expect(definition.steps).toEqual([
      {
        id: 'message',
        body: null,
        fields: [
          { id: 'message', type: 'long_text', required: true, maxLength: HELLO_MESSAGE_MAX },
        ],
      },
    ])
    expect(definition).toMatchObject({ aboutYou: 0, receipt: 'none' })
    expect(JSON.parse(hello.text)).toEqual({
      'en-GB': {
        title: enGB.hello.title,
        intro: enGB.hello.lede,
        'fields.message.label': enGB.hello.message.label,
        'fields.message.summary': enGB.hello.fields.message,
      },
    })
  })

  it('seeds the trustee application from its role config and copy', async () => {
    const form = await seeded('trustee', 1)
    expect(form).toMatchObject({
      kind: 'application',
      status: 'open',
      version: 1,
      purpose: 'trustee_application',
    })
    const definition = definitionSchema.parse(JSON.parse(form.definition))
    const [checks, answers] = definition.steps
    expect(checks).toMatchObject({ id: 'checks', body: 'checks' })
    expect(answers).toMatchObject({ id: 'answers', body: 'answers' })
    // Every check and question, with the same ids, choices, outcomes, links,
    // required flags and lengths as the role config.
    // A confirm's only choice, `yes`, is implied rather than stored.
    expect(checks!.fields).toEqual(
      trustee.apply.checks.map((check) => {
        if (check.type !== 'confirm') return check
        const { choices: _yes, ...rest } = check
        return rest
      }),
    )
    expect(answers!.fields).toEqual(trustee.apply.questions.map((question) => ({ ...question })))
    expect(definition).toMatchObject({
      aboutYou: 1,
      note: trustee.apply.note,
      receipt: 'application_receipt',
    })

    // Every word, exactly as the role's copy has it.
    const role = enGB.roles.trustee
    const expected: Record<string, string> = {
      title: role.title,
      'note.heading': role.apply.note.heading,
      'note.body': role.apply.note.body,
    }
    const flatten = (prefix: string, value: unknown) => {
      if (typeof value === 'string') expected[prefix] = value
      else
        for (const [key, inner] of Object.entries(value as object))
          flatten(`${prefix}.${key}`, inner)
    }
    for (const [id, words] of Object.entries(role.questions)) flatten(`fields.${id}`, words)
    // Version 1 kept the old short name, which 0007 replaced (Robin, #158).
    expect(JSON.parse(form.text)).toEqual({
      'en-GB': { ...expected, 'fields.why_trustee.summary': 'Why' },
    })
  })

  it('publishes trustee version 2 with only the new summary wording (0007)', async () => {
    const [first, second] = [await seeded('trustee', 1), await seeded('trustee')]
    expect(second).toMatchObject({ version: 2, status: 'open', purpose: first.purpose })
    expect(second.definition).toBe(first.definition)
    const [before, after] = [first, second].map(
      (version) => (JSON.parse(version.text) as { 'en-GB': Record<string, string> })['en-GB'],
    )
    expect(after).toEqual({
      ...before,
      'fields.why_trustee.summary': enGB.roles.trustee.questions.why_trustee.summary,
    })
    expect(after['fields.why_trustee.summary']).toBe("Why you'd like to be a trustee")
  })

  it('lists every role, open or not, so a closed one is still role_closed', async () => {
    const { results } = await env.DB.prepare(
      `SELECT slug, status, current_version FROM forms WHERE kind = 'application' ORDER BY slug`,
    ).all<{ slug: string; status: string; current_version: number | null }>()
    expect(results).toEqual(
      [...roles]
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((role) => ({
          slug: role.slug,
          status: role.published ? 'open' : 'draft',
          // Trustee is on version 2 since 0007.
          current_version: role.published ? 2 : null,
        })),
    )
  })

  it('would pass every publish check apart from the second approval', async () => {
    for (const slug of ['hello', 'trustee']) {
      const form = await seeded(slug)
      const check = checkPublish(
        {
          slug,
          kind: form.kind as 'form' | 'application',
          purpose: form.purpose,
          definition: JSON.parse(form.definition),
          text: JSON.parse(form.text),
        },
        null,
      )
      // A new form always needs a second approval; the seeds ship by migration.
      expect(check.problems).toEqual([{ code: 'second_approval_needed', path: 'definition' }])
    }
  })

  it('never changes or deletes a published version', async () => {
    await expect(
      env.DB.prepare(`UPDATE form_versions SET purpose = 'say_hello' WHERE version = 1`).run(),
    ).rejects.toThrow(/form_versions_published/)
    await expect(env.DB.prepare('DELETE FROM form_versions').run()).rejects.toThrow(
      /form_versions_published/,
    )
  })

  it('keeps slugs unique whatever the letter case, and plain', async () => {
    const add = (slug: string) =>
      env.DB.prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, 'form', 'draft', 1)`,
      )
        .bind(crypto.randomUUID(), slug)
        .run()
    await expect(add('hello')).rejects.toThrow(/UNIQUE/)
    await expect(add('HELLO')).rejects.toThrow(/UNIQUE|CHECK/)
    await expect(add('sample group')).rejects.toThrow(/CHECK/)
    await expect(add('a'.repeat(33))).rejects.toThrow(/CHECK/)
  })

  it('refuses an open form with no version', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, 'sample-form', 'form', 'open', 1)`,
      )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow(/CHECK/)
  })
})

const hello = {
  id: '00000000-0000-4000-8000-000000000101',
  submission_id: '00000000-0000-4000-8000-0000000001a1',
  call_name: 'Test Fox',
  email: 'test.fox@example.com',
  message: "Hello from a made-up test message; it's fine.",
  received_at: RECEIVED,
  replied_at: RECEIVED + DAY,
  delete_after: RECEIVED + 400 * DAY,
}

const application = {
  id: '00000000-0000-4000-8000-000000000102',
  submission_id: '00000000-0000-4000-8000-0000000001a2',
  role: 'trustee',
  connection_to_founders: 'friend_or_acquaintance',
  call_name: 'Sample Applicant',
  email: 'sample.applicant@example.org',
  answers: JSON.stringify({ why_trustee: 'Made-up answer.', experience: 'Made-up "quote".' }),
  received_at: RECEIVED + 5,
  outcome_told_at: RECEIVED + 9 * DAY,
  delete_after: RECEIVED + 190 * DAY,
}

function insert(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row)
  return env.DB.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  )
    .bind(...Object.values(row))
    .run()
}

async function copied() {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.submission_id, f.slug, s.version, s.call_name, s.email, s.answers,
            s.received_at, s.replied_at, s.outcome_told_at, s.delete_after
     FROM form_submissions AS s JOIN forms AS f ON f.id = s.form_id ORDER BY s.id`,
  ).all<Record<string, unknown>>()
  return results.map((row) => ({ ...row, answers: JSON.parse(String(row.answers)) }))
}

const expectedCopies = [
  {
    id: hello.id,
    submission_id: hello.submission_id,
    slug: 'hello',
    version: 1,
    call_name: hello.call_name,
    email: hello.email,
    answers: { message: hello.message },
    received_at: hello.received_at,
    replied_at: hello.replied_at,
    outcome_told_at: null,
    delete_after: hello.delete_after,
  },
  {
    id: application.id,
    submission_id: application.submission_id,
    slug: 'trustee',
    // The form's current version when the copy is made: 2 once 0007 has run.
    // Its definition is the same as version 1's.
    version: 2,
    call_name: application.call_name,
    email: application.email,
    answers: {
      connection_to_founders: 'friend_or_acquaintance',
      why_trustee: 'Made-up answer.',
      experience: 'Made-up "quote".',
    },
    received_at: application.received_at,
    replied_at: null,
    outcome_told_at: application.outcome_told_at,
    delete_after: application.delete_after,
  },
]

describe('copying existing rows (0006)', () => {
  it('copies every row with its ids, dates and deletion date unchanged', async () => {
    await insert('hello_messages', hello)
    await insert('applications', application)
    // Undo the copy the trigger made, so this checks 0006 on its own.
    await env.DB.prepare('DELETE FROM form_submissions').run()

    await run(copyMigration)
    expect(await copied()).toEqual(expectedCopies)
    // The old tables keep their rows until phase C.
    const left = await env.DB.batch([
      env.DB.prepare('SELECT count(*) AS n FROM hello_messages'),
      env.DB.prepare('SELECT count(*) AS n FROM applications'),
    ])
    expect(left.map((result) => (result.results[0] as { n: number }).n)).toEqual([1, 1])
  })

  it('can run again without changing or doubling anything', async () => {
    await insert('hello_messages', hello)
    await insert('applications', application)
    await run(copyMigration)
    await run(copyMigration)
    expect(await copied()).toEqual(expectedCopies)
  })

  it('copies a row the old code writes after the migration, unchanged', async () => {
    // A deploy applies migrations before the new code serves requests.
    await insert('hello_messages', hello)
    await insert('applications', application)
    expect(await copied()).toEqual(expectedCopies)
  })

  it('deletes the copy when the old code deletes a row, so no plain copy is left (Theo)', async () => {
    // The old code's hand-over deletes from the old table only.
    await insert('hello_messages', hello)
    await insert('applications', application)
    await env.DB.prepare('DELETE FROM hello_messages WHERE id = ?').bind(hello.id).run()
    expect(await copied()).toEqual([expectedCopies[1]])
    await env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(application.id).run()
    expect(await copied()).toEqual([])
  })

  it('leaves the other copies alone when an old row is deleted', async () => {
    await insert('hello_messages', hello)
    await insert('hello_messages', {
      ...hello,
      id: '00000000-0000-4000-8000-000000000103',
      submission_id: '00000000-0000-4000-8000-0000000001a3',
    })
    await env.DB.prepare('DELETE FROM hello_messages WHERE id = ?').bind(hello.id).run()
    expect((await copied()).map((row) => row.id)).toEqual(['00000000-0000-4000-8000-000000000103'])
  })
})

describe('the audit log after the rebuild', () => {
  it('still takes the old entry shapes, so every existing entry was kept', async () => {
    const insertEntry = (action: string, table: string, target: string | null) =>
      env.DB.prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
         VALUES (?, ?, 'test-actor', ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), RECEIVED, action, table, target, RECEIVED + 1)
        .run()
    await insertEntry('view_hello_messages', 'hello_messages', null)
    await insertEntry('view_applications', 'applications', null)
    await insertEntry('mark_replied', 'hello_messages', hello.id)
    await insertEntry('mark_outcome_told', 'applications', application.id)
    await insertEntry('pass_to_safeguarding', 'safeguarding_items', hello.id)
    await insertEntry('open_safeguarding_item', 'safeguarding_items', hello.id)
  })

  it('is still append-only', async () => {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
       VALUES (?, 1, 'test-actor', 'view_applications', 'applications', NULL, 2)`,
    )
      .bind(crypto.randomUUID())
      .run()
    await expect(
      env.DB.prepare(`UPDATE audit_log SET actor = 'someone-else'`).run(),
    ).rejects.toThrow(/audit_log_append_only/)
  })
})
