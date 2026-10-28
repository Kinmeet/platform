import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  listApplications,
  listHelloMessages,
  markOutcomeTold,
  markReplied,
  recordListView,
} from '../../../../../server/utils/db/admin'
import {
  applicationDeleteAfterOutcome,
  auditLogDeleteAfter,
  helloDeleteAfterReply,
} from '../../../../../server/utils/retention'

// Made-up test data only.
const RECEIVED = 1_793_000_000
const NOW = RECEIVED + 3 * 24 * 60 * 60
const ACTOR = '00000000-0000-4000-8000-00000000f00d'
const HELLO_ID = '00000000-0000-4000-8000-000000000001'
const APPLICATION_IDS = {
  no: '00000000-0000-4000-8000-000000000011',
  friend_or_acquaintance: '00000000-0000-4000-8000-000000000012',
  not_sure: '00000000-0000-4000-8000-000000000013',
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM form_submissions'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare(
      `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES (?, ?, 'Test Fox', 'test.fox@example.com', 'Made-up message.', ?, ?)`,
    ).bind(HELLO_ID, '00000000-0000-4000-8000-0000000000a1', RECEIVED, RECEIVED + 1000),
    ...Object.entries(APPLICATION_IDS).map(([connection, id], index) =>
      env.DB.prepare(
        `INSERT INTO applications (id, submission_id, role, connection_to_founders, call_name, email,
                                   answers, received_at, delete_after)
         VALUES (?, ?, 'trustee', ?, 'Sample Applicant', 'sample@example.org',
                 '{"why_trustee":"Made-up."}', ?, ?)`,
      ).bind(
        id,
        `00000000-0000-4000-8000-0000000000b${index}`,
        connection,
        RECEIVED + index,
        RECEIVED + 99999,
      ),
    ),
  ])
})

async function auditEntries() {
  const { results } = await env.DB.prepare(
    'SELECT at, actor, action, target_table, target_id FROM audit_log ORDER BY rowid',
  ).all()
  return results
}

describe('admin reads', () => {
  it('lists messages with their deletion dates', async () => {
    expect(await listHelloMessages(env.DB)).toEqual([
      {
        id: HELLO_ID,
        callName: 'Test Fox',
        email: 'test.fox@example.com',
        message: 'Made-up message.',
        receivedAt: RECEIVED,
        repliedAt: null,
        deleteAfter: RECEIVED + 1000,
      },
    ])
  })

  it('works out the conflict to declare on read, newest first', async () => {
    const applications = await listApplications(env.DB)
    expect(applications.map((a) => [a.connectionToFounders, a.conflictToDeclare])).toEqual([
      ['not_sure', true],
      ['friend_or_acquaintance', true],
      ['no', false],
    ])
    expect(applications[0]!.answers).toEqual({ why_trustee: 'Made-up.' })
  })

  // Theo, #159: an answer keeps the question its own version asked.
  it('labels each answer from the version it was sent on', async () => {
    const rows = await env.DB.prepare(
      `SELECT s.version, v.text FROM form_submissions AS s
       JOIN form_versions AS v ON v.form_id = s.form_id AND v.version = s.version
       WHERE s.id = ?`,
    )
      .bind(APPLICATION_IDS.not_sure)
      .first<{ version: number; text: string }>()
    const label = JSON.parse(rows!.text)['en-GB']['fields.why_trustee.label'] as string
    expect(label.length).toBeGreaterThan(0)
    const [newest] = await listApplications(env.DB)
    expect(newest!.labels).toEqual({ why_trustee: label })
  })
})

describe('mark replied', () => {
  it('records the reply, moves the deletion date on and writes an audit entry', async () => {
    const before = (await auditEntries()).length
    expect(await markReplied(env.DB, HELLO_ID, ACTOR, NOW)).toBe(true)
    const [message] = await listHelloMessages(env.DB)
    expect(message).toMatchObject({ repliedAt: NOW, deleteAfter: helloDeleteAfterReply(NOW) })
    const entries = await auditEntries()
    expect(entries.length).toBe(before + 1)
    expect(entries.at(-1)).toEqual({
      at: NOW,
      actor: ACTOR,
      action: 'mark_replied',
      target_table: 'form_submissions',
      target_id: HELLO_ID,
    })
  })

  it('moves the date on again for a later reply', async () => {
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW)
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW + 100_000)
    const [message] = await listHelloMessages(env.DB)
    expect(message!.deleteAfter).toBe(helloDeleteAfterReply(NOW + 100_000))
  })

  it('changes nothing and writes no audit entry for an unknown message', async () => {
    const before = (await auditEntries()).length
    expect(await markReplied(env.DB, '00000000-0000-4000-8000-00000000dead', ACTOR, NOW)).toBe(
      false,
    )
    expect((await auditEntries()).length).toBe(before)
  })
})

describe('mark outcome told', () => {
  it('records the date, replaces the backstop and writes an audit entry', async () => {
    const before = (await auditEntries()).length
    expect(await markOutcomeTold(env.DB, APPLICATION_IDS.no, ACTOR, NOW)).toBe(true)
    const application = (await listApplications(env.DB)).find((a) => a.id === APPLICATION_IDS.no)
    expect(application).toMatchObject({
      outcomeToldAt: NOW,
      deleteAfter: applicationDeleteAfterOutcome(NOW),
    })
    const entries = await auditEntries()
    expect(entries.length).toBe(before + 1)
    expect(entries.at(-1)).toMatchObject({
      action: 'mark_outcome_told',
      target_table: 'form_submissions',
      target_id: APPLICATION_IDS.no,
    })
  })

  it('counts only the first time', async () => {
    await markOutcomeTold(env.DB, APPLICATION_IDS.no, ACTOR, NOW)
    const before = (await auditEntries()).length
    expect(await markOutcomeTold(env.DB, APPLICATION_IDS.no, ACTOR, NOW + 100)).toBe(false)
    const application = (await listApplications(env.DB)).find((a) => a.id === APPLICATION_IDS.no)
    expect(application!.outcomeToldAt).toBe(NOW)
    expect((await auditEntries()).length).toBe(before)
  })

  it('changes nothing for an unknown application', async () => {
    expect(await markOutcomeTold(env.DB, '00000000-0000-4000-8000-00000000dead', ACTOR, NOW)).toBe(
      false,
    )
  })
})

describe('audit log', () => {
  it('is append-only', async () => {
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW)
    await expect(
      env.DB.prepare("UPDATE audit_log SET actor = 'someone-else'").run(),
    ).rejects.toThrow(/audit_log_append_only/)
    await expect(env.DB.prepare('DELETE FROM audit_log').run()).rejects.toThrow(
      /audit_log_append_only/,
    )
  })

  it('keeps each entry for 2 years', async () => {
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW)
    const row = await env.DB.prepare(
      'SELECT delete_after FROM audit_log ORDER BY rowid DESC LIMIT 1',
    ).first<{ delete_after: number }>()
    expect(row?.delete_after).toBe(auditLogDeleteAfter(NOW))
    expect(auditLogDeleteAfter(NOW)).toBe(NOW + 731 * 24 * 60 * 60)
  })

  it('allows deleting entries only once their deletion date has passed', async () => {
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW)
    // Made-up expired entry, from long before the test clock.
    await env.DB.prepare(
      `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
       VALUES ('00000000-0000-4000-8000-0000000000aa', 1000, ?, 'mark_replied', 'hello_messages', ?, 2000)`,
    )
      .bind(ACTOR, HELLO_ID)
      .run()
    const expired = await env.DB.prepare(
      'DELETE FROM audit_log WHERE delete_after <= unixepoch()',
    ).run()
    expect(expired.meta.changes).toBe(1)
    await expect(
      env.DB.prepare('DELETE FROM audit_log WHERE delete_after > unixepoch()').run(),
    ).rejects.toThrow(/audit_log_append_only/)
  })

  it('holds no names, emails or messages', async () => {
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW)
    const text = JSON.stringify(await auditEntries())
    for (const value of ['Test Fox', 'test.fox@example.com', 'Made-up message.']) {
      expect(text).not.toContain(value)
    }
  })
})

describe('list views', () => {
  it('records each fetch of a list once, naming its form and no row', async () => {
    const formId = async (slug: string) =>
      (await env.DB.prepare('SELECT id FROM forms WHERE slug = ?')
        .bind(slug)
        .first<{ id: string }>())!.id
    const { results: before } = await env.DB.prepare('SELECT id FROM audit_log').all()
    await recordListView(env.DB, 'hello_messages', ACTOR, NOW)
    await recordListView(env.DB, 'applications', ACTOR, NOW + 1)
    const entries = (await auditEntries()).slice(before.length)
    // One entry per form the list shows: say hello, and the one open
    // application form (ADR-0010, #156).
    expect(entries).toEqual([
      {
        at: NOW,
        actor: ACTOR,
        action: 'view_form_submissions',
        target_table: 'forms',
        target_id: await formId('hello'),
      },
      {
        at: NOW + 1,
        actor: ACTOR,
        action: 'view_form_submissions',
        target_table: 'forms',
        target_id: await formId('trustee'),
      },
    ])
    const row = await env.DB.prepare(
      'SELECT delete_after FROM audit_log ORDER BY rowid DESC LIMIT 1',
    ).first<{ delete_after: number }>()
    expect(row?.delete_after).toBe(auditLogDeleteAfter(NOW + 1))
  })

  it('refuses entries whose action, table and target do not fit together', async () => {
    const insert = (action: string, table: string, target: string | null) =>
      env.DB.prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
         VALUES (?, 1000, ?, ?, ?, ?, 2000)`,
      )
        .bind(crypto.randomUUID(), ACTOR, action, table, target)
        .run()
    // A view never names a row, and an action always does.
    await expect(insert('view_hello_messages', 'hello_messages', HELLO_ID)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    await expect(insert('mark_replied', 'hello_messages', null)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    // Each action belongs to its own table.
    await expect(insert('view_applications', 'hello_messages', null)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    await expect(insert('mark_outcome_told', 'hello_messages', HELLO_ID)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    // The generic names (ADR-0010): a form list view names its form, and an
    // action on a submission names `form_submissions`.
    await expect(insert('view_form_submissions', 'forms', null)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    await expect(insert('view_form_submissions', 'form_submissions', HELLO_ID)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    await expect(insert('mark_replied', 'applications', HELLO_ID)).rejects.toThrow(
      /CHECK constraint failed/,
    )
    await expect(insert('mark_replied', 'forms', HELLO_ID)).rejects.toThrow(
      /CHECK constraint failed/,
    )
  })
})
