<script setup lang="ts">
import { roleKey } from '#shared/forms/roles'
import type { StopReason } from '#shared/forms/definition'
import { fieldPath as fieldPathOf, shownFieldIds } from '#shared/forms/view'

// The apply flow (W6b, #15), drawn from the role's stored form (ADR-0010,
// A2): its steps, "About you" where the version puts it, then Check and send.
// State and routing live in useApplication (#21); this page draws each step,
// checks it on Continue, and shows errors the same way on every step. An
// answer that stops the flow shows its stop page on Continue (#16). Send gets
// a spam check token, posts the answers and shows what came back: the sent
// page, errors on the step they belong to, a stop page, or "That didn't
// send" with Copy my answers (#17).
definePageMeta({ layout: 'focused' })

const { t } = useI18n()
const route = useRoute()
const role = requirePublishedRole(route.params.role)
const key = roleKey(role.slug)
const form = await useStoredForm(role.slug)
const steps = stepsOf(form)
const lastStep = steps.length
const titles = steps.map((flow) => stepTitle(form, flow, t))
const { draft, step, stopped, redirected, sent, goTo, clear, finish } = useApplication(form)

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
const copyText = computed(() => (draft.value ? answersText(draft.value, form, t) : ''))

const current = computed(() => flowStepAt(form, step.value))
const shown = computed(() =>
  draft.value ? shownFieldIds(form.definition, draft.value.values) : new Set(),
)
const stepTitleText = computed(() => titles[step.value - 1] ?? '')
useHead({
  title: () => {
    const action = t(`${key}.page.apply`)
    if (sent.value) return t('apply.sent.page_title', { action })
    if (stopShown.value) {
      return t('apply.stop.page_title', { title: t(`apply.stop.${stopShown.value}.title`), action })
    }
    return t(errors.value.length ? 'apply.page_title_error' : 'apply.page_title', {
      step: step.value,
      count: lastStep,
      title: stepTitleText.value,
      action,
    })
  },
})

function wordsFor(error: FieldError) {
  const message = errorMessage(error, form)
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

/** Whether a choice can reveal another question on its own step (Robin, #158). */
function revealsMore(id: string): boolean {
  return form.definition.steps.some((each) =>
    each.fields.some((other) => other.showIf?.field === id && each.fields.some((f) => f.id === id)),
  )
}

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
  if (!draft.value || step.value === lastStep) return
  const found = stepErrors(draft.value, form, step.value)
  if (found.length) return showErrors(found)
  if (stopped.value && furthestStep(draft.value, form) === step.value) return openStop()
  goTo(step.value + 1)
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
  // The guard keeps the last step closed until the others are done, so this
  // only matters if an answer changed some other way: go back to that step.
  const furthest = furthestStep(draft.value, form)
  if (furthest < lastStep) return goTo(furthest)

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
    const outcome = await post(toRequest(draft.value, form, token))
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
    return readSendResponse(response.status, reply, form)
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
  return answerText(form, id, draft.value?.values[id]) ?? t('apply.no_answer')
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
          <p class="eyebrow">{{ t('apply.applying_for', { role: form.text.title }) }}</p>
          <!-- The application has ended on a stop page, so no progress (Robin, #82). -->
          <template v-if="!stopShown">
            <ApplyProgress class="apply__progress" :step="step" :titles="titles" />
            <ApplySteps class="apply__steps" :step="step" :titles="titles" />
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
            @submit.prevent="step === lastStep ? onSend() : onContinue()"
          >
            <div class="apply__heading">
              <h1 ref="heading" tabindex="-1">{{ stepTitleText }}</h1>
              <p v-if="step === 1">{{ t('apply.intro') }}</p>
            </div>

            <template v-if="current.kind === 'fields'">
              <template v-for="field in current.step.fields" :key="field.id">
                <FormField
                  v-if="shown.has(field.id)"
                  v-model="draft.values[field.id]"
                  :field="field"
                  :text="form.text"
                  :path="fieldPathOf(current.step, field)"
                  :error="messageFor(fieldPathOf(current.step, field))"
                  :reveals-more="revealsMore(field.id)"
                />
              </template>
              <div v-if="form.definition.note && step === 1" class="note">
                <p class="apply__note-title">{{ form.text['note.heading'] }}</p>
                <p>{{ form.text['note.body'] }}</p>
              </div>
            </template>

            <template v-else-if="current.kind === 'about_you'">
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

            <template v-else>
              <template v-for="(flow, index) in steps" :key="index">
                <section
                  v-if="flow.kind !== 'check'"
                  class="patch patch--flat apply-check"
                  :aria-labelledby="`check-${index + 1}`"
                >
                  <div class="apply-check__head">
                    <h2 :id="`check-${index + 1}`">{{ titles[index] }}</h2>
                    <NuxtLink
                      :to="stepLink(index + 1)"
                      :aria-label="t('apply.change_label', { section: titles[index] })"
                    >
                      {{ t('apply.change') }}
                    </NuxtLink>
                  </div>
                  <dl v-if="flow.kind === 'about_you'" class="answers">
                    <dt>{{ t('apply.fields.callName') }}</dt>
                    <dd>{{ textAnswer(draft.callName) }}</dd>
                    <dt>{{ t('apply.fields.email') }}</dt>
                    <dd>{{ textAnswer(draft.email) }}</dd>
                  </dl>
                  <dl v-else class="answers">
                    <template v-for="field in flow.step.fields" :key="field.id">
                      <template v-if="shown.has(field.id)">
                        <dt>{{ form.text[`fields.${field.id}.summary`] }}</dt>
                        <dd
                          :class="{
                            'apply-check__text':
                              field.type === 'long_text' || field.type === 'short_text',
                          }"
                        >
                          {{ checkAnswer(field.id) }}
                        </dd>
                      </template>
                    </template>
                  </dl>
                </section>
              </template>

              <div class="note">
                <p class="apply__note-title">{{ t('apply.where_it_goes.heading') }}</p>
                <p>{{ t('apply.where_it_goes.body') }}</p>
                <FormSafetyNote :form="form" />
              </div>
            </template>

            <div class="apply__actions">
              <button
                :id="step === lastStep ? fieldId(TURNSTILE_FIELD) : undefined"
                type="submit"
                class="button button--primary"
              >
                {{
                  t(
                    step === lastStep
                      ? problem
                        ? 'apply.send_again'
                        : 'apply.send'
                      : 'apply.continue',
                  )
                }}
              </button>
              <p v-if="step === lastStep" class="apply__sending muted small" role="status">
                {{ sending ? t('apply.sending') : '' }}
              </p>
              <TurnstileCheck v-if="step === lastStep" ref="turnstile" action="apply" />
              <NuxtLink
                v-if="step === 1"
                :to="`/roles/${role.slug}`"
                class="button button--ghost"
                @click="clear"
              >
                {{ t('apply.back') }}
              </NuxtLink>
              <button v-else type="button" class="button button--ghost" @click="goTo(step - 1)">
                {{ t('apply.back') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ClientOnly>
  </div>
</template>
