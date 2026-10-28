<script setup lang="ts">
// Where a disclosure goes (SG6). Shown by every stored form whose P3 purpose
// takes free text, from the `safetyNote` flag the server works out, so a new
// form gets it without anyone adding it (Ezra, #162). Fixed text, never admin
// text. Say hello keeps its own wording for its message.
import type { PublicForm } from '#shared/forms/view'

const props = defineProps<{
  form: Pick<PublicForm, 'safetyNote'>
  /** A form's own fixed wording, in place of the shared one. */
  wording?: string
}>()

const { t } = useI18n()
</script>

<template>
  <p v-if="props.form.safetyNote" class="form-safety-note">
    {{ t(props.wording ?? 'forms.safety_note') }}
  </p>
</template>
