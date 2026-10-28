import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
// A submission on the stored say hello form (ADR-0010, #156).
const formSubmission = (id: string, deleteAfter: number) =>
  `INSERT INTO form_submissions (id, submission_id, form_id, version, call_name, email, answers, received_at, delete_after)
   SELECT '${id}', '${id}-s', id, current_version, 'Test Fox', 'test.fox@example.com', '{"message":"Made-up message."}', ${RECEIVED}, ${deleteAfter}
   FROM forms WHERE slug = 'hello'`
const emailLog = (id: string, deleteAfter: number) =>
  `INSERT INTO email_log (id, to_hmac, template_id, sent_at, delete_after)
   VALUES ('${id}', '${HMAC}', 'application_receipt', ${RECEIVED}, ${deleteAfter})`
const auditEntry = (id: string, target: string, deleteAfter: number) =>
  `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
   VALUES ('${id}', ${RECEIVED}, 'test-actor', 'mark_replied', 'hello_messages', '${target}', ${deleteAfter})`

test('the daily job deletes rows past their date and keeps the rest', async ({ request }) => {
  // Each wrangler d1 call starts its own process, so allow for a slow runner.
  test.setTimeout(90_000)
  // The kept rows stay in the local D1, so each run uses its own ids and only
  // looks at those. A repeated run (--repeat-each) would otherwise insert the
  // same ids twice (#148). The prefix is hex, so it's safe in the SQL below.
  const run = `e2e-${randomUUID().slice(0, 8)}`
  d1(
    [
      hello(`${run}-hello-old`, PAST),
      hello(`${run}-hello-new`, FUTURE),
      application(`${run}-app-old`, PAST),
      application(`${run}-app-new`, FUTURE),
      formSubmission(`${run}-form-old`, PAST),
      formSubmission(`${run}-form-new`, FUTURE),
      emailLog(`${run}-log-old`, PAST),
      emailLog(`${run}-log-new`, FUTURE),
      auditEntry(`${run}-audit-old`, `${run}-hello-old`, PAST),
      auditEntry(`${run}-audit-new`, `${run}-hello-old`, FUTURE),
    ].join(';\n'),
  )

  const response = await request.get(`/__scheduled?cron=${encodeURIComponent(CRON)}`)
  expect(response.ok()).toBe(true)

  const remaining = () =>
    d1(
      `SELECT id FROM hello_messages WHERE id LIKE '${run}-%'
       UNION ALL SELECT id FROM applications WHERE id LIKE '${run}-%'
       UNION ALL SELECT id FROM form_submissions WHERE id LIKE '${run}-%'
       UNION ALL SELECT id FROM email_log WHERE id LIKE '${run}-%'
       UNION ALL SELECT id FROM audit_log WHERE id LIKE '${run}-%'`,
    )
      .map((row) => row.id)
      .sort()
  await expect
    .poll(remaining, { timeout: 20_000 })
    // Until phase C, a row written to an old table is also copied into
    // `form_submissions` under the same id, so each kept old row shows twice.
    .toEqual([
      `${run}-app-new`,
      `${run}-app-new`,
      `${run}-audit-new`,
      `${run}-form-new`,
      `${run}-hello-new`,
      `${run}-hello-new`,
      `${run}-log-new`,
    ])
})
