<script setup lang="ts">
// The form builder's editing panel for one question (ADR-0010, B3, #160).
// Pressing Edit on a question moves focus to this panel's heading, and Done
// moves it back. The answer type sets the input type and autocomplete, from
// the fixed library of six; error messages are our fixed wording, shown here
// so admins can see them but never edit them (Robin, B1 and B2). A choice can
// end an application only for one of the fixed stop reasons (F3, SG1).
import {
  LIMITS,
  fieldTypes,
  stopReasons,
  type FieldDefinition,
  type FieldType,
} from '#shared/forms/definition'
import { TEXT_LIMITS } from '#shared/forms/publish'
import type { FieldError } from '#shared/forms/errors'
import type { FormKind } from '#shared/forms/runtime'
import { fieldPath, type PublicForm } from '#shared/forms/view'

const props = defineProps<{ fieldId: string; kind: FormKind; slug: string }>()
const draft = defineModel<BuilderDraft>({ required: true })
const emit = defineEmits<{ done: []; remove: []; announce: [message: string] }>()

const { t } = useI18n()
const heading = ref<HTMLElement | null>(null)

const found = computed(() => findBuilderField(draft.value.definition, props.fieldId))
const field = computed(() => found.value?.field)
const key = (part: string) => `fields.${props.fieldId}.${part}`

/** Binds an admin text input to one key of the draft's en-GB text. */
function words(part: string) {
  return {
    modelValue: draft.value.text[key(part)] ?? '',
    'onUpdate:modelValue': (value: string) => (draft.value.text[key(part)] = value),
  }
}

const label = computed(() => draft.value.text[key('label')]?.trim() || '')

function setType(event: Event) {
  const type = (event.target as HTMLSelectElement).value as FieldType
  changeType(draft.value.definition, props.fieldId, type)
}

function setRequired(event: Event) {
  const current = field.value
  if (current && current.type !== 'confirm')
    current.required = (event.target as HTMLInputElement).checked
}

function setMaxLength(value: string) {
  const current = field.value
  if (current?.type !== 'short_text' && current?.type !== 'long_text') return
  const number = Number.parseInt(value, 10)
  current.maxLength = Number.isFinite(number) ? number : 0
}

// What each choice does when picked. Stopping is for applications only,
// and only for the fixed reasons.
type Outcome = 'continue' | 'note' | (typeof stopReasons)[number]
const outcomeChoices = computed<Outcome[]>(() =>
  props.kind === 'application' ? ['continue', 'note', ...stopReasons] : ['continue', 'note'],
)

function outcomeOf(choice: string): Outcome {
  const current = field.value
  if (current?.type !== 'single_choice') return 'continue'
  const outcome = current.outcomes?.[choice]
  if (!outcome) return 'continue'
  return 'note' in outcome ? 'note' : outcome.stop
}

function setOutcome(choice: string, event: Event) {
  const current = field.value
  if (current?.type !== 'single_choice') return
  const value = (event.target as HTMLSelectElement).value as Outcome
  const outcomes = Object.fromEntries(
    Object.entries(current.outcomes ?? {}).filter(([each]) => each !== choice),
  )
  if (value === 'note') outcomes[choice] = { note: true }
  else if (value !== 'continue') outcomes[choice] = { stop: value }
  if (Object.keys(outcomes).length) current.outcomes = outcomes
  else delete current.outcomes
}

function choiceName(choice: string, index: number): string {
  return (
    draft.value.text[key(`choices.${choice}`)]?.trim() ||
    t('admin.forms.editor.choiceUntitled', { number: index + 1 })
  )
}

async function onAddChoice() {
  const current = field.value
  if (!current) return
  const id = addChoice(current)
  if (!id) return
  await nextTick()
  document.getElementById(`choice-${props.fieldId}-${id}`)?.focus()
}

async function onMoveChoice(choice: string, index: number, by: -1 | 1) {
  const current = field.value
  if (!current) return
  const name = choiceName(choice, index)
  const position = moveChoice(current, choice, by)
  if (position === undefined) return
  const count = current.type === 'single_choice' ? current.choices.length : 0
  emit('announce', t('admin.forms.editor.choiceMoved', { name, position, count }))
}

async function onRemoveChoice(choice: string, index: number) {
  const current = field.value
  if (!current) return
  const name = choiceName(choice, index)
  removeChoice(draft.value.definition, current, choice)
  emit('announce', t('admin.forms.editor.choiceRemoved', { name }))
  await nextTick()
  document.getElementById(`choices-${props.fieldId}`)?.focus()
}

// Show-if: an earlier one-choice question, and which of its answers show this one.
const targets = computed(() => showIfTargets(draft.value.definition, props.fieldId))
function setShowIfTarget(event: Event) {
  const current = field.value
  if (!current) return
  const target = (event.target as HTMLSelectElement).value
  const chosen = targets.value.find((each) => each.id === target)
  if (chosen?.type !== 'single_choice') delete current.showIf
  else current.showIf = { field: chosen.id, in: [chosen.choices[0]!] }
}
const showIfField = computed(() => {
  const target = field.value?.showIf?.field
  const chosen = targets.value.find((each) => each.id === target)
  return chosen?.type === 'single_choice' ? chosen : undefined
})
function toggleShowIfChoice(choice: string, event: Event) {
  const condition = field.value?.showIf
  if (!condition) return
  const on = (event.target as HTMLInputElement).checked
  const next = on ? [...condition.in, choice] : condition.in.filter((each) => each !== choice)
  // Keep the order of the trigger's own choices, so the stored condition reads the same way.
  condition.in = showIfField.value?.choices.filter((each) => next.includes(each)) ?? next
}
const targetLabel = (target: FieldDefinition) =>
  draft.value.text[`fields.${target.id}.label`]?.trim() ||
  t('admin.forms.checks.where.untitled', { id: target.id })

const linkOn = computed(() => field.value?.type === 'confirm' && field.value.link !== undefined)
function setLink(value: string) {
  const current = field.value
  if (current?.type !== 'confirm') return
  if (value.trim() === '') delete current.link
  else current.link = value.trim()
}

/**
 * The fixed error messages this question can show, in our wording, as the
 * form's page would show them (Robin, B1). Worked out with the same
 * functions the public pages use, so the two can't disagree.
 */
const fixedErrors = computed(() => {
  const located = found.value
  if (!located) return []
  const step = draft.value.definition.steps[located.stepIndex]!
  const path = fieldPath(step, located.field)
  const form: PublicForm = {
    slug: props.slug,
    kind: props.kind,
    version: 0,
    definition: draft.value.definition,
    text: draft.value.text,
    safetyNote: false,
  }
  const codes: FieldError['code'][] = ['required']
  if (located.field.type === 'email') codes.push('invalid_email')
  if (['short_text', 'long_text', 'email', 'call_name'].includes(located.field.type))
    codes.push('too_long')
  return codes.map((code) => {
    const error = { field: path, code }
    const message =
      props.kind === 'form' ? helloErrorMessage(error, form) : errorMessage(error, form)
    return { code, text: t(message.key, message.params) }
  })
})

const summaryExample = computed(() => {
  const question = draft.value.text[key('summary')]?.trim()
  const first = fixedErrors.value[0]
  return question && first ? t('apply.errors.summary_item', { question, message: first.text }) : ''
})

defineExpose({ focus: () => heading.value?.focus() })
</script>

<template>
  <section v-if="field" class="admin-editor" aria-labelledby="editor-heading">
    <h2 id="editor-heading" ref="heading" tabindex="-1">
      {{
        label ? t('admin.forms.editor.heading', { label }) : t('admin.forms.editor.headingUntitled')
      }}
    </h2>

    <AdminTextInput
      id="q-label"
      v-bind="words('label')"
      :label="
        t(field.type === 'confirm' ? 'admin.forms.editor.statement' : 'admin.forms.editor.label')
      "
      :hint="
        t(
          field.type === 'confirm'
            ? 'admin.forms.editor.statementHint'
            : 'admin.forms.editor.labelHint',
        )
      "
      :limit="TEXT_LIMITS.label"
    />
    <AdminTextInput
      id="q-summary"
      v-bind="words('summary')"
      :label="t('admin.forms.editor.summary')"
      :hint="t('admin.forms.editor.summaryHint')"
      :limit="TEXT_LIMITS.summary"
    />
    <AdminTextInput
      id="q-hint"
      v-bind="words('hint')"
      :label="t('admin.forms.editor.hint')"
      :hint="t('admin.forms.editor.hintHint')"
      :limit="TEXT_LIMITS.hint"
      multiline
    />

    <div class="field">
      <label for="q-type">{{ t('admin.forms.editor.type') }}</label>
      <p id="q-type-hint" class="hint">{{ t('admin.forms.editor.typeHint') }}</p>
      <select
        id="q-type"
        class="input"
        :value="field.type"
        aria-describedby="q-type-hint q-type-about"
        @change="setType"
      >
        <option v-for="type in fieldTypes" :key="type" :value="type">
          {{ t(`admin.forms.types.${type}.name`) }}
        </option>
      </select>
      <p id="q-type-about" class="hint">{{ t(`admin.forms.types.${field.type}.about`) }}</p>
    </div>

    <label v-if="field.type !== 'confirm'" class="choice">
      <input type="checkbox" :checked="field.required" @change="setRequired" />
      {{ t('admin.forms.editor.required') }}
    </label>

    <AdminTextInput
      v-if="field.type === 'short_text' || field.type === 'long_text'"
      id="q-max-length"
      :model-value="String(field.maxLength)"
      type="number"
      :min="1"
      :max="LIMITS.maxLength[field.type]"
      :label="t('admin.forms.editor.maxLength')"
      :hint="t('admin.forms.editor.maxLengthHint', { max: LIMITS.maxLength[field.type] })"
      @update:model-value="setMaxLength"
    />

    <fieldset
      v-if="field.type === 'single_choice'"
      :id="`choices-${fieldId}`"
      class="admin-editor__choices"
      tabindex="-1"
    >
      <legend>{{ t('admin.forms.editor.choices') }}</legend>
      <p class="hint">
        {{
          t('admin.forms.editor.choicesHint', { min: LIMITS.choicesMin, max: LIMITS.choicesMax })
        }}
      </p>
      <ol class="admin-editor__choice-list">
        <li v-for="(choice, index) in field.choices" :key="choice" class="admin-editor__choice">
          <AdminTextInput
            :id="`choice-${fieldId}-${choice}`"
            v-bind="words(`choices.${choice}`)"
            :label="t('admin.forms.editor.choiceText', { number: index + 1 })"
            :limit="TEXT_LIMITS.choice"
          />
          <div class="field">
            <label :for="`outcome-${fieldId}-${choice}`">
              {{ t('admin.forms.editor.outcome', { number: index + 1 }) }}
            </label>
            <select
              :id="`outcome-${fieldId}-${choice}`"
              class="input"
              :value="outcomeOf(choice)"
              @change="setOutcome(choice, $event)"
            >
              <option v-for="outcome in outcomeChoices" :key="outcome" :value="outcome">
                {{ t(`admin.forms.outcomes.${outcome}`) }}
              </option>
            </select>
          </div>
          <AdminTextInput
            v-if="outcomeOf(choice) === 'note'"
            :id="`note-${fieldId}-${choice}`"
            v-bind="words(`notes.${choice}`)"
            :label="t('admin.forms.editor.choiceNote', { number: index + 1 })"
            :limit="TEXT_LIMITS.notes"
            multiline
          />
          <div class="admin-actions">
            <button
              type="button"
              class="button button--small button--ghost"
              :aria-disabled="index === 0 ? 'true' : undefined"
              @click="onMoveChoice(choice, index, -1)"
            >
              {{ t('admin.forms.moveUp') }}
              <span class="visually-hidden">{{ choiceName(choice, index) }}</span>
            </button>
            <button
              type="button"
              class="button button--small button--ghost"
              :aria-disabled="index === field.choices.length - 1 ? 'true' : undefined"
              @click="onMoveChoice(choice, index, 1)"
            >
              {{ t('admin.forms.moveDown') }}
              <span class="visually-hidden">{{ choiceName(choice, index) }}</span>
            </button>
            <button
              type="button"
              class="button button--small button--ghost"
              :aria-disabled="field.choices.length <= LIMITS.choicesMin ? 'true' : undefined"
              @click="onRemoveChoice(choice, index)"
            >
              {{ t('admin.forms.remove') }}
              <span class="visually-hidden">{{ choiceName(choice, index) }}</span>
            </button>
          </div>
        </li>
      </ol>
      <button
        type="button"
        class="button button--secondary"
        :aria-disabled="field.choices.length >= LIMITS.choicesMax ? 'true' : undefined"
        @click="onAddChoice"
      >
        {{ t('admin.forms.editor.addChoice') }}
      </button>
    </fieldset>

    <template v-if="field.type === 'confirm'">
      <AdminTextInput
        id="q-ticked"
        v-bind="words('choices.yes')"
        :label="t('admin.forms.editor.ticked')"
        :hint="t('admin.forms.editor.tickedHint')"
        :limit="TEXT_LIMITS.choice"
      />
      <AdminTextInput
        id="q-link"
        :model-value="field.link ?? ''"
        type="url"
        :label="t('admin.forms.editor.link')"
        :hint="t('admin.forms.editor.linkHint')"
        @update:model-value="setLink"
      />
      <AdminTextInput
        v-if="linkOn"
        id="q-link-text"
        v-bind="words('link')"
        :label="t('admin.forms.editor.linkText')"
        :hint="t('admin.forms.editor.linkTextHint')"
        :limit="TEXT_LIMITS.link"
      />
    </template>

    <div class="field">
      <label for="q-show-if">{{ t('admin.forms.editor.showIf') }}</label>
      <p id="q-show-if-hint" class="hint">{{ t('admin.forms.editor.showIfHint') }}</p>
      <select
        id="q-show-if"
        class="input"
        :value="field.showIf?.field ?? ''"
        aria-describedby="q-show-if-hint"
        @change="setShowIfTarget"
      >
        <option value="">{{ t('admin.forms.editor.showAlways') }}</option>
        <option v-for="target in targets" :key="target.id" :value="target.id">
          {{ t('admin.forms.editor.showWhen', { label: targetLabel(target) }) }}
        </option>
      </select>
    </div>
    <fieldset v-if="showIfField && field.showIf">
      <legend>
        {{ t('admin.forms.editor.showIfChoices', { label: targetLabel(showIfField) }) }}
      </legend>
      <label v-for="(choice, index) in showIfField.choices" :key="choice" class="choice">
        <input
          type="checkbox"
          :checked="field.showIf.in.includes(choice)"
          @change="toggleShowIfChoice(choice, $event)"
        />
        {{
          draft.text[`fields.${showIfField.id}.choices.${choice}`]?.trim() ||
          t('admin.forms.editor.choiceUntitled', { number: index + 1 })
        }}
      </label>
    </fieldset>

    <div class="admin-editor__errors">
      <h3>{{ t('admin.forms.editor.errorsHeading') }}</h3>
      <p class="hint">{{ t('admin.forms.editor.errorsHint') }}</p>
      <ul>
        <li v-for="error in fixedErrors" :key="error.code">{{ error.text }}</li>
      </ul>
      <p v-if="summaryExample" class="hint">
        {{ t('admin.forms.editor.summaryExample', { example: summaryExample }) }}
      </p>
    </div>

    <div class="admin-actions">
      <button type="button" class="button button--primary" @click="emit('done')">
        {{ t('admin.forms.editor.done') }}
      </button>
      <button type="button" class="button button--ghost" @click="emit('remove')">
        {{ t('admin.forms.editor.removeQuestion') }}
      </button>
    </div>
  </section>
</template>
