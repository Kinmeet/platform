import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_BYTES,
  isSameOriginJsonPost,
  readCappedJson,
} from '../../../../../server/utils/forms/request'

const URL_ = 'https://kinmeet-staging.kinmeet.workers.dev/api/hello'
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'

function request(
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {},
) {
  return new Request(URL_, {
    method: init.method ?? 'POST',
    headers: init.headers ?? {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: init.body === undefined ? '{}' : init.body,
  })
}

describe('same origin JSON POST check', () => {
  it('accepts our own page', () => {
    expect(isSameOriginJsonPost(request())).toBe(true)
    expect(
      isSameOriginJsonPost(
        request({ headers: { Origin: ORIGIN, 'Content-Type': 'application/json; charset=utf-8' } }),
      ),
    ).toBe(true)
  })

  it('refuses another origin, a missing origin or a cross-site fetch', () => {
    expect(
      isSameOriginJsonPost(
        request({ headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' } }),
      ),
    ).toBe(false)
    expect(isSameOriginJsonPost(request({ headers: { 'Content-Type': 'application/json' } }))).toBe(
      false,
    )
    expect(
      isSameOriginJsonPost(
        request({
          headers: {
            Origin: ORIGIN,
            'Content-Type': 'application/json',
            'Sec-Fetch-Site': 'cross-site',
          },
        }),
      ),
    ).toBe(false)
  })

  it('refuses other methods and content types', () => {
    expect(isSameOriginJsonPost(request({ method: 'PUT' }))).toBe(false)
    expect(
      isSameOriginJsonPost(request({ headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' } })),
    ).toBe(false)
    expect(
      isSameOriginJsonPost(
        request({
          headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      ),
    ).toBe(false)
  })
})

describe('capped JSON body', () => {
  it('parses a JSON object', async () => {
    expect(await readCappedJson(request({ body: '{"callName":"Test Fox"}' }))).toEqual({
      ok: true,
      body: { callName: 'Test Fox' },
    })
  })

  it('refuses a body over 16 KB, even without a Content-Length', async () => {
    const big = JSON.stringify({ message: 'x'.repeat(MAX_BODY_BYTES) })
    expect(await readCappedJson(request({ body: big }))).toEqual({ ok: false })
    const stream = new Blob([big]).stream()
    expect(await readCappedJson(request({ body: stream }))).toEqual({ ok: false })
  })

  it('accepts a body exactly at the cap', async () => {
    const padding = MAX_BODY_BYTES - '{"m":""}'.length
    expect((await readCappedJson(request({ body: `{"m":"${'x'.repeat(padding)}"}` }))).ok).toBe(
      true,
    )
  })

  it('refuses invalid JSON, arrays, primitives and an empty body', async () => {
    for (const body of ['{', '[]', '"text"', 'null', '']) {
      expect(await readCappedJson(request({ body }))).toEqual({ ok: false })
    }
    expect(await readCappedJson(request({ body: null }))).toEqual({ ok: false })
  })
})
