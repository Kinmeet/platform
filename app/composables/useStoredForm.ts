import type { PublicForm } from '#shared/forms/view'

/**
 * An open form's current version, for its page (ADR-0010, A2). Fetched while
 * the page renders, so it is in the server's HTML and drawn without a wait. A
 * form that isn't open is a 404, and one that can't be loaded is the error
 * page: a broken form is never drawn.
 */
export async function useStoredForm(slug: string): Promise<PublicForm> {
  const { data, error } = await useFetch<{ ok: true; form: PublicForm }>(
    `/api/forms/${encodeURIComponent(slug)}`,
    { key: `form:${slug}` },
  )
  if (error.value || !data.value?.ok) {
    const statusCode = error.value?.statusCode === 404 ? 404 : 503
    throw createError({
      statusCode,
      statusMessage: statusCode === 404 ? 'Not Found' : 'Service Unavailable',
      fatal: true,
    })
  }
  return data.value.form
}
