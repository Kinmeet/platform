import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  listApplications,
  listHelloMessages,
  markOutcomeTold,
  markReplied,
} from '../../../../../server/utils/db/admin'
import {
  applicationDeleteAfterOutcome,
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
      target_table: 'hello_messages',
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

  it('holds no names, emails or messages', async () => {
    await markReplied(env.DB, HELLO_ID, ACTOR, NOW)
    const text = JSON.stringify(await auditEntries())
    for (const value of ['Test Fox', 'test.fox@example.com', 'Made-up message.']) {
      expect(text).not.toContain(value)
    }
  })
})
