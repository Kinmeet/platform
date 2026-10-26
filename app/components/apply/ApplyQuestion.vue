<script setup lang="ts">
import type { CheckQuestion, RoleQuestion } from '#shared/forms/roles'

// One step 1 check or step 3 question, drawn from the role config (#15).
// Every word comes from `roles.<slug>.questions.<id>`. Role-specific extras
// (the notes after a choice, the GOV.UK link, stop pages) are #16.
const props = defineProps<{
  roleKey: string
  question: CheckQuestion | RoleQuestion
  /** The field name in the API, such as `checks.over_18`. */
  field: string
  error?: string
}>()
// An unanswered question is an empty string, which the flow treats as missing.
const model = defineModel<string>({ default: '' })

const { t, te } = useI18n()
const key = computed(() => `${props.roleKey}.questions.${props.question.id}`)
const id = computed(() => fieldId(props.field))
const hint = computed(() => (te(`${key.value}.hint`) ? t(`${key.value}.hint`) : undefined))
const describedBy = computed(
  () =>
    [hint.value && `${id.value}-hint`, props.error && `${id.value}-error`]
      .filter(Boolean)
      .join(' ') || undefined,
)

const ticked = computed({
  get: () => model.value === 'yes',
  set: (value: boolean) => (model.value = value ? 'yes' : ''),
})
</script>

<template>
  <FormTextField
    v-if="question.type === 'long_text'"
    :id="id"
    v-model="model"
    multiline
    :label="t(`${key}.label`)"
    :hint="hint"
    :error="error"
  />
  <fieldset v-else :class="{ 'fieldset--error': error }" :aria-describedby="describedBy">
    <legend>{{ t(question.type === 'confirm' ? `${key}.summary` : `${key}.label`) }}</legend>
    <p v-if="hint" :id="`${id}-hint`" class="hint">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" class="error-message">{{ error }}</p>
    <template v-if="question.type === 'single_choice'">
      <label v-for="(choice, index) in question.choices" :key="choice" class="choice">
        <input
          :id="index === 0 ? id : undefined"
          v-model="model"
          type="radio"
          :name="id"
          :value="choice"
          :aria-invalid="error ? 'true' : undefined"
        />
        {{ t(`${key}.choices.${choice}`) }}
      </label>
    </template>
    <label v-else class="choice choice--statement">
      <input :id="id" v-model="ticked" type="checkbox" :aria-invalid="error ? 'true' : undefined" />
      <span>{{ t(`${key}.label`) }}</span>
    </label>
  </fieldset>
</template>
