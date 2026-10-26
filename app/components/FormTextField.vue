<script setup lang="ts">
// One labelled text input or text area, with its hint and error message
// joined to it by `aria-describedby` (#15). Shared by apply and say hello.
const props = defineProps<{
  id: string
  label: string
  hint?: string
  error?: string
  multiline?: boolean
  type?: 'text' | 'email'
  autocomplete?: string
}>()
const model = defineModel<string>({ required: true })

const describedBy = computed(
  () =>
    [props.hint && `${props.id}-hint`, props.error && `${props.id}-error`]
      .filter(Boolean)
      .join(' ') || undefined,
)
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <p v-if="hint" :id="`${id}-hint`" class="hint">{{ hint }}</p>
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
  </div>
</template>
