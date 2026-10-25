<script setup lang="ts">
// The founder's admin page (#32). Behind Cloudflare Access on the deployed
// Workers, and checked again on the server. Data is fetched in the browser,
// so the request carries the visitor's own Access session.
import type { AdminApplication, AdminHelloMessage } from '../../../shared/admin'

const { t } = useI18n()

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
  refresh: refreshHello,
} = useFetch<{ messages: AdminHelloMessage[] }>('/api/admin/messages', { server: false })
const {
  data: apply,
  status: applyStatus,
  refresh: refreshApply,
} = useFetch<{ applications: AdminApplication[] }>('/api/admin/applications', { server: false })

const announcement = ref('')
const busy = ref<string | null>(null)

async function act(url: string, done: string, refresh: () => Promise<void>) {
  busy.value = url
  announcement.value = ''
  try {
    await $fetch(url, { method: 'POST' })
    await refresh()
    announcement.value = done
  } catch {
    announcement.value = t('admin.actionFailed')
  } finally {
    busy.value = null
  }
}

const markReplied = (message: AdminHelloMessage) =>
  act(
    `/api/admin/hello/${message.id}/replied`,
    t('admin.hello.repliedDone', { name: message.callName }),
    refreshHello,
  )

const markOutcomeTold = (application: AdminApplication) =>
  act(
    `/api/admin/applications/${application.id}/outcome-told`,
    t('admin.applications.outcomeToldDone', { name: application.callName }),
    refreshApply,
  )
</script>

<template>
  <main class="admin">
    <h1>{{ t('admin.title') }}</h1>
    <p>{{ t('admin.lead') }}</p>
    <p class="admin__status" role="status" aria-live="polite">{{ announcement }}</p>

    <section aria-labelledby="hello-heading">
      <h2 id="hello-heading">{{ t('admin.hello.heading') }}</h2>
      <p v-if="helloStatus === 'pending'">{{ t('admin.loading') }}</p>
      <p v-else-if="helloStatus === 'error'">{{ t('admin.loadFailed') }}</p>
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
          <button type="button" :disabled="busy !== null" @click="markReplied(message)">
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
      <p v-if="applyStatus === 'pending'">{{ t('admin.loading') }}</p>
      <p v-else-if="applyStatus === 'error'">{{ t('admin.loadFailed') }}</p>
      <p v-else-if="!apply?.applications.length">{{ t('admin.applications.empty') }}</p>
      <ul v-else class="admin__list">
        <li v-for="application in apply.applications" :key="application.id" class="admin__item">
          <h3>{{ application.callName }}</h3>
          <p v-if="application.conflictToDeclare" class="admin__note">
            {{ t('admin.applications.conflict') }}
          </p>
          <dl>
            <dt>{{ t('admin.applications.role') }}</dt>
            <dd>{{ application.role }}</dd>
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
              <dt>{{ question }}</dt>
              <dd class="admin__message">{{ answer }}</dd>
            </template>
          </dl>
          <button
            v-if="application.outcomeToldAt === null"
            type="button"
            :disabled="busy !== null"
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
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
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

.admin button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.admin button:focus-visible {
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
