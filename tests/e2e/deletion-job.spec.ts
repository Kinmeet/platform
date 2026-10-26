import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { E2E_PERSIST_DIR } from './local-d1'

// P1 Phase 1 "deletion tested": runs the real daily deletion job through the
// Worker's scheduled handler (`wrangler dev --test-scheduled`) against the
// local D1 the end-to-end server uses, and checks that it removes rows past
// their deletion date and keeps the rest, in every personal-data table.
// Made-up test data only. Times are Unix seconds, as in the schema.
// The daily cron; a unit test checks nuxt.config.ts and wrangler.jsonc agree.
const CRON = '17 3 * * *'
const PAST = 1_000_000_000 // September 2001
const FUTURE = 4_000_000_000 // 2096
const RECEIVED = PAST - 86_400
const HMAC = 'e'.repeat(64)

// `wrangler d1 execute` takes no bound parameters, so the SQL here is built
// from the constants in this file only, never from anything outside it.
function d1(sql: string): Record<string, unknown>[] {
  const output = execFileSync(
    'bunx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      '--persist-to',
      E2E_PERSIST_DIR,
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const results = JSON.parse(output) as { results: Record<string, unknown>[] }[]
  return results.flatMap((result) => result.results)
}

const hello = (id: string, deleteAfter: number) =>
  `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
   VALUES ('${id}', '${id}-s', 'Test Fox', 'test.fox@example.com', 'Made-up message.', ${RECEIVED}, ${deleteAfter})`
const application = (id: string, deleteAfter: number) =>
  `INSERT INTO applications (id, submission_id, role, connection_to_founders, call_name, email, answers, received_at, delete_after)
   VALUES ('${id}', '${id}-s', 'trustee', 'no', 'Sample Applicant', 'sample@example.org', '{}', ${RECEIVED}, ${deleteAfter})`
const emailLog = (id: string, deleteAfter: number) =>
  `INSERT INTO email_log (id, to_hmac, template_id, sent_at, delete_after)
   VALUES ('${id}', '${HMAC}', 'application_receipt', ${RECEIVED}, ${deleteAfter})`
const auditEntry = (id: string, deleteAfter: number) =>
  `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
   VALUES ('${id}', ${RECEIVED}, 'test-actor', 'mark_replied', 'hello_messages', 'e2e-hello-old', ${deleteAfter})`

test('the daily job deletes rows past their date and keeps the rest', async ({ request }) => {
  // Each wrangler d1 call starts its own process, so allow for a slow runner.
  test.setTimeout(90_000)
  d1(
    [
      hello('e2e-hello-old', PAST),
      hello('e2e-hello-new', FUTURE),
      application('e2e-app-old', PAST),
      application('e2e-app-new', FUTURE),
      emailLog('e2e-log-old', PAST),
      emailLog('e2e-log-new', FUTURE),
      auditEntry('e2e-audit-old', PAST),
      auditEntry('e2e-audit-new', FUTURE),
    ].join(';\n'),
  )

  const response = await request.get(`/__scheduled?cron=${encodeURIComponent(CRON)}`)
  expect(response.ok()).toBe(true)

  const remaining = () =>
    d1(
      `SELECT id FROM hello_messages WHERE id LIKE 'e2e-%'
       UNION ALL SELECT id FROM applications WHERE id LIKE 'e2e-%'
       UNION ALL SELECT id FROM email_log WHERE id LIKE 'e2e-%'
       UNION ALL SELECT id FROM audit_log WHERE id LIKE 'e2e-%'`,
    )
      .map((row) => row.id)
      .sort()
  await expect
    .poll(remaining, { timeout: 20_000 })
    .toEqual(['e2e-app-new', 'e2e-audit-new', 'e2e-hello-new', 'e2e-log-new'])
})
