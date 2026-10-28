import type { D1Database } from '@cloudflare/workers-types'
import type { z } from 'zod'
import { FORM_BODY_CAP_MAX } from '../../../shared/forms/definition'
import {
  applicationSchema,
  bodyCapFor,
  submissionSchema,
  type StoredSubmission,
} from '../../../shared/forms/runtime'
import { findForm, formsOfKind, type StoredForm } from '../db/forms'
import type { FormRuntime } from './process'

/**
 * The run-time schema and body cap for stored forms (ADR-0010), built from
 * the current version and cached, since a published version never changes.
 */

type Schema = z.ZodType<StoredSubmission>

/**
 * Most schemas kept at once. Each publish adds a key, so without a cap an
 * isolate that lives through many publishes would keep every old one (Nadia,
 * #158). The oldest goes first; a dropped one is simply built again.
 */
export const RUNTIME_CACHE_MAX = 32

const cache = new Map<string, FormRuntime<Schema>>()

function cached(key: string, build: () => FormRuntime<Schema>): FormRuntime<Schema> {
  let runtime = cache.get(key)
  if (!runtime) {
    runtime = build()
    if (cache.size >= RUNTIME_CACHE_MAX) cache.delete(cache.keys().next().value!)
    cache.set(key, runtime)
  }
  return runtime
}

/** How many schemas are kept now, for tests. */
export function runtimeCacheSize(): number {
  return cache.size
}

/** An open form of kind `form`, with what its requests are checked against. */
export async function openForm(
  db: D1Database,
  slug: string,
): Promise<{ form: StoredForm; runtime: FormRuntime<Schema> }> {
  const form = await findForm(db, slug)
  const current = form?.current
  if (!form || form.kind !== 'form' || form.status !== 'open' || !current) {
    throw new Error('form_not_open')
  }
  const runtime = cached(`form:${form.id}:${current.version}`, () => ({
    schema: submissionSchema(current.definition, {
      kind: 'form',
      slug: form.slug,
    }) as unknown as Schema,
    bodyCap: bodyCapFor(current.definition, 'form'),
  }))
  return { form, runtime }
}

/**
 * Every application form, with one schema for `POST /api/apply`: the role
 * first, then that form's version. The cap is the largest of the open ones.
 */
export async function applicationForms(
  db: D1Database,
): Promise<{ forms: StoredForm[]; runtime: FormRuntime<Schema> }> {
  const forms = await formsOfKind(db, 'application')
  const key = forms
    .map((form) => `${form.id}:${form.status}:${form.current?.version ?? 0}`)
    .join(',')
  const runtime = cached(`application:${key}`, () => {
    const open = forms.filter((form) => form.status === 'open' && form.current)
    return {
      schema: applicationSchema(
        forms.map((form) => ({
          slug: form.slug,
          status: form.status,
          definition: form.current?.definition ?? null,
        })),
      ) as unknown as Schema,
      // With nothing open, every request is refused on its role, within the largest cap.
      bodyCap:
        open.length === 0
          ? FORM_BODY_CAP_MAX
          : Math.max(...open.map((form) => bodyCapFor(form.current!.definition, 'application'))),
    }
  })
  return { forms, runtime }
}
