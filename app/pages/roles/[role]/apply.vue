<script setup lang="ts">
import { roleKey } from '#shared/forms/roles'

// The apply flow's four steps (W6b, #15). State and routing live in
// useApplication (#21); this page draws each step, checks it on Continue,
// and shows errors the same way on every step. Steps 1 and 3 are drawn
// from the role config; their role-specific extras are #16, and sending
// and the end pages are #17.
definePageMeta({ layout: 'focused' })

const { t } = useI18n()
const route = useRoute()
const role = requirePublishedRole(route.params.role)
const key = roleKey(role.slug)
const { draft, step, redirected, goTo, clear } = useApplication(role)

const errors = ref<FieldError[]>([])
const summary = ref<{ focus: () => void } | null>(null)
const heading = ref<HTMLElement | null>(null)

const stepTitle = computed(() => t(`apply.steps.${step.value}`))
useHead({
  title: () =>
    t(errors.value.length ? 'apply.page_title_error' : 'apply.page_title', {
      step: step.value,
      title: stepTitle.value,
      action: t(`${key}.page.apply`),
    }),
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
  await nextTick()
  heading.value?.focus()
})

function onContinue() {
  if (!draft.value || step.value === 4) return
  const found = stepErrors(draft.value, role, step.value)
  if (found.length) return showErrors(found)
  goTo((step.value + 1) as Step)
}

function onSend() {
  if (!draft.value) return
  // The guard keeps step 4 closed until steps 1 to 3 are done, so this only
  // matters if an answer changed some other way: go back to that step.
  const furthest = furthestStep(draft.value, role)
  if (furthest < 4) return goTo(furthest)
  // Sending is #17. Until then Send stops here, after the checks, and makes
  // no request (Callum, #15).
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
      <div v-if="draft" class="apply__layout">
        <div class="apply__side">
          <p class="eyebrow">{{ t('apply.applying_for', { role: t(`${key}.title`) }) }}</p>
          <ApplyProgress class="apply__progress" :step="step" />
          <ApplySteps class="apply__steps" :step="step" />
          <p class="apply__time muted small">{{ t('apply.time_note') }}</p>
        </div>

        <div class="apply__main">
          <p class="apply__notice note" role="status">
            {{ redirected ? t(`apply.redirect.${redirected}`) : '' }}
          </p>
          <ErrorSummary v-if="errors.length" ref="summary" :items="summaryItems" />

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
              <button type="submit" class="button button--primary">
                {{ t(step === 4 ? 'apply.send' : 'apply.continue') }}
              </button>
              <TurnstileCheck v-if="step === 4" action="apply" />
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
