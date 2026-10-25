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
  data: hello,
  status: helloStatus,
  error: helloError,
  refresh: refreshHello,
} = useFetch<{ messages: AdminHelloMessage[] }>('/api/admin/messages', { server: false })
const {
  data: apply,
  status: applyStatus,
  error: applyError,
  refresh: refreshApply,
} = useFetch<{ applications: AdminApplication[] }>('/api/admin/applications', { server: false })

// Role and question wording comes from the role config's translations (#19).
// A slug or question id with no wording (a question since removed, or a role
// not yet translated) is shown as the id itself, so nothing is hidden.
const roleLabel = (role: string) => (te(`roles.${role}.title`) ? t(`roles.${role}.title`) : role)
const questionLabel = (role: string, question: string) =>
  te(`roles.${role}.questions.${question}.label`)
    ? t(`roles.${role}.questions.${question}.label`)
    : question

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
</script>

<template>
  <main class="admin">
    <h1>{{ t('admin.title') }}</h1>
    <p>{{ t('admin.lead') }}</p>
    <p class="admin__status" role="status">{{ announcement }}</p>

    <section aria-labelledby="hello-heading">
      <h2 id="hello-heading">{{ t('admin.hello.heading') }}</h2>
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
        </li>
      </ul>
    </section>

    <section aria-labelledby="applications-heading">
      <h2 id="applications-heading">{{ t('admin.applications.heading') }}</h2>
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
              <dt>{{ questionLabel(application.role, String(question)) }}</dt>
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
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.admin {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

.admin__list {
  list-style: none;
  padding: 0;
}

.admin__item {
  border-top: 1px solid var(--colour-ink-soft);
  padding: 1rem 0;
}

.admin__item dl {
  display: grid;
  grid-template-columns: minmax(0, max-content) 1fr;
  gap: 0.25rem 1rem;
}

.admin__item dt {
  overflow-wrap: anywhere;
}

@media (max-width: 30rem) {
  .admin__item dl {
    grid-template-columns: 1fr;
  }

  .admin__item dt {
    font-weight: 700;
  }
}

.admin__item dd {
  margin: 0;
}

.admin__message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.admin__note {
  font-weight: 700;
}

.admin button {
  font: inherit;
  padding: 0.5rem 1rem;
  border: 2px solid var(--colour-moss);
  border-radius: 0.5rem;
  background: var(--colour-moss);
  color: var(--colour-ground);
  cursor: pointer;
}

.admin button[aria-disabled='true'] {
  opacity: 0.6;
  cursor: wait;
}

.admin button:focus-visible,
.admin h3:focus-visible {
  outline: 3px solid var(--colour-ink);
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
