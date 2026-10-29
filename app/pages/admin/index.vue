<script setup lang="ts">
// The founder's admin page (#32). Behind Cloudflare Access on the deployed
// Workers, and checked again on the server. Data is fetched in the browser,
// so the request carries the visitor's own Access session.
import type { AdminApplication, AdminHelloMessage } from '../../../shared/admin'

const { t, te } = useI18n()

useHead({
  title: () => t('admin.title'),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeZone: 'Europe/London',
})
const formatDate = (seconds: number | null) =>
  seconds === null ? '' : dateFormat.format(new Date(seconds * 1000))

const {
  data: helloData,
  status: helloStatus,
  error: helloError,
  refresh: refreshHello,
} = useFetch<{ messages: AdminHelloMessage[] }>('/api/admin/messages', { server: false })
const {
  data: applyData,
  status: applyStatus,
  error: applyError,
  refresh: refreshApply,
} = useFetch<{ applications: AdminApplication[] }>('/api/admin/applications', { server: false })

// The last list that loaded. A failed refresh clears useFetch's data, and the
// list must stay on the page so focus is not lost; the status message says
// the refresh failed instead.
const hello = ref<{ messages: AdminHelloMessage[] } | null>(null)
const apply = ref<{ applications: AdminApplication[] } | null>(null)
watch(helloData, (value) => {
  if (value) hello.value = value
})
watch(applyData, (value) => {
  if (value) apply.value = value
})

// Role wording comes from the role config's translations (#19); a role not
// yet translated is shown as its slug, so nothing is hidden. Each question is
// labelled by the version its answer was sent on (Theo, #159).
const roleLabel = (role: string) => (te(`roles.${role}.title`) ? t(`roles.${role}.title`) : role)

const announcement = ref('')
const busy = ref<string | null>(null)

// Lists stay mounted while they refresh, and buttons use aria-disabled
// rather than disabled, so keyboard focus is never dropped to the body.
async function act(
  url: string,
  done: string,
  refresh: () => Promise<void>,
  refreshFailed: () => boolean,
): Promise<boolean> {
  if (busy.value !== null) return false
  busy.value = url
  announcement.value = ''
  try {
    await $fetch(url, { method: 'POST' })
  } catch {
    announcement.value = t('admin.actionFailed')
    busy.value = null
    return false
  }
  await refresh()
  announcement.value = refreshFailed() ? t('admin.refreshFailed') : done
  busy.value = null
  return true
}

const markReplied = (message: AdminHelloMessage) =>
  act(
    `/api/admin/hello/${message.id}/replied`,
    t('admin.hello.repliedDone', { name: message.callName }),
    refreshHello,
    () => Boolean(helloError.value),
  )

// The button removes itself once the outcome is told, so focus moves to the
// application's heading rather than being lost.
async function markOutcomeTold(application: AdminApplication) {
  const done = await act(
    `/api/admin/applications/${application.id}/outcome-told`,
    t('admin.applications.outcomeToldDone', { name: application.callName }),
    refreshApply,
    () => Boolean(applyError.value),
  )
  if (!done) return
  await nextTick()
  document.getElementById(`application-${application.id}`)?.focus()
}

// Passing to safeguarding removes the item from the list, so focus moves to
// the list's heading. The announcement reminds the reader to tell the lead.
async function passToSafeguarding(
  kind: 'hello' | 'applications',
  id: string,
  refresh: () => Promise<void>,
  refreshFailed: () => boolean,
) {
  const done = await act(
    `/api/admin/${kind}/${id}/safeguarding`,
    t('admin.safeguarding.done'),
    refresh,
    refreshFailed,
  )
  if (!done) return
  await nextTick()
  document.getElementById(kind === 'hello' ? 'hello-heading' : 'applications-heading')?.focus()
}
</script>

<template>
  <main class="admin">
    <AdminNav />
    <h1>{{ t('admin.title') }}</h1>
    <p>{{ t('admin.lead') }}</p>
    <p class="admin__status" role="status">{{ announcement }}</p>

    <section aria-labelledby="hello-heading">
      <h2 id="hello-heading" tabindex="-1">{{ t('admin.hello.heading') }}</h2>
      <p v-if="helloStatus === 'pending' && !hello">{{ t('admin.loading') }}</p>
      <p v-else-if="helloStatus === 'error' && !hello">{{ t('admin.loadFailed') }}</p>
      <p v-else-if="!hello?.messages.length">{{ t('admin.hello.empty') }}</p>
      <ul v-else class="admin__list">
        <li v-for="message in hello.messages" :key="message.id" class="admin__item">
          <h3>{{ message.callName }}</h3>
          <dl>
            <dt>{{ t('admin.email') }}</dt>
            <dd>{{ message.email }}</dd>
            <dt>{{ t('admin.received') }}</dt>
            <dd>{{ formatDate(message.receivedAt) }}</dd>
            <dt>{{ t('admin.hello.replied') }}</dt>
            <dd>
              {{
                message.repliedAt === null
                  ? t('admin.hello.notReplied')
                  : formatDate(message.repliedAt)
              }}
            </dd>
            <dt>{{ t('admin.deleteAfter') }}</dt>
            <dd>{{ formatDate(message.deleteAfter) }}</dd>
          </dl>
          <p class="admin__message">{{ message.message }}</p>
          <button
            type="button"
            :aria-disabled="busy !== null ? 'true' : undefined"
            @click="markReplied(message)"
          >
            {{ t('admin.hello.markReplied') }}
            <span class="visually-hidden">{{
              t('admin.forName', { name: message.callName })
            }}</span>
          </button>
          <AdminPassToSafeguarding
            :name="message.callName"
            :busy="busy !== null"
            @confirm="
              passToSafeguarding('hello', message.id, refreshHello, () => Boolean(helloError))
            "
          />
        </li>
      </ul>
    </section>

    <section aria-labelledby="applications-heading">
      <h2 id="applications-heading" tabindex="-1">{{ t('admin.applications.heading') }}</h2>
      <p v-if="applyStatus === 'pending' && !apply">{{ t('admin.loading') }}</p>
      <p v-else-if="applyStatus === 'error' && !apply">{{ t('admin.loadFailed') }}</p>
      <p v-else-if="!apply?.applications.length">{{ t('admin.applications.empty') }}</p>
      <ul v-else class="admin__list">
        <li v-for="application in apply.applications" :key="application.id" class="admin__item">
          <h3 :id="`application-${application.id}`" tabindex="-1">{{ application.callName }}</h3>
          <p v-if="application.conflictToDeclare" class="admin__note">
            {{ t('admin.applications.conflict') }}
          </p>
          <dl>
            <dt>{{ t('admin.applications.role') }}</dt>
            <dd>{{ roleLabel(application.role) }}</dd>
            <dt>{{ t('admin.email') }}</dt>
            <dd>{{ application.email }}</dd>
            <dt>{{ t('admin.applications.connection') }}</dt>
            <dd>
              {{ t(`admin.applications.connectionAnswers.${application.connectionToFounders}`) }}
            </dd>
            <dt>{{ t('admin.received') }}</dt>
            <dd>{{ formatDate(application.receivedAt) }}</dd>
            <dt>{{ t('admin.applications.outcomeTold') }}</dt>
            <dd>
              {{
                application.outcomeToldAt === null
                  ? t('admin.applications.outcomeNotTold')
                  : formatDate(application.outcomeToldAt)
              }}
            </dd>
            <dt>{{ t('admin.deleteAfter') }}</dt>
            <dd>{{ formatDate(application.deleteAfter) }}</dd>
          </dl>
          <dl class="admin__answers">
            <template v-for="(answer, question) in application.answers" :key="question">
              <dt>{{ application.labels[question] ?? question }}</dt>
              <dd class="admin__message">{{ answer }}</dd>
            </template>
          </dl>
          <button
            v-if="application.outcomeToldAt === null"
            type="button"
            :aria-disabled="busy !== null ? 'true' : undefined"
            @click="markOutcomeTold(application)"
          >
            {{ t('admin.applications.markOutcomeTold') }}
            <span class="visually-hidden">{{
              t('admin.forName', { name: application.callName })
            }}</span>
          </button>
          <AdminPassToSafeguarding
            :name="application.callName"
            :busy="busy !== null"
            @confirm="
              passToSafeguarding('applications', application.id, refreshApply, () =>
                Boolean(applyError),
              )
            "
          />
        </li>
      </ul>
    </section>
  </main>
</template>
