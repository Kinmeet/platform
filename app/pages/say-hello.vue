<script setup lang="ts">
// Say hello (#14, W5), drawn from its stored form (ADR-0010, A2): call name,
// email and the version's own questions (today, a message), nothing else.
// Checked with the API's own run-time schema, sent to `POST /api/hello` with
// a spam check token, and every reply in docs/api/forms.md is shown: sent,
// errors, a refused spam check, or "That didn't send" with Copy my message.
// What was typed is held in memory only and kept on any failure. The route
// is a form page, so the spam check loads with it (S5), and moving onto or
// off it loads a new document (#20).
import { privacyPage } from '#shared/pages/privacy'
import { fieldPath, shownFieldIds } from '#shared/forms/view'
import { hasPage } from '#shared/site-nav'

const { t } = useI18n()
const form = await useStoredForm('hello')
// A one-page form: "About you" sits before the step at `aboutYou`.
const step = form.definition.steps[0]!
const parts = form.definition.aboutYou === 0 ? ['about_you', 'step'] : ['step', 'about_you']

// The privacy notice link waits for its page (Sprint 2), like the footer's.
const PRIVACY_PATH = privacyPage.path
const privacyLink = hasPage(PRIVACY_PATH)

const draft = ref<HelloDraft | null>(import.meta.client ? createHelloDraft() : null)
const errors = ref<FieldError[]>([])
const problem = ref<SendProblem>()
const sending = ref(false)
/** The call name the last message was sent with, once it's stored. */
const sentName = ref<string>()

const summary = ref<{ focus: () => void } | null>(null)
const failedView = ref<{ focus: () => void } | null>(null)
const sentHeading = ref<HTMLElement | null>(null)
const formHeading = ref<HTMLElement | null>(null)
const turnstile = ref<{ getToken: () => Promise<string>; reset: () => void } | null>(null)

useHead({
  title: () => {
    if (sentName.value !== undefined) return t('hello.sent.page_title')
    return t(errors.value.length ? 'hello.page_title_error' : 'hello.page_title')
  },
  meta: [{ name: 'description', content: () => form.text.intro ?? form.text.title }],
})

function wordsFor(error: FieldError) {
  const message = helloErrorMessage(error, form)
  return { message: t(message.key, message.params), question: questionText(message.question, t) }
}

function messageFor(field: string): string | undefined {
  const error = errors.value.find((item) => item.field === field)
  return error ? wordsFor(error).message : undefined
}

const summaryItems = computed<ErrorSummaryItem[]>(() =>
  errors.value.map((error) => ({
    target: fieldId(error.field),
    text: t('apply.errors.summary_item', wordsFor(error)),
  })),
)
const copyText = computed(() => (draft.value ? helloText(draft.value, form, t) : ''))
const shown = computed(() =>
  draft.value ? shownFieldIds(form.definition, draft.value.values) : new Set<string>(),
)

async function showErrors(found: FieldError[]) {
  problem.value = undefined
  errors.value = found
  await nextTick()
  summary.value?.focus()
}

async function showProblem(reason: SendProblem) {
  errors.value = []
  problem.value = reason
  await nextTick()
  failedView.value?.focus()
}

async function onSend() {
  if (!draft.value || sending.value) return
  const found = helloErrors(draft.value, form)
  if (found.length) return showErrors(found)

  sending.value = true
  try {
    let token: string
    try {
      token = await turnstile.value!.getToken()
    } catch (error) {
      // A failed challenge can be tried again; a script that never loaded can't.
      if (error instanceof TurnstileError && error.reason === 'failed') {
        return showErrors([{ field: TURNSTILE_FIELD, code: 'turnstile_failed' }])
      }
      return showProblem('spam_check')
    }
    const outcome = await post(toHelloRequest(draft.value, form, token))
    // Every token is single use, whatever came back (#20).
    turnstile.value?.reset()
    await show(outcome)
  } finally {
    sending.value = false
  }
}

async function post(body: ReturnType<typeof toHelloRequest>): Promise<HelloOutcome> {
  try {
    const response = await fetch('/api/hello', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const reply: unknown = await response.json().catch(() => null)
    return readHelloResponse(response.status, reply, form)
  } catch {
    return { kind: 'failed' }
  }
}

async function show(outcome: HelloOutcome) {
  switch (outcome.kind) {
    case 'sent':
      sentName.value = draft.value!.callName.trim()
      // Stored, so nothing typed needs keeping; a new message gets a new id.
      draft.value = createHelloDraft()
      errors.value = []
      problem.value = undefined
      await nextTick()
      return sentHeading.value?.focus()
    case 'invalid':
      return showErrors(outcome.errors)
    case 'turnstile_failed':
      return showErrors([{ field: TURNSTILE_FIELD, code: 'turnstile_failed' }])
    case 'rate_limited':
      return showProblem('rate_limited')
    case 'failed':
      return showProblem('unavailable')
  }
}

async function writeAnother() {
  sentName.value = undefined
  await nextTick()
  formHeading.value?.focus()
}
</script>

<template>
  <div class="hello">
    <section class="hello__intro" aria-labelledby="hello-title">
      <h1 id="hello-title">{{ form.text.title }}</h1>
      <p v-if="form.text.intro" class="lede">{{ form.text.intro }}</p>
    </section>

    <div class="hello__layout">
      <div class="hello__main">
        <!-- With scripts on, the browser treats a noscript's contents as text, so
             Vue would report a mismatch; it is expected here. -->
        <noscript data-allow-mismatch="children">
          <p class="note hello__noscript">{{ t('hello.noscript') }}</p>
        </noscript>
        <ClientOnly>
          <div v-if="sentName !== undefined" class="patch hello__sent">
            <p class="sticker">{{ t('hello.sent.label') }}</p>
            <h2 ref="sentHeading" tabindex="-1">{{ t('hello.sent.title', { name: sentName }) }}</h2>
            <p>{{ t('hello.sent.body') }}</p>
            <button type="button" class="button button--secondary" @click="writeAnother">
              {{ t('hello.sent.again') }}
            </button>
          </div>
          <form
            v-else-if="draft"
            class="patch hello__form"
            aria-labelledby="hello-form-title"
            novalidate
            @submit.prevent="onSend"
          >
            <h2 id="hello-form-title" ref="formHeading" tabindex="-1">
              {{ t('hello.form_title') }}
            </h2>
            <ErrorSummary v-if="errors.length" ref="summary" :items="summaryItems" />
            <SendFailed
              v-else-if="problem"
              ref="failedView"
              form="hello"
              :reason="problem"
              :answers="copyText"
            />
            <template v-for="part in parts" :key="part">
              <template v-if="part === 'about_you'">
                <FormTextField
                  :id="fieldId('callName')"
                  v-model="draft.callName"
                  :label="t('hello.callName.label')"
                  :hint="t('hello.callName.hint')"
                  :error="messageFor('callName')"
                  autocomplete="nickname"
                />
                <FormTextField
                  :id="fieldId('email')"
                  v-model="draft.email"
                  type="email"
                  :label="t('hello.email.label')"
                  :hint="t('hello.email.hint')"
                  :error="messageFor('email')"
                  autocomplete="email"
                />
              </template>
              <template v-for="field in step.fields" v-else :key="field.id">
                <FormField
                  v-if="shown.has(field.id)"
                  v-model="draft.values[field.id]"
                  :field="field"
                  :text="form.text"
                  :path="fieldPath(step, field)"
                  :error="messageFor(fieldPath(step, field))"
                />
              </template>
            </template>
            <div class="hello__actions">
              <button :id="fieldId(TURNSTILE_FIELD)" type="submit" class="button button--primary">
                {{ t(problem ? 'hello.send_again' : 'hello.send') }}
              </button>
              <p class="hello__sending muted small" role="status">
                {{ sending ? t('hello.sending') : '' }}
              </p>
              <TurnstileCheck ref="turnstile" action="hello" />
            </div>
          </form>
        </ClientOnly>
      </div>

      <div class="hello__side">
        <div class="note">
          <h2 class="hello__note-title">{{ t('hello.kept.heading') }}</h2>
          <p>{{ t('hello.kept.body') }}</p>
          <!-- A form that takes free text says where a disclosure goes (SG6). -->
          <p v-if="form.safetyNote">{{ t('hello.kept.safety') }}</p>
          <i18n-t v-if="privacyLink" keypath="hello.kept.privacy" tag="p" scope="global">
            <template #link>
              <NuxtLink :to="PRIVACY_PATH">{{ t('hello.kept.privacy_link') }}</NuxtLink>
            </template>
          </i18n-t>
        </div>
        <div class="note">
          <h2 class="hello__note-title">{{ t('hello.danger.heading') }}</h2>
          <p>{{ t('hello.danger.body') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
