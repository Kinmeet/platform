<script setup lang="ts">
// One labelled input for the form builder (#160), with its hint joined by
// aria-describedby. Admin text is typed here and always shown as text.
// `maxlength` is left off on purpose: a paste that runs over is kept, and
// the publish checks say it is too long, rather than the browser quietly
// cutting it short.
const props = defineProps<{
  id: string
  label: string
  hint?: string
  multiline?: boolean
  type?: 'text' | 'number' | 'url'
  /** Text inputs only: the most characters the checks will accept, said in the hint. */
  limit?: number
  min?: number
  max?: number
}>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()

const hintText = computed(() => {
  const parts = [props.hint, props.limit ? t('admin.forms.limit', { max: props.limit }) : '']
  return parts.filter(Boolean).join(' ') || undefined
})
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <p v-if="hintText" :id="`${id}-hint`" class="hint">{{ hintText }}</p>
    <textarea
      v-if="multiline"
      :id="id"
      v-model="model"
      class="input"
      rows="3"
      :aria-describedby="hintText ? `${id}-hint` : undefined"
    />
    <input
      v-else
      :id="id"
      v-model="model"
      class="input"
      :type="type ?? 'text'"
      :min="min"
      :max="max"
      :inputmode="type === 'number' ? 'numeric' : undefined"
      autocomplete="off"
      :aria-describedby="hintText ? `${id}-hint` : undefined"
    />
  </div>
</template>
