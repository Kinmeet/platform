import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CACHE_MAX,
  openForm,
  runtimeCacheSize,
} from '../../../../../server/utils/forms/stored'

// The run-time schema cache for stored forms (ADR-0010). Made-up test data only.

/** An open copy of say hello's version 1, under a made-up slug. */
async function openCopy(slug: string) {
  const id = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, 'form', 'draft', 1)`,
    ).bind(id, slug),
    env.DB.prepare(
      `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
       SELECT ?, 1, purpose, definition, text, 1, 'test-actor' FROM form_versions
       WHERE form_id = (SELECT id FROM forms WHERE slug = 'hello') AND version = 1`,
    ).bind(id),
    env.DB.prepare(`UPDATE forms SET status = 'open', current_version = 1 WHERE id = ?`).bind(id),
  ])
}

describe('the run-time schema cache', () => {
  it('keeps one schema per version, and never more than its cap (Nadia, #158)', async () => {
    const first = await openForm(env.DB, 'hello')
    expect((await openForm(env.DB, 'hello')).runtime).toBe(first.runtime)

    for (let i = 0; i < RUNTIME_CACHE_MAX + 5; i++) {
      await openCopy(`sample-form-${i}`)
      await openForm(env.DB, `sample-form-${i}`)
    }
    expect(runtimeCacheSize()).toBe(RUNTIME_CACHE_MAX)

    // The oldest went first, and is built again, the same as before.
    const again = await openForm(env.DB, 'hello')
    expect(again.runtime).not.toBe(first.runtime)
    expect(again.runtime.bodyCap).toBe(first.runtime.bodyCap)
    expect(runtimeCacheSize()).toBe(RUNTIME_CACHE_MAX)
  })
})
