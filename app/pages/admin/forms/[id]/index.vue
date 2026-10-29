<script setup lang="ts">
// The form builder (ADR-0010, B3, #160): one form's steps and questions, an
// editing panel, form settings, the checks publishing would run, and a
// preview drawn with the public field renderer. Behind Cloudflare Access.
// Edits stay on this page until Save draft, which replaces the stored draft;
// nothing reaches the public until the draft is published from its own page.
// Reordering is by Move buttons: focus stays on the button pressed and the
// new position is announced (canvas, form builder).
import type { AdminFormCheck, AdminFormDetail } from '#shared/admin'
import { LIMITS, receipts, type AdminAction } from '#shared/forms/definition'
import { TEXT_LIMITS } from '#shared/forms/publish'
import type { PublicForm } from '#shared/forms/view'
import { findPurpose } from '#shared/privacy/purposes'

const { t } = useI18n()
const route = useRoute()
const id = String(route.params.id)

const { data, status, refresh } = useFetch<{ ok: true } & AdminFormDetail>(
  `/api/admin/forms/${encodeURIComponent(id)}`,
  { server: false },
)
const detail = computed(() => data.value ?? null)

const draft = ref<BuilderDraft | null>(null)
/** The save body last stored, to tell whether there are changes to save. */
const saved = ref('')
const check = ref<AdminFormCheck | null>(null)
const preview = ref<PublicForm | null>(null)
const editing = ref<string | null>(null)
const announcement = ref('')
/**
 * Says something through the status region. It is emptied first, so the
 * same message pressed twice is read out again (Robin, #166).
 */
async function announce(message: string) {
  announcement.value = ''
  await nextTick()
  announcement.value = message
}
const busy = ref(false)

watch(
  detail,
  async (value) => {
    if (!value || draft.value) return
    draft.value = startingDraft(value)
    saved.value = value.draft ? JSON.stringify(toSaveBody(draft.value)) : ''
    if (value.draft) await loadCheck()
  },
  { immediate: true },
)

const kind = computed(() => detail.value?.form.kind ?? 'form')
const slug = computed(() => detail.value?.form.slug ?? '')
const title = computed(() => draft.value?.text.title?.trim() || slug.value)
const changed = computed(
  () => draft.value !== null && JSON.stringify(toSaveBody(draft.value)) !== saved.value,
)

useHead({
  title: () =>
    detail.value
      ? t('admin.forms.builder.pageTitle', { title: title.value })
      : t('admin.forms.title'),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const purpose = computed(() => (draft.value ? findPurpose(draft.value.purpose) : undefined))
const purposeChoices = computed(() => purposesFor(kind.value))

/** Binds an admin text input to one key of the draft's en-GB text. */
function words(key: string) {
  return {
    modelValue: draft.value?.text[key] ?? '',
    'onUpdate:modelValue': (value: string) => {
      if (draft.value) draft.value.text[key] = value
    },
  }
}

const questionName = (fieldId: string) =>
  draft.value?.text[`fields.${fieldId}.label`]?.trim() ||
  t('admin.forms.checks.where.untitled', { id: fieldId })

/** A step's heading as the public page will show it, for the builder's own headings. */
function stepName(index: number): string {
  const step = draft.value?.definition.steps[index]
  if (!step) return ''
  if (step.body === 'checks') return t('apply.steps.1')
  if (step.body === 'answers') return t('apply.steps.3')
  return draft.value?.text[`steps.${step.id}.heading`]?.trim() || title.value
}

const editor = ref<{ focus: () => void } | null>(null)
async function edit(fieldId: string) {
  editing.value = fieldId
  await nextTick()
  editor.value?.focus()
}
async function doneEditing() {
  const fieldId = editing.value
  editing.value = null
  await nextTick()
  if (fieldId) document.getElementById(`edit-${fieldId}`)?.focus()
}

function move(fieldId: string, by: -1 | 1) {
  if (!draft.value) return
  const moved = moveField(draft.value.definition, fieldId, by)
  const located = findBuilderField(draft.value.definition, fieldId)
  const name = questionName(fieldId)
  // A Move button at the end says why nothing happened, rather than staying silent.
  if (!moved) {
    return announce(
      t(by === -1 ? 'admin.forms.builder.alreadyFirst' : 'admin.forms.builder.alreadyLast', {
        name,
        step: (located?.stepIndex ?? 0) + 1,
      }),
    )
  }
  // Focus stays on the button pressed; the new position is announced.
  return announce(
    t('admin.forms.builder.moved', {
      name,
      position: moved.position,
      count: moved.count,
      step: moved.step,
    }),
  )
}

async function addQuestion(stepIndex: number) {
  if (!draft.value) return
  const fieldId = addField(draft.value.definition, stepIndex)
  if (fieldId) await edit(fieldId)
  else
    await announce(
      t('admin.forms.builder.stepFull', { step: stepIndex + 1, max: LIMITS.fieldsPerStep }),
    )
}

async function removeQuestion() {
  if (!draft.value || !editing.value) return
  const located = findBuilderField(draft.value.definition, editing.value)
  const name = questionName(editing.value)
  removeField(draft.value.definition, editing.value)
  editing.value = null
  await announce(t('admin.forms.builder.removed', { name }))
  await nextTick()
  document.getElementById(`step-${(located?.stepIndex ?? 0) + 1}`)?.focus()
}

async function onAddStep() {
  if (!draft.value) return
  const number = addStep(draft.value.definition)
  if (number === undefined) return announce(t('admin.forms.builder.noMoreSteps'))
  await announce(t('admin.forms.builder.stepAdded', { step: number }))
  await nextTick()
  document.getElementById(`step-${number}`)?.focus()
}

async function onRemoveStep(index: number) {
  if (!draft.value || draft.value.definition.steps.length === 1) return
  removeStep(draft.value.definition, index)
  editing.value = null
  await announce(t('admin.forms.builder.stepRemoved', { step: index + 1 }))
  await nextTick()
  document.getElementById('questions-heading')?.focus()
}

const canAddStep = computed(
  () =>
    draft.value !== null &&
    draft.value.definition.steps.length < LIMITS.steps &&
    freeBodies(draft.value.definition).length > 0,
)

function setAboutYou(event: Event) {
  if (draft.value)
    draft.value.definition.aboutYou = Number((event.target as HTMLSelectElement).value)
}

function setPurpose(event: Event) {
  if (!draft.value) return
  draft.value.purpose = (event.target as HTMLSelectElement).value
  // Readers can only narrow the purpose's, so a new purpose starts with all of them.
  const chosen = findPurpose(draft.value.purpose)
  if (chosen) draft.value.definition.readers = [...chosen.readers]
}

function toggleReader(role: string, event: Event) {
  const definition = draft.value?.definition
  if (!definition) return
  const on = (event.target as HTMLInputElement).checked
  const order = purpose.value?.readers ?? []
  const next = on
    ? [...definition.readers, role]
    : definition.readers.filter((each) => each !== role)
  definition.readers = order.filter((each) => next.includes(each)) as typeof definition.readers
}

function toggleAction(action: AdminAction, event: Event) {
  const definition = draft.value?.definition
  if (!definition) return
  const on = (event.target as HTMLInputElement).checked
  definition.actions = on
    ? [...definition.actions, action]
    : definition.actions.filter((each) => each !== action)
}

/** The actions this purpose allows: reply or outcome told from its retention, and always SG6. */
const allowedActions = computed<AdminAction[]>(() => {
  const base = purpose.value?.retention.base
  return [base === 'outcome_told' ? 'outcome_told' : 'reply', 'pass_to_safeguarding']
})

function setRetention(value: string) {
  const definition = draft.value?.definition
  if (!definition) return
  const months = Number.parseInt(value, 10)
  if (value.trim() === '' || !Number.isFinite(months)) delete definition.retentionMonths
  else definition.retentionMonths = months
}

function setReceipt(event: Event) {
  if (draft.value)
    draft.value.definition.receipt = (event.target as HTMLSelectElement)
      .value as (typeof receipts)[number]
}

function setNote(event: Event) {
  if (draft.value) draft.value.definition.note = (event.target as HTMLInputElement).checked
}

const checksView = ref<{ focus: () => void } | null>(null)
const saveError = ref('')

async function loadCheck() {
  try {
    const reply = await $fetch<{ ok: true; check: AdminFormCheck; preview: PublicForm | null }>(
      `/api/admin/forms/${encodeURIComponent(id)}/check`,
    )
    check.value = reply.check
    preview.value = reply.preview
  } catch {
    check.value = null
    preview.value = null
  }
}

async function save() {
  if (!draft.value || busy.value) return
  busy.value = true
  saveError.value = ''
  announcement.value = ''
  const body = toSaveBody(draft.value)
  try {
    const reply = await $fetch<{ ok: true; check: AdminFormCheck }>(
      `/api/admin/forms/${encodeURIComponent(id)}/draft`,
      { method: 'PUT', body },
    )
    saved.value = JSON.stringify(body)
    check.value = reply.check
    await loadCheck()
    await refresh()
    announcement.value = t(
      reply.check.ok ? 'admin.forms.builder.savedReady' : 'admin.forms.builder.saved',
      reply.check.problems.length,
    )
  } catch (error) {
    const code = (error as { data?: { error?: string } }).data?.error
    saveError.value = t(
      code === 'draft_invalid' ? 'admin.forms.builder.draftInvalid' : 'admin.actionFailed',
    )
  } finally {
    busy.value = false
  }
}

async function setStatus(next: 'open' | 'closed') {
  if (busy.value) return
  busy.value = true
  announcement.value = ''
  try {
    await $fetch(`/api/admin/forms/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: { status: next },
    })
    await refresh()
    announcement.value = t(`admin.forms.builder.status.${next}Done`)
  } catch {
    announcement.value = t('admin.actionFailed')
  } finally {
    busy.value = false
  }
}

async function showChecks() {
  await nextTick()
  checksView.value?.focus()
}
</script>

<template>
  <main class="admin admin--wide">
    <AdminNav />
    <p v-if="status === 'pending' && !detail">{{ t('admin.loading') }}</p>
    <template v-else-if="!detail || !draft">
      <h1>{{ t('admin.forms.builder.heading') }}</h1>
      <p>{{ t('admin.forms.builder.notFound') }}</p>
      <NuxtLink to="/admin/forms">{{ t('admin.forms.backToList') }}</NuxtLink>
    </template>
    <template v-else>
      <p class="eyebrow">
        {{ t(`admin.forms.kind.${kind}`) }} · {{ t(`admin.forms.status.${detail.form.status}`) }}
        <template v-if="detail.form.version !== null">
          · {{ t('admin.forms.list.version', { version: detail.form.version }) }}
        </template>
      </p>
      <h1>{{ t('admin.forms.builder.pageTitle', { title }) }}</h1>
      <p>{{ t('admin.forms.builder.lead') }}</p>
      <p class="admin__status" role="status">{{ announcement }}</p>

      <ul class="admin-links">
        <li>
          <NuxtLink :to="`/admin/forms/${id}/submissions`">
            {{ t('admin.forms.builder.submissionsLink') }}
          </NuxtLink>
        </li>
        <li>
          <NuxtLink :to="`/admin/forms/${id}/publish`">
            {{ t('admin.forms.builder.publishLink') }}
          </NuxtLink>
        </li>
      </ul>

      <section v-if="detail.form.version !== null" aria-labelledby="status-heading">
        <h2 id="status-heading">{{ t('admin.forms.builder.status.heading') }}</h2>
        <p>{{ t(`admin.forms.builder.status.${detail.form.status}`) }}</p>
        <button
          v-if="detail.form.status !== 'open'"
          type="button"
          class="button button--secondary"
          :aria-disabled="busy ? 'true' : undefined"
          @click="setStatus('open')"
        >
          {{ t('admin.forms.builder.status.open_button') }}
        </button>
        <button
          v-else
          type="button"
          class="button button--secondary"
          :aria-disabled="busy ? 'true' : undefined"
          @click="setStatus('closed')"
        >
          {{ t('admin.forms.builder.status.close_button') }}
        </button>
      </section>

      <div class="admin-builder">
        <div class="admin-builder__main">
          <section aria-labelledby="questions-heading">
            <h2 id="questions-heading" tabindex="-1">
              {{ t('admin.forms.builder.questionsHeading') }}
            </h2>
            <p>{{ t(`admin.forms.builder.questionsLead.${kind}`) }}</p>

            <AdminTextInput
              :id="textInputId('title')"
              v-bind="words('title')"
              :label="t('admin.forms.builder.formTitle')"
              :hint="t('admin.forms.builder.formTitleHint')"
              :limit="TEXT_LIMITS.title"
            />
            <AdminTextInput
              :id="textInputId('intro')"
              v-bind="words('intro')"
              :label="t('admin.forms.builder.intro')"
              :hint="t('admin.forms.builder.introHint')"
              :limit="TEXT_LIMITS.intro"
              multiline
            />

            <section
              v-for="(step, s) in draft.definition.steps"
              :id="`step-${s + 1}`"
              :key="step.id"
              class="admin-step"
              tabindex="-1"
            >
              <h3 :id="`step-${s + 1}-heading`">
                {{
                  t('admin.forms.builder.stepHeading', {
                    step: s + 1,
                    count: draft.definition.steps.length,
                    name: stepName(s),
                  })
                }}
              </h3>
              <p v-if="step.body !== null" class="hint">
                {{ t(`admin.forms.builder.fixedHeading.${step.body}`) }}
              </p>
              <AdminTextInput
                v-else-if="draft.definition.steps.length > 1"
                :id="textInputId(`steps.${step.id}.heading`)"
                v-bind="words(`steps.${step.id}.heading`)"
                :label="t('admin.forms.builder.stepTitle', { step: s + 1 })"
                :hint="t('admin.forms.builder.stepTitleHint')"
                :limit="TEXT_LIMITS.heading"
              />

              <p v-if="!step.fields.length">{{ t('admin.forms.builder.noQuestions') }}</p>
              <ol v-else class="admin-questions">
                <li v-for="(field, f) in step.fields" :key="field.id" class="admin-question">
                  <p class="admin-question__name">
                    {{ questionName(field.id) }}
                    <span v-if="editing === field.id" class="admin-question__editing">
                      {{ t('admin.forms.builder.editingNow') }}
                    </span>
                  </p>
                  <p class="hint">
                    {{
                      t(
                        field.required
                          ? 'admin.forms.builder.questionAboutRequired'
                          : 'admin.forms.builder.questionAboutOptional',
                        { type: t(`admin.forms.types.${field.type}.name`) },
                      )
                    }}
                    <template v-if="field.showIf">
                      {{
                        t('admin.forms.builder.shownWhen', {
                          label: questionName(field.showIf.field),
                        })
                      }}
                    </template>
                  </p>
                  <div class="admin-actions">
                    <button
                      :id="`edit-${field.id}`"
                      type="button"
                      class="button button--small button--secondary"
                      @click="edit(field.id)"
                    >
                      {{ t('admin.forms.edit') }}
                      <span class="visually-hidden">{{ questionName(field.id) }}</span>
                    </button>
                    <button
                      type="button"
                      class="button button--small button--ghost"
                      :aria-disabled="f === 0 ? 'true' : undefined"
                      @click="move(field.id, -1)"
                    >
                      {{ t('admin.forms.moveUp') }}
                      <span class="visually-hidden">{{ questionName(field.id) }}</span>
                    </button>
                    <button
                      type="button"
                      class="button button--small button--ghost"
                      :aria-disabled="f === step.fields.length - 1 ? 'true' : undefined"
                      @click="move(field.id, 1)"
                    >
                      {{ t('admin.forms.moveDown') }}
                      <span class="visually-hidden">{{ questionName(field.id) }}</span>
                    </button>
                  </div>
                </li>
              </ol>
              <div class="admin-actions">
                <button
                  type="button"
                  class="button button--secondary"
                  :aria-disabled="step.fields.length >= LIMITS.fieldsPerStep ? 'true' : undefined"
                  @click="addQuestion(s)"
                >
                  {{ t('admin.forms.builder.addQuestion', { step: s + 1 }) }}
                </button>
                <button
                  v-if="draft.definition.steps.length > 1"
                  type="button"
                  class="button button--ghost"
                  @click="onRemoveStep(s)"
                >
                  {{ t('admin.forms.builder.removeStep', { step: s + 1 }) }}
                </button>
              </div>
            </section>

            <div class="field">
              <label for="about-you">{{ t('admin.forms.builder.aboutYou') }}</label>
              <p id="about-you-hint" class="hint">{{ t('admin.forms.builder.aboutYouHint') }}</p>
              <select
                id="about-you"
                class="input"
                :value="draft.definition.aboutYou"
                aria-describedby="about-you-hint"
                @change="setAboutYou"
              >
                <option v-for="(step, s) in draft.definition.steps" :key="step.id" :value="s">
                  {{ t('admin.forms.builder.aboutYouBefore', { step: s + 1 }) }}
                </option>
                <option :value="draft.definition.steps.length">
                  {{ t('admin.forms.builder.aboutYouLast') }}
                </option>
              </select>
            </div>

            <button
              v-if="kind === 'application'"
              type="button"
              class="button button--secondary"
              :aria-disabled="canAddStep ? undefined : 'true'"
              @click="onAddStep"
            >
              {{ t('admin.forms.builder.addStep') }}
            </button>
          </section>

          <AdminQuestionEditor
            v-if="editing"
            ref="editor"
            v-model="draft"
            :field-id="editing"
            :kind="kind"
            :slug="slug"
            @done="doneEditing"
            @remove="removeQuestion"
            @announce="announce"
          />

          <section aria-labelledby="settings-heading">
            <h2 id="settings-heading" tabindex="-1">{{ t('admin.forms.settings.heading') }}</h2>
            <div class="field">
              <label for="settings-purpose">{{ t('admin.forms.settings.purpose') }}</label>
              <p id="settings-purpose-hint" class="hint">
                {{ t('admin.forms.settings.purposeHint') }}
              </p>
              <select
                id="settings-purpose"
                class="input"
                :value="draft.purpose"
                aria-describedby="settings-purpose-hint"
                @change="setPurpose"
              >
                <option v-for="choice in purposeChoices" :key="choice.id" :value="choice.id">
                  {{ choice.purpose.p3Row }}
                </option>
              </select>
            </div>

            <dl v-if="purpose" class="admin-facts">
              <dt>{{ t('admin.forms.list.kept') }}</dt>
              <dd>
                {{
                  keptFor(
                    purpose.p3Row,
                    draft.definition.retentionMonths ?? purpose.retention.months,
                    t,
                  )
                }}
              </dd>
              <dt>{{ t('admin.forms.settings.freeText') }}</dt>
              <dd>
                {{
                  t(
                    purpose.freeText
                      ? 'admin.forms.settings.freeTextOn'
                      : 'admin.forms.settings.freeTextOff',
                  )
                }}
              </dd>
            </dl>

            <AdminTextInput
              v-if="purpose"
              id="settings-retention"
              :model-value="draft.definition.retentionMonths?.toString() ?? ''"
              type="number"
              :min="1"
              :max="purpose.retention.months"
              :label="t('admin.forms.settings.retention')"
              :hint="t('admin.forms.settings.retentionHint', { months: purpose.retention.months })"
              @update:model-value="setRetention"
            />

            <fieldset v-if="purpose">
              <legend>{{ t('admin.forms.settings.readers') }}</legend>
              <p class="hint">{{ t('admin.forms.settings.readersHint') }}</p>
              <label v-for="role in purpose.readers" :key="role" class="choice">
                <input
                  type="checkbox"
                  :checked="(draft.definition.readers as readonly string[]).includes(role)"
                  @change="toggleReader(role, $event)"
                />
                {{ t(`admin.roles.${role}`) }}
              </label>
            </fieldset>

            <fieldset>
              <legend>{{ t('admin.forms.settings.actions') }}</legend>
              <p class="hint">{{ t('admin.forms.settings.actionsHint') }}</p>
              <label v-for="action in allowedActions" :key="action" class="choice">
                <input
                  type="checkbox"
                  :checked="draft.definition.actions.includes(action)"
                  @change="toggleAction(action, $event)"
                />
                {{ t(`admin.forms.actions.${action}`) }}
              </label>
            </fieldset>

            <div v-if="kind === 'application'" class="field">
              <label for="settings-receipt">{{ t('admin.forms.settings.receipt') }}</label>
              <select
                id="settings-receipt"
                class="input"
                :value="draft.definition.receipt"
                @change="setReceipt"
              >
                <option v-for="receipt in receipts" :key="receipt" :value="receipt">
                  {{ t(`admin.forms.receipts.${receipt}`) }}
                </option>
              </select>
            </div>

            <label class="choice">
              <input type="checkbox" :checked="draft.definition.note" @change="setNote" />
              {{ t('admin.forms.settings.note') }}
            </label>
            <template v-if="draft.definition.note">
              <AdminTextInput
                :id="textInputId('note.heading')"
                v-bind="words('note.heading')"
                :label="t('admin.forms.settings.noteHeading')"
                :limit="TEXT_LIMITS.heading"
              />
              <AdminTextInput
                :id="textInputId('note.body')"
                v-bind="words('note.body')"
                :label="t('admin.forms.settings.noteBody')"
                :limit="TEXT_LIMITS.noteBody"
                multiline
              />
            </template>

            <h3>{{ t('admin.forms.settings.fixedHeading') }}</h3>
            <dl class="admin-facts">
              <dt>{{ t('admin.forms.settings.drafts') }}</dt>
              <dd>{{ t('admin.forms.settings.draftsValue') }}</dd>
              <dt>{{ t('admin.forms.settings.fixedParts') }}</dt>
              <dd>{{ t('admin.forms.settings.fixedPartsValue') }}</dd>
              <dt>{{ t('admin.forms.settings.versions') }}</dt>
              <dd>{{ t('admin.forms.settings.versionsValue') }}</dd>
              <dt>{{ t('admin.forms.settings.words') }}</dt>
              <dd>{{ t('admin.forms.settings.wordsValue') }}</dd>
            </dl>
          </section>

          <div class="admin-save">
            <p v-if="saveError" class="admin__alert" role="alert">{{ saveError }}</p>
            <p class="hint">
              {{ t(changed ? 'admin.forms.builder.unsaved' : 'admin.forms.builder.allSaved') }}
            </p>
            <button
              type="button"
              class="button button--primary"
              :aria-disabled="busy ? 'true' : undefined"
              @click="save"
            >
              {{ t('admin.forms.builder.save') }}
            </button>
          </div>
        </div>

        <div class="admin-builder__side">
          <section aria-labelledby="checks-heading">
            <h2 id="checks-heading">{{ t('admin.forms.checks.heading') }}</h2>
            <p v-if="!check">{{ t('admin.forms.checks.notYet') }}</p>
            <template v-else>
              <p v-if="changed" class="hint">{{ t('admin.forms.checks.stale') }}</p>
              <AdminFormChecks
                ref="checksView"
                :check="check"
                :definition="draft.definition"
                :text="draft.text"
                linked
              />
              <!-- Publish opens its own page once every check is done; before that it
                   moves focus to the things to fix (canvas, form builder). -->
              <NuxtLink
                v-if="check.ok && !changed"
                :to="`/admin/forms/${id}/publish`"
                class="button button--primary"
              >
                {{ t('admin.forms.builder.publishLink') }}
              </NuxtLink>
              <button
                v-else
                type="button"
                class="button button--primary"
                aria-disabled="true"
                aria-describedby="publish-when"
                @click="showChecks"
              >
                {{ t('admin.forms.builder.publishLink') }}
              </button>
              <p id="publish-when" class="hint">{{ t('admin.forms.checks.publishWhen') }}</p>
            </template>
          </section>

          <section aria-labelledby="preview-heading">
            <h2 id="preview-heading">{{ t('admin.forms.preview.heading') }}</h2>
            <p class="hint">{{ t('admin.forms.preview.lead') }}</p>
            <AdminFormPreview v-if="preview" :form="preview" />
            <p v-else>{{ t('admin.forms.preview.none') }}</p>
          </section>
        </div>
      </div>
    </template>
  </main>
</template>
