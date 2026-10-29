<script setup lang="ts">
// Publishing a form's draft (ADR-0010, B3, #160). A page of its own, reached
// by a link and never by a fetch from the builder, so Cloudflare Access can
// ask the admin to sign in again before a change reaches the public (Ade,
// #160). The page shows the checks publishing will run, then Publish posts
// to the API and shows what came back. If Access needs a fresh sign-in, the
// page says so plainly and links to itself: following the link reloads it,
// which takes the admin through sign-in. Nothing is retried on its own.
import type { AdminFormCheck, AdminFormDetail } from '#shared/admin'
import type { FormDefinition } from '#shared/forms/definition'

const { t } = useI18n()
const route = useRoute()
const id = String(route.params.id)
const builderPath = `/admin/forms/${id}`

const { data: detail, status } = useFetch<{ ok: true } & AdminFormDetail>(
  `/api/admin/forms/${encodeURIComponent(id)}`,
  { server: false },
)
const { data: checked } = useFetch<{ ok: true; check: AdminFormCheck }>(
  `/api/admin/forms/${encodeURIComponent(id)}/check`,
  { server: false },
)

const check = ref<AdminFormCheck | null>(null)
watch(checked, (value) => {
  if (value) check.value = value.check
})

const draft = computed(() => detail.value?.draft ?? null)
const definition = computed(() => draft.value?.definition as FormDefinition | undefined)
const text = computed(
  () => (draft.value?.text as Record<string, Record<string, string>> | undefined)?.['en-GB'] ?? {},
)
const title = computed(() => text.value.title?.trim() || detail.value?.form.slug || '')
const nextVersion = computed(() => (detail.value?.form.version ?? 0) + 1)

useHead({
  title: () => t('admin.forms.publish.pageTitle', { title: title.value }),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

/** What the last Publish came to. */
type Outcome =
  | { kind: 'published'; version: number }
  | { kind: 'reauth' }
  | { kind: 'forbidden' }
  | { kind: 'checks' }
  | { kind: 'changed' }
  | { kind: 'no_draft' }
  | { kind: 'failed' }

const outcome = ref<Outcome | null>(null)
const publishing = ref(false)
const outcomeView = ref<HTMLElement | null>(null)

async function publish() {
  if (publishing.value) return
  publishing.value = true
  outcome.value = null
  type Reply = { ok?: boolean; error?: string; version?: number; check?: AdminFormCheck }
  let response: { status: number; ok: boolean; _data?: Reply | null }
  try {
    response = await $fetch.raw<Reply>(`/api/admin/forms/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: {},
      ignoreResponseError: true,
    })
  } catch {
    return show({ kind: 'failed' })
  } finally {
    publishing.value = false
  }
  const reply = response._data ?? null
  if (response.ok && reply?.ok && typeof reply.version === 'number')
    return show({ kind: 'published', version: reply.version })
  const error = reply?.error
  if (response.status === 403)
    return show({ kind: error === 'reauth_required' ? 'reauth' : 'forbidden' })
  if (response.status === 422 && error === 'checks_failed' && reply?.check) {
    check.value = reply.check
    return show({ kind: 'checks' })
  }
  if (response.status === 409) return show({ kind: 'changed' })
  if (response.status === 404) return show({ kind: 'no_draft' })
  return show({ kind: 'failed' })
}

async function show(next: Outcome) {
  outcome.value = next
  await nextTick()
  outcomeView.value?.focus()
}

const canPublish = computed(
  () => draft.value !== null && check.value?.ok === true && outcome.value?.kind !== 'published',
)
</script>

<template>
  <main class="admin">
    <AdminNav />
    <p v-if="status === 'pending' && !detail">{{ t('admin.loading') }}</p>
    <template v-else-if="!detail">
      <h1>{{ t('admin.forms.publish.heading') }}</h1>
      <p>{{ t('admin.forms.builder.notFound') }}</p>
      <NuxtLink to="/admin/forms">{{ t('admin.forms.backToList') }}</NuxtLink>
    </template>
    <template v-else>
      <h1>{{ t('admin.forms.publish.pageTitle', { title }) }}</h1>

      <div
        v-if="outcome"
        ref="outcomeView"
        class="admin-outcome"
        :class="{ 'admin-outcome--done': outcome.kind === 'published' }"
        tabindex="-1"
        role="group"
        aria-labelledby="outcome-heading"
      >
        <h2 id="outcome-heading">{{ t(`admin.forms.publish.outcome.${outcome.kind}.heading`) }}</h2>
        <p v-if="outcome.kind === 'published'">
          {{ t('admin.forms.publish.outcome.published.body', { version: outcome.version }) }}
        </p>
        <p v-else>{{ t(`admin.forms.publish.outcome.${outcome.kind}.body`) }}</p>
        <!-- A plain link, so following it loads the page again through Access. -->
        <!-- After the publish sign-in's short session ends, Access answers the
             post with a sign-in redirect, which a fetch can't follow: that
             shows as "failed", and reloading signs in again (ADR-0010). -->
        <p v-if="['reauth', 'changed', 'failed'].includes(outcome.kind)">
          <a :href="route.fullPath">{{ t('admin.forms.publish.reload') }}</a>
        </p>
        <p v-if="outcome.kind === 'published'">
          <NuxtLink :to="builderPath">{{ t('admin.forms.publish.backToBuilder') }}</NuxtLink>
        </p>
      </div>

      <template v-if="outcome?.kind !== 'published'">
        <p v-if="!draft">{{ t('admin.forms.publish.noDraft') }}</p>
        <template v-else>
          <p>{{ t('admin.forms.publish.lead', { version: nextVersion }) }}</p>
          <section aria-labelledby="checks-heading">
            <h2 id="checks-heading">{{ t('admin.forms.checks.heading') }}</h2>
            <p v-if="!check">{{ t('admin.loading') }}</p>
            <AdminFormChecks
              v-else-if="definition"
              :check="check"
              :definition="definition"
              :text="text"
              :builder-path="builderPath"
            />
          </section>
          <p>{{ t('admin.forms.publish.whatHappens') }}</p>
          <button
            type="button"
            class="button button--primary"
            :aria-disabled="canPublish && !publishing ? undefined : 'true'"
            aria-describedby="publish-hint"
            @click="canPublish && publish()"
          >
            {{ t('admin.forms.publish.button', { version: nextVersion }) }}
          </button>
          <p id="publish-hint" class="hint" role="status">
            {{ publishing ? t('admin.forms.publish.publishing') : t('admin.forms.publish.hint') }}
          </p>
        </template>
        <p>
          <NuxtLink :to="builderPath">{{ t('admin.forms.publish.backToBuilder') }}</NuxtLink>
        </p>
      </template>
    </template>
  </main>
</template>
