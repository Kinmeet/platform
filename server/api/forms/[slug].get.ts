import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { toPublicForm, type PublicForm } from '../../../shared/forms/view'
import { findForm } from '../../utils/db/forms'
import { useDb } from '../../utils/db/env'
import { logFormCode } from '../../utils/forms/handler'

/**
 * An open form's current version, as its page draws it (ADR-0010, A2): the
 * steps, fields and wording, and nothing about who reads the answers or how
 * long they are kept. A draft, closed or unknown form is `404`. A stored
 * version that fails its checks is `503`, so a broken form is never drawn.
 */
export default defineEventHandler(
  async (
    event,
  ): Promise<
    { ok: true; form: PublicForm } | { ok: false; error: 'not_found' | 'unavailable' }
  > => {
    const slug = getRouterParam(event, 'slug') ?? ''
    try {
      const form = await findForm(useDb(event), slug)
      if (!form || form.status !== 'open' || !form.current) {
        setResponseStatus(event, 404)
        return { ok: false, error: 'not_found' }
      }
      return {
        ok: true,
        form: toPublicForm({
          slug: form.slug,
          kind: form.kind,
          version: form.current.version,
          definition: form.current.definition,
          text: form.current.text,
          purpose: form.current.purpose,
        }),
      }
    } catch {
      logFormCode('form_read_unavailable')
      setResponseStatus(event, 503)
      return { ok: false, error: 'unavailable' }
    }
  },
)
