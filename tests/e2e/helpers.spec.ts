import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { watchPage } from './helpers'

// Checks the checker: a page with no content security policy, so only the
// watcher stands between it and another origin. Nothing leaves the machine:
// the "other origin" is a throwaway local server on a different port, which
// answers the WebSocket handshake with a plain 404.
const OWN_ORIGIN = 'http://127.0.0.1:8787'
let otherServer: Server
let otherPort: number

test.beforeAll(async () => {
  otherServer = createServer((_request, response) => response.writeHead(404).end())
  await new Promise<void>((resolve) => otherServer.listen(0, '127.0.0.1', resolve))
  otherPort = (otherServer.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise((resolve) => otherServer.close(resolve))
})

test('the watcher records a WebSocket to another origin', async ({ page }) => {
  const problems = await watchPage(page, new Set([OWN_ORIGIN]), OWN_ORIGIN)
  const url = `ws://127.0.0.1:${otherPort}/socket`

  await page.setContent('<p>Test page</p>')
  await page.evaluate((socketUrl) => {
    new WebSocket(socketUrl)
  }, url)

  await expect.poll(() => problems.thirdPartyRequests).toEqual([url])
})

test('the watcher allows a WebSocket to our own origin', async ({ page }) => {
  const problems = await watchPage(page, new Set([OWN_ORIGIN]), OWN_ORIGIN)
  let opened = false
  page.on('websocket', () => (opened = true))

  await page.setContent('<p>Test page</p>')
  await page.evaluate(() => {
    new WebSocket('ws://127.0.0.1:8787/socket')
  })

  await expect.poll(() => opened).toBe(true)
  expect(problems.thirdPartyRequests).toEqual([])
})
