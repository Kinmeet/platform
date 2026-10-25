import { describe, expect, it } from 'vitest'
import {
  isSameOriginJsonPost,
  parseJsonObject,
  readCappedBody,
} from '../../../../../server/utils/forms/request'

const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const CAP = 1024

function request(
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {},
) {
  return new Request(`${ORIGIN}/api/hello`, {
    method: init.method ?? 'POST',
    headers: init.headers ?? {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: init.body === undefined ? '{}' : init.body,
  })
}

const json = { 'Content-Type': 'application/json' }

describe('same origin JSON POST check', () => {
  it('accepts our own page', () => {
    expect(isSameOriginJsonPost(request(), ORIGIN)).toBe(true)
    expect(
      isSameOriginJsonPost(
        request({ headers: { Origin: ORIGIN, 'Content-Type': 'application/json; charset=utf-8' } }),
        ORIGIN,
      ),
    ).toBe(true)
  })

  it('matches the configured origin exactly, not the request host', () => {
    // The request URL's own origin is not enough when configuration says otherwise.
    expect(isSameOriginJsonPost(request(), 'https://kinmeet-live.kinmeet.workers.dev')).toBe(false)
    expect(
      isSameOriginJsonPost(request({ headers: { Origin: `${ORIGIN}/`, ...json } }), ORIGIN),
    ).toBe(false)
  })

  it('refuses another, missing or null origin, or a cross-site fetch', () => {
    for (const headers of [
      { Origin: 'https://example.com', ...json },
      { ...json },
      { Origin: 'null', ...json },
      { Origin: ORIGIN, ...json, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: ORIGIN, ...json, 'Sec-Fetch-Site': 'same-site' },
    ]) {
      expect(isSameOriginJsonPost(request({ headers }), ORIGIN)).toBe(false)
    }
  })

  it('refuses other methods and anything but exactly application/json', () => {
    expect(isSameOriginJsonPost(request({ method: 'PUT' }), ORIGIN)).toBe(false)
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'application/json; charset=latin1',
      'application/jsonp',
      'application/json-patch+json',
    ]) {
      expect(
        isSameOriginJsonPost(
          request({ headers: { Origin: ORIGIN, 'Content-Type': type } }),
          ORIGIN,
        ),
      ).toBe(false)
    }
  })
})

describe('capped body', () => {
  it('reads a body under the cap', async () => {
    expect(await readCappedBody(request({ body: '{"callName":"Test Fox"}' }), CAP)).toEqual({
      ok: true,
      text: '{"callName":"Test Fox"}',
    })
  })

  it('accepts a body exactly at the cap and refuses one byte more', async () => {
    expect((await readCappedBody(request({ body: 'x'.repeat(CAP) }), CAP)).ok).toBe(true)
    expect(await readCappedBody(request({ body: 'x'.repeat(CAP + 1) }), CAP)).toEqual({ ok: false })
  })

  it('counts bytes, not characters', async () => {
    // 300 foxes are 300 code points but 1,200 bytes.
    expect(await readCappedBody(request({ body: '🦊'.repeat(300) }), CAP)).toEqual({ ok: false })
  })

  it('counts from the stream and ignores a lying Content-Length', async () => {
    const big = 'x'.repeat(CAP * 4)
    expect(await readCappedBody(request({ body: new Blob([big]).stream() }), CAP)).toEqual({
      ok: false,
    })
    const lying = new Request(`${ORIGIN}/api/hello`, {
      method: 'POST',
      headers: { 'Content-Length': '2' },
      body: new Blob([big]).stream(),
    })
    expect(await readCappedBody(lying, CAP)).toEqual({ ok: false })
  })

  it('refuses invalid UTF-8 and an empty body', async () => {
    expect(await readCappedBody(request({ body: new Uint8Array([0xff, 0xfe]) }), CAP)).toEqual({
      ok: false,
    })
    expect(await readCappedBody(request({ body: null }), CAP)).toEqual({ ok: false })
  })
})

describe('parseJsonObject', () => {
  it('parses an object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, body: { a: 1 } })
  })

  it('refuses invalid JSON, arrays and primitives', () => {
    for (const text of ['{', '[]', '"text"', 'null', '', '1']) {
      expect(parseJsonObject(text)).toEqual({ ok: false })
    }
  })
})
