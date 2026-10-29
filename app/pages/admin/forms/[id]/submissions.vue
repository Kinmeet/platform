<script setup lang="ts">
// One form's submissions (ADR-0010, B3, #160): the generic review screen
// every stored form shares. What can be done to each one (reply, outcome
// told, pass to safeguarding) comes from the version it was sent on, and so
// does every question's wording. Opening the list writes an audit entry on
// the server. Behind Cloudflare Access; data is fetched in the browser, so
// each request carries the visitor's own Access session (#32). Answers are
// sender text and labels are admin text: both are only ever shown as text.
import type { AdminFormDetail, AdminSubmission } from '#shared/admin'

const { t } = useI18n()
const route = useRoute()
const id = String(route.params.id)

const { data: detail } = useFetch<{ ok: true } & AdminFormDetail>(
  `/api/admin/forms/${encodeURIComponent(id)}`,
  { server: false },
)
const {
  data: listData,
  status,
  error,
  refresh,
} = useFetch<{ ok: true; submissions: AdminSubmission[] }>(
  `/api/admin/forms/${encodeURIComponent(id)}/submissions`,
  { server: false },
)

// The last list that loaded. A failed refresh clears useFetch's data, and the
// list must stay on the page so focus is not lost (as on the admin page).
const list = ref<AdminSubmission[] | null>(null)
watch(listData, (value) => {
  if (value) list.value = value.submissions
})

const title = computed(() => {
  const text = (
    detail.value?.current?.text as Record<string, Record<string, string>> | undefined
  )?.['en-GB']
  return text?.title?.trim() || detail.value?.form.slug || ''
})

useHead({
  title: () => t('admin.forms.submissions.pageTitle', { title: title.value }),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeZone: 'Europe/London',
})
const formatDate = (seconds: number | null) =>
  seconds === null ? '' : dateFormat.format(new Date(seconds * 1000))

const announcement = ref('')
const busy = ref(false)

// Buttons use aria-disabled rather than disabled, and the list stays mounted
// while it refreshes, so keyboard focus is never dropped to the body.
async function act(path: string, done: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  announcement.value = ''
  try {
    await $fetch(path, { method: 'POST' })
  } catch {
    announcement.value = t('admin.actionFailed')
    busy.value = false
    return false
  }
  await refresh()
  announcement.value = error.value ? t('admin.refreshFailed') : done
  busy.value = false
  return true
}

// Each button removes itself once used, so focus moves to the submission's heading.
async function record(submission: AdminSubmission, action: 'replied' | 'outcome-told') {
  const done = await act(
    `/api/admin/submissions/${submission.id}/${action}`,
    t(action === 'replied' ? 'admin.hello.repliedDone' : 'admin.applications.outcomeToldDone', {
      name: submission.callName,
    }),
  )
  if (!done) return
  await nextTick()
  document.getElementById(`submission-${submission.id}`)?.focus()
}

// Passing to safeguarding removes the item from the list, so focus moves to
// the list's heading. The announcement reminds the reader to tell the lead.
async function passToSafeguarding(submission: AdminSubmission) {
  const done = await act(
    `/api/admin/submissions/${submission.id}/safeguarding`,
    t('admin.safeguarding.done'),
  )
  if (!done) return
  await nextTick()
  document.getElementById('submissions-heading')?.focus()
}
</script>

<template>
  <main class="admin">
    <AdminNav />
    <h1>{{ t('admin.forms.submissions.pageTitle', { title }) }}</h1>
    <p>{{ t('admin.forms.submissions.lead') }}</p>
    <p class="admin__status" role="status">{{ announcement }}</p>

    <section aria-labelledby="submissions-heading">
      <h2 id="submissions-heading" tabindex="-1">{{ t('admin.forms.submissions.heading') }}</h2>
      <p v-if="status === 'pending' && !list">{{ t('admin.loading') }}</p>
      <p v-else-if="status === 'error' && !list">{{ t('admin.loadFailed') }}</p>
      <p v-else-if="!list?.length">{{ t('admin.forms.submissions.empty') }}</p>
      <ul v-else class="admin__list">
        <li v-for="submission in list" :key="submission.id" class="admin__item">
          <h3 :id="`submission-${submission.id}`" tabindex="-1">{{ submission.callName }}</h3>
          <dl>
            <dt>{{ t('admin.email') }}</dt>
            <dd>{{ submission.email }}</dd>
            <dt>{{ t('admin.received') }}</dt>
            <dd>{{ formatDate(submission.receivedAt) }}</dd>
            <template v-if="submission.actions.includes('reply')">
              <dt>{{ t('admin.hello.replied') }}</dt>
              <dd>
                {{
                  submission.repliedAt === null
                    ? t('admin.hello.notReplied')
                    : formatDate(submission.repliedAt)
                }}
              </dd>
            </template>
            <template v-if="submission.actions.includes('outcome_told')">
              <dt>{{ t('admin.applications.outcomeTold') }}</dt>
              <dd>
                {{
                  submission.outcomeToldAt === null
                    ? t('admin.applications.outcomeNotTold')
                    : formatDate(submission.outcomeToldAt)
                }}
              </dd>
            </template>
            <dt>{{ t('admin.deleteAfter') }}</dt>
            <dd>{{ formatDate(submission.deleteAfter) }}</dd>
            <dt>{{ t('admin.forms.submissions.version') }}</dt>
            <dd>{{ submission.version }}</dd>
          </dl>
          <dl class="admin__answers">
            <template v-for="answer in submission.answers" :key="answer.id">
              <dt>{{ answer.label || answer.id }}</dt>
              <dd class="admin__message">{{ answer.text }}</dd>
            </template>
          </dl>
          <div class="admin-actions">
            <button
              v-if="submission.actions.includes('reply')"
              type="button"
              :aria-disabled="busy ? 'true' : undefined"
              @click="record(submission, 'replied')"
            >
              {{ t('admin.hello.markReplied') }}
              <span class="visually-hidden">{{
                t('admin.forName', { name: submission.callName })
              }}</span>
            </button>
            <button
              v-if="
                submission.actions.includes('outcome_told') && submission.outcomeToldAt === null
              "
              type="button"
              :aria-disabled="busy ? 'true' : undefined"
              @click="record(submission, 'outcome-told')"
            >
              {{ t('admin.applications.markOutcomeTold') }}
              <span class="visually-hidden">{{
                t('admin.forName', { name: submission.callName })
              }}</span>
            </button>
          </div>
          <AdminPassToSafeguarding
            v-if="submission.actions.includes('pass_to_safeguarding')"
            :name="submission.callName"
            :busy="busy"
            @confirm="passToSafeguarding(submission)"
          />
        </li>
      </ul>
    </section>
  </main>
</template>
