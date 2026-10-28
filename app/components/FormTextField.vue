<script setup lang="ts">
// One labelled text input or text area, with its hint and error message
// joined to it by `aria-describedby` (#15). Shared by apply and say hello.
// A long answer (Robin, #158) also says its limit in the hint and counts
// what's left, announced politely only once it's close.
const props = defineProps<{
  id: string
  label: string
  hint?: string
  error?: string
  multiline?: boolean
  type?: 'text' | 'email'
  autocomplete?: string
  /** Most characters (Unicode code points) the answer may have. */
  maxLength?: number
}>()
const model = defineModel<string>({ required: true })

const { t } = useI18n()

/** Limits above this get a count; a short answer's limit is rarely reached. */
const COUNT_FROM = 500
const counted = computed(() => props.multiline && (props.maxLength ?? 0) > COUNT_FROM)
const limit = computed(() =>
  counted.value ? t('forms.count.limit', { max: props.maxLength }) : undefined,
)
// Code points, as the server counts them.
const left = computed(() => (props.maxLength ?? 0) - [...model.value].length)
// Spoken and shown only near the limit, so typing isn't interrupted.
const near = computed(() => counted.value && left.value <= Math.ceil((props.maxLength ?? 0) / 10))
const count = computed(() => {
  if (!near.value) return ''
  return left.value >= 0
    ? t('forms.count.left', { count: left.value }, left.value)
    : t('forms.count.over', { count: -left.value }, -left.value)
})

const describedBy = computed(
  () =>
    [
      props.hint && `${props.id}-hint`,
      limit.value && `${props.id}-limit`,
      props.error && `${props.id}-error`,
    ]
      .filter(Boolean)
      .join(' ') || undefined,
)
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <p v-if="hint" :id="`${id}-hint`" class="hint">{{ hint }}</p>
    <p v-if="limit" :id="`${id}-limit`" class="hint">{{ limit }}</p>
    <p v-if="error" :id="`${id}-error`" class="error-message">{{ error }}</p>
    <textarea
      v-if="multiline"
      :id="id"
      v-model="model"
      class="input"
      rows="5"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
    />
    <input
      v-else
      :id="id"
      v-model="model"
      class="input"
      :type="type ?? 'text'"
      :autocomplete="autocomplete"
      :spellcheck="type === 'email' ? 'false' : undefined"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
    />
    <p v-if="counted" class="hint field__count" role="status">{{ count }}</p>
  </div>
</template>
