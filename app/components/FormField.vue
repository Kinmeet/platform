<script setup lang="ts">
import type { FieldDefinition } from '#shared/forms/definition'

// One field of a stored form (ADR-0010), drawn from its type in the fixed
// library (#15, #16). Every word comes from the version's text, under
// `fields.<id>`, and is always shown as text: `label`, an optional `hint`,
// `summary` (a confirm question's legend), `choices.<choice>`, a choice's
// `notes.<choice>`, and a confirm question's `link`.
const props = defineProps<{
  field: FieldDefinition
  text: Readonly<Record<string, string>>
  /** The field name in the API, such as `checks.over_18`. */
  path: string
  error?: string
  /** Whether an answer can reveal more questions on this step (Robin, #158). */
  revealsMore?: boolean
}>()
// An unanswered field is an empty string, which the flow treats as missing.
const model = defineModel<string>({ default: '' })

const { t } = useI18n()
const words = (part: string) => props.text[`fields.${props.field.id}.${part}`]
const id = computed(() => fieldId(props.path))
const hint = computed(() => {
  const parts = [words('hint'), props.revealsMore ? t('forms.reveals_more') : undefined]
  return parts.filter(Boolean).join(' ') || undefined
})
const describedBy = computed(
  () =>
    [hint.value && `${id.value}-hint`, props.error && `${id.value}-error`]
      .filter(Boolean)
      .join(' ') || undefined,
)

// The note for the chosen answer, if its outcome is `{ note: true }`.
const note = computed(() => {
  if (props.field.type !== 'single_choice' || !model.value) return ''
  const outcome = props.field.outcomes?.[model.value]
  return outcome && 'note' in outcome ? (words(`notes.${model.value}`) ?? '') : ''
})

const ticked = computed({
  get: () => model.value === 'yes',
  set: (value: boolean) => (model.value = value ? 'yes' : ''),
})
</script>

<template>
  <FormTextField
    v-if="field.type === 'long_text' || field.type === 'short_text'"
    :id="id"
    v-model="model"
    :multiline="field.type === 'long_text'"
    :label="words('label') ?? ''"
    :hint="hint"
    :error="error"
    :max-length="field.maxLength"
  />
  <FormTextField
    v-else-if="field.type === 'email' || field.type === 'call_name'"
    :id="id"
    v-model="model"
    :type="field.type === 'email' ? 'email' : 'text'"
    :label="words('label') ?? ''"
    :hint="hint"
    :error="error"
    :autocomplete="field.type === 'email' ? 'email' : 'nickname'"
  />
  <fieldset v-else :class="{ 'fieldset--error': error }" :aria-describedby="describedBy">
    <legend>{{ words(field.type === 'confirm' ? 'summary' : 'label') }}</legend>
    <p v-if="hint" :id="`${id}-hint`" class="hint">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" class="error-message">{{ error }}</p>
    <template v-if="field.type === 'single_choice'">
      <label v-for="(choice, index) in field.choices" :key="choice" class="choice">
        <input
          :id="index === 0 ? id : undefined"
          v-model="model"
          type="radio"
          :name="id"
          :value="choice"
          :aria-invalid="error ? 'true' : undefined"
        />
        {{ words(`choices.${choice}`) }}
      </label>
      <!-- Always on the page, so the note is announced when it appears. -->
      <p v-if="field.outcomes" class="note apply-question__note" aria-live="polite">
        {{ note }}
      </p>
    </template>
    <template v-else>
      <label class="choice choice--statement">
        <input
          :id="id"
          v-model="ticked"
          type="checkbox"
          :aria-invalid="error ? 'true' : undefined"
        />
        <span>{{ words('label') }}</span>
      </label>
      <a
        v-if="field.link"
        :href="field.link"
        class="apply-question__link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ words('link') }}
      </a>
    </template>
  </fieldset>
</template>
