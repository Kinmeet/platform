<script setup lang="ts">
import { roleKey, type StopReason } from '#shared/forms/roles'

// The apply flow's four steps (W6b, #15). State and routing live in
// useApplication (#21); this page draws each step, checks it on Continue,
// and shows errors the same way on every step. Steps 1 and 3 are drawn
// from the role config. A step 1 answer that stops the flow shows its stop
// page on Continue (#16). Send gets a spam check token, posts the answers
// and shows what came back: the sent page, errors on the step they belong
// to, a stop page, or "That didn't send" with Copy my answers (#17).
definePageMeta({ layout: 'focused' })

const { t } = useI18n()
const route = useRoute()
const role = requirePublishedRole(route.params.role)
const key = roleKey(role.slug)
const { draft, step, stopped, redirected, sent, goTo, clear, finish } = useApplication(role)

const errors = ref<FieldError[]>([])
const summary = ref<{ focus: () => void } | null>(null)
const heading = ref<HTMLElement | null>(null)

// The stop page, once Continue is pressed with an answer that stops the flow.
const showStop = ref(false)
// A stop the server found that the page didn't: its backstop (docs/api/forms.md).
const serverStop = ref<StopReason>()
const stopShown = computed(() => (showStop.value ? (stopped.value ?? serverStop.value) : undefined))
const stopView = ref<{ focus: () => void } | null>(null)

const turnstile = ref<{ getToken: () => Promise<string>; reset: () => void } | null>(null)
const sending = ref(false)
const problem = ref<SendProblem>()
const failedView = ref<{ focus: () => void } | null>(null)
const sentView = ref<{ focus: () => void } | null>(null)
const copyText = computed(() => (draft.value ? answersText(draft.value, role, t) : ''))

const stepTitle = computed(() => t(`apply.steps.${step.value}`))
useHead({
  title: () => {
    const action = t(`${key}.page.apply`)
    if (sent.value) return t('apply.sent.page_title', { action })
    if (stopShown.value) {
      return t('apply.stop.page_title', { title: t(`apply.stop.${stopShown.value}.title`), action })
    }
    return t(errors.value.length ? 'apply.page_title_error' : 'apply.page_title', {
      step: step.value,
      title: stepTitle.value,
      action,
    })
  },
})

function messageFor(field: string): string | undefined {
  const error = errors.value.find((item) => item.field === field)
  if (!error) return undefined
  const message = errorMessage(error, role)
  return t(message.key, message.params)
}

const summaryItems = computed<ErrorSummaryItem[]>(() =>
  errors.value.map((error) => {
    const message = errorMessage(error, role)
    return {
      target: fieldId(error.field),
      text: t('apply.errors.summary_item', {
        question: t(message.questionKey),
        message: t(message.key, message.params),
      }),
    }
  }),
)

async function showErrors(found: FieldError[]) {
  errors.value = found
  await nextTick()
  summary.value?.focus()
}

// A new step starts with no errors, and focus goes to its heading so screen
// readers hear where they are (Robin, #78). Not on first load: the page
// starts at the top as usual.
watch(step, async () => {
  errors.value = []
  showStop.value = false
  serverStop.value = undefined
  problem.value = undefined
  // Sending moves the URL back to step 1; the sent page takes focus instead.
  if (sent.value) return
  await nextTick()
  heading.value?.focus()
})

function onContinue() {
  if (!draft.value || step.value === 4) return
  const found = stepErrors(draft.value, role, step.value)
  if (found.length) return showErrors(found)
  if (step.value === 1 && stopped.value) return openStop()
  goTo((step.value + 1) as Step)
}

async function openStop() {
  errors.value = []
  showStop.value = true
  await nextTick()
  stopView.value?.focus()
}

async function closeStop() {
  showStop.value = false
  serverStop.value = undefined
  await nextTick()
  heading.value?.focus()
}

async function onSend() {
  if (!draft.value || sending.value) return
  // The guard keeps step 4 closed until steps 1 to 3 are done, so this only
  // matters if an answer changed some other way: go back to that step.
  const furthest = furthestStep(draft.value, role)
  if (furthest < 4) return goTo(furthest)

  sending.value = true
  try {
    let token: string
    try {
      token = await turnstile.value!.getToken()
    } catch (error) {
      // A failed challenge can be tried again; a script that never loaded can't.
      if (error instanceof TurnstileError && error.reason === 'failed') {
        return show({ kind: 'turnstile_failed' })
      }
      return showProblem('spam_check')
    }
    const outcome = await post(toRequest(draft.value, role, token))
    // Every token is single use, whatever came back (#20).
    turnstile.value?.reset()
    await show(outcome)
  } finally {
    sending.value = false
  }
}

async function post(body: ReturnType<typeof toRequest>): Promise<SendOutcome> {
  try {
    const response = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const reply: unknown = await response.json().catch(() => null)
    return readSendResponse(response.status, reply)
  } catch {
    return { kind: 'failed' }
  }
}

async function show(outcome: SendOutcome) {
  switch (outcome.kind) {
    case 'sent':
      finish(outcome.receipt)
      await nextTick()
      return sentView.value?.focus()
    case 'invalid':
      // Every answer is kept; the errors are shown on the step they belong to.
      await goTo(outcome.step)
      await nextTick()
      return showErrors(outcome.errors)
    case 'stopped':
      await goTo(1)
      await nextTick()
      serverStop.value = outcome.reason
      return openStop()
    case 'turnstile_failed':
      problem.value = undefined
      return showErrors([{ field: TURNSTILE_FIELD, code: 'turnstile_failed' }])
    case 'rate_limited':
      return showProblem('rate_limited')
    case 'failed':
      return showProblem('unavailable')
  }
}

async function showProblem(reason: SendProblem) {
  errors.value = []
  problem.value = reason
  await nextTick()
  failedView.value?.focus()
}

/** The words for one answer on "Check and send". */
function checkAnswer(id: string): string {
  const answer = draft.value?.checks[id]
  return answer ? t(`${key}.questions.${id}.choices.${answer}`) : t('apply.no_answer')
}
function textAnswer(value: string | undefined): string {
  return value?.trim() || t('apply.no_answer')
}
function stepLink(target: Step) {
  return { query: { ...route.query, step: target === 1 ? undefined : target } }
}
</script>

<template>
  <div class="apply">
    <!-- With scripts on, the browser treats a noscript's contents as text, so
         Vue would report a mismatch; it is expected here. -->
    <noscript data-allow-mismatch="children">
      <p class="note apply__noscript">{{ t('apply.noscript') }}</p>
    </noscript>
    <ClientOnly>
      <ApplySent v-if="sent" ref="sentView" class="apply__sent" :role="role" :sent="sent" />
      <div v-else-if="draft" class="apply__layout">
        <div class="apply__side">
          <p class="eyebrow">{{ t('apply.applying_for', { role: t(`${key}.title`) }) }}</p>
          <!-- The application has ended on a stop page, so no progress (Robin, #82). -->
          <template v-if="!stopShown">
            <ApplyProgress class="apply__progress" :step="step" />
            <ApplySteps class="apply__steps" :step="step" />
            <p class="apply__time muted small">{{ t('apply.time_note') }}</p>
          </template>
        </div>

        <ApplyStop
          v-if="stopShown"
          ref="stopView"
          class="apply__main"
          :reason="stopShown"
          @back="closeStop"
        />
        <div v-else class="apply__main">
          <p class="apply__notice note" role="status">
            {{ redirected ? t(`apply.redirect.${redirected}`) : '' }}
          </p>
          <ErrorSummary v-if="errors.length" ref="summary" :items="summaryItems" />
          <SendFailed
            v-else-if="problem"
            ref="failedView"
            form="apply"
            :reason="problem"
            :answers="copyText"
          />

          <form
            class="apply__form"
            novalidate
            @submit.prevent="step === 4 ? onSend() : onContinue()"
          >
            <div class="apply__heading">
              <h1 ref="heading" tabindex="-1">{{ stepTitle }}</h1>
              <p v-if="step === 1">{{ t('apply.intro') }}</p>
            </div>

            <template v-if="step === 1">
              <ApplyQuestion
                v-for="check in role.apply.checks"
                :key="check.id"
                v-model="draft.checks[check.id]"
                :role-key="key"
                :question="check"
                :field="`checks.${check.id}`"
                :error="messageFor(`checks.${check.id}`)"
              />
              <div v-if="role.apply.note" class="note">
                <p class="apply__note-title">{{ t(`${key}.apply.note.heading`) }}</p>
                <p>{{ t(`${key}.apply.note.body`) }}</p>
              </div>
            </template>

            <template v-else-if="step === 2">
              <FormTextField
                :id="fieldId('callName')"
                v-model="draft.callName"
                :label="t('apply.about_you.callName.label')"
                :hint="t('apply.about_you.callName.hint')"
                :error="messageFor('callName')"
                autocomplete="nickname"
              />
              <FormTextField
                :id="fieldId('email')"
                v-model="draft.email"
                type="email"
                :label="t('apply.about_you.email.label')"
                :hint="t('apply.about_you.email.hint')"
                :error="messageFor('email')"
                autocomplete="email"
              />
            </template>

            <template v-else-if="step === 3">
              <ApplyQuestion
                v-for="question in role.apply.questions"
                :key="question.id"
                v-model="draft.answers[question.id]"
                :role-key="key"
                :question="question"
                :field="`answers.${question.id}`"
                :error="messageFor(`answers.${question.id}`)"
              />
            </template>

            <template v-else>
              <section class="patch patch--flat apply-check" aria-labelledby="check-1">
                <div class="apply-check__head">
                  <h2 id="check-1">{{ t('apply.steps.1') }}</h2>
                  <NuxtLink
                    :to="stepLink(1)"
                    :aria-label="t('apply.change_label', { section: t('apply.steps.1') })"
                  >
                    {{ t('apply.change') }}
                  </NuxtLink>
                </div>
                <dl class="answers">
                  <template v-for="check in role.apply.checks" :key="check.id">
                    <dt>{{ t(`${key}.questions.${check.id}.summary`) }}</dt>
                    <dd>{{ checkAnswer(check.id) }}</dd>
                  </template>
                </dl>
              </section>

              <section class="patch patch--flat apply-check" aria-labelledby="check-2">
                <div class="apply-check__head">
                  <h2 id="check-2">{{ t('apply.steps.2') }}</h2>
                  <NuxtLink
                    :to="stepLink(2)"
                    :aria-label="t('apply.change_label', { section: t('apply.steps.2') })"
                  >
                    {{ t('apply.change') }}
                  </NuxtLink>
                </div>
                <dl class="answers">
                  <dt>{{ t('apply.fields.callName') }}</dt>
                  <dd>{{ textAnswer(draft.callName) }}</dd>
                  <dt>{{ t('apply.fields.email') }}</dt>
                  <dd>{{ textAnswer(draft.email) }}</dd>
                </dl>
              </section>

              <section class="patch patch--flat apply-check" aria-labelledby="check-3">
                <div class="apply-check__head">
                  <h2 id="check-3">{{ t('apply.steps.3') }}</h2>
                  <NuxtLink
                    :to="stepLink(3)"
                    :aria-label="t('apply.change_label', { section: t('apply.steps.3') })"
                  >
                    {{ t('apply.change') }}
                  </NuxtLink>
                </div>
                <dl class="answers">
                  <template v-for="question in role.apply.questions" :key="question.id">
                    <dt>{{ t(`${key}.questions.${question.id}.summary`) }}</dt>
                    <dd class="apply-check__text">{{ textAnswer(draft.answers[question.id]) }}</dd>
                  </template>
                </dl>
              </section>

              <div class="note">
                <p class="apply__note-title">{{ t('apply.where_it_goes.heading') }}</p>
                <p>{{ t('apply.where_it_goes.body') }}</p>
              </div>
            </template>

            <div class="apply__actions">
              <button
                :id="step === 4 ? fieldId(TURNSTILE_FIELD) : undefined"
                type="submit"
                class="button button--primary"
              >
                {{
                  t(step === 4 ? (problem ? 'apply.send_again' : 'apply.send') : 'apply.continue')
                }}
              </button>
              <p v-if="step === 4" class="apply__sending muted small" role="status">
                {{ sending ? t('apply.sending') : '' }}
              </p>
              <TurnstileCheck v-if="step === 4" ref="turnstile" action="apply" />
              <NuxtLink
                v-if="step === 1"
                :to="`/roles/${role.slug}`"
                class="button button--ghost"
                @click="clear"
              >
                {{ t('apply.back') }}
              </NuxtLink>
              <button
                v-else
                type="button"
                class="button button--ghost"
                @click="goTo((step - 1) as Step)"
              >
                {{ t('apply.back') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ClientOnly>
  </div>
</template>
