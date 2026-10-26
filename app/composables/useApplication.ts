import { findRole, publishedRoles, type PublishedRole } from '#shared/forms/roles'

/** The published role for a slug from the URL, or a 404 (Q3, #21). */
export function requirePublishedRole(slug: unknown): PublishedRole {
  const role = typeof slug === 'string' ? findRole(slug) : undefined
  if (!role?.published) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  return role
}

/** What the sent page shows, kept once the draft is emptied (#17). */
export interface ApplicationSent {
  role: string
  callName: string
  receipt: Receipt
}

/**
 * The sent page's state. Shared with the focused layout, which swaps Leave
 * for "Back to the roles" once there's nothing left to leave (#17).
 */
export function useApplicationSent() {
  return useState<ApplicationSent | null>('apply:sent', () => null)
}

/**
 * One visit's application for a role (#21). The draft is held in memory only:
 * never in localStorage, sessionStorage or a cookie. Reloading the page
 * starts again. Leave empties it (`useLeaveApplication`), whichever way the
 * navigation happens, and so does a successful send.
 *
 * The step is in the URL (`?step=2`) so Back and Forward work, but a step is
 * only shown once the steps before it are done.
 */
export function useApplication(role: PublishedRole) {
  const route = useRoute()
  const router = useRouter()

  // Made in the browser only, so the submission id is never in the server's HTML.
  const draft = useState<ApplicationDraft | null>(`apply:${role.slug}`, () =>
    import.meta.client ? createDraft(role) : null,
  )
  if (import.meta.client && !draft.value) draft.value = createDraft(role)

  /** Why the guard last moved the visitor, for one announced line. Cleared by `goTo`. */
  const redirected = ref<RedirectReason>()

  const sentState = useApplicationSent()
  const sent = computed(() => (sentState.value?.role === role.slug ? sentState.value : null))
  // The sent page lasts until the visitor goes somewhere else. Not a route
  // guard: one would hold up Leave long enough for the step guard below to
  // cancel it once Leave empties the draft.
  onBeforeUnmount(() => {
    sentState.value = null
  })

  const step = computed<Step>(() =>
    draft.value ? allowedStep(route.query.step, draft.value, role) : 1,
  )
  const stopped = computed(() => (draft.value ? stopReason(draft.value, role) : undefined))

  // Sends anyone who asked for a step they can't have yet back to the right one.
  watch(
    () => [route.query.step, step.value] as const,
    ([asked, allowed]) => {
      if (!import.meta.client || !draft.value || String(asked ?? '1') === String(allowed)) return
      // Once sent, the emptied draft moves the URL back to step 1 with nothing to explain.
      if (!sent.value) redirected.value = redirectReason(asked, draft.value, role)
      router.replace({ query: { ...route.query, step: allowed === 1 ? undefined : allowed } })
    },
    { immediate: true },
  )

  function goTo(target: Step) {
    redirected.value = undefined
    return router.push({ query: { ...route.query, step: target === 1 ? undefined : target } })
  }

  /**
   * Empties every answer and starts a new submission id. Call it only on
   * Leave or after a successful send: a failed send keeps the draft and its
   * id, so trying again can never store a duplicate.
   */
  function clear() {
    if (draft.value) clearDraft(draft.value)
  }

  /** After a successful send: show the sent page, then empty the answers. */
  function finish(receipt: Receipt) {
    if (!draft.value) return
    sentState.value = { role: role.slug, callName: draft.value.callName.trim(), receipt }
    clear()
  }

  return { draft, step, stopped, redirected, sent, goTo, clear, finish }
}

/**
 * For Leave: empties every role's draft. Leave is a client-side link, so the
 * answers would otherwise stay in memory, and its label promises they won't
 * be kept (Theo, #78). Call it in setup and run the result on click.
 */
export function useLeaveApplication() {
  const drafts = publishedRoles().map((role) =>
    useState<ApplicationDraft | null>(`apply:${role.slug}`, () => null),
  )
  const sent = useApplicationSent()
  return () => {
    for (const draft of drafts) if (draft.value) clearDraft(draft.value)
    sent.value = null
  }
}
