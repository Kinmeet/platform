import { expect, test } from '@playwright/test'
import { watchPage } from './helpers'

// Checks the checker: a page with no content security policy, so only the
// watcher stands between it and another origin. Nothing leaves the machine:
// ordinary requests are blocked by the route, and the WebSocket points at a
// documentation-only address (RFC 5737) that never answers.
test('the watcher records a WebSocket to another origin', async ({ page }) => {
  const problems = await watchPage(page, new Set(['http://127.0.0.1:8787']))

  await page.setContent('<p>Test page</p>')
  await page.evaluate(() => {
    new WebSocket('wss://192.0.2.1/socket')
  })

  await expect.poll(() => problems.thirdPartyRequests).toEqual(['wss://192.0.2.1/socket'])
})

test('the watcher allows a WebSocket to our own origin', async ({ page }) => {
  const problems = await watchPage(page, new Set(['http://127.0.0.1:8787']))
  let opened = false
  page.on('websocket', () => (opened = true))

  await page.setContent('<p>Test page</p>')
  await page.evaluate(() => {
    new WebSocket('ws://127.0.0.1:8787/socket')
  })

  await expect.poll(() => opened).toBe(true)
  expect(problems.thirdPartyRequests).toEqual([])
})
