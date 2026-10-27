<script setup lang="ts">
import { hasPage } from '#shared/site-nav'

// "That didn't send", for apply (#17) and say hello (#14). What was typed
// stays in the form, and the copy button puts it on the clipboard as plain
// text, so nothing is lost if the page reloads. Where the clipboard can't be used, the text appears in a box,
// selected, ready to copy. It names no Kinmeet address: there's no domain
// yet. The page focuses this box when it appears.
const props = defineProps<{
  /** Whose wording to use, under `<form>.failed`. */
  form: 'apply' | 'hello'
  reason: SendProblem
  /** Everything typed, as plain text. */
  answers: string
}>()

const { t } = useI18n()
// Say hello is somewhere else to try, unless this is say hello.
const sayHello = props.form === 'apply' && hasPage('/say-hello')
const root = ref<HTMLElement | null>(null)
const box = ref<HTMLTextAreaElement | null>(null)
const copied = ref<'yes' | 'fallback'>()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.answers)
    copied.value = 'yes'
  } catch {
    copied.value = 'fallback'
    await nextTick()
    box.value?.focus()
    box.value?.select()
  }
}

defineExpose({ focus: () => root.value?.focus() })
</script>

<template>
  <div
    ref="root"
    class="error-summary send-failed"
    tabindex="-1"
    aria-labelledby="send-failed-title"
  >
    <h2 id="send-failed-title">{{ t(`${form}.failed.title`) }}</h2>
    <p>{{ t(`${form}.failed.${reason}`) }}</p>
    <p>{{ t(`${form}.failed.copy_note`) }}</p>
    <button type="button" class="button button--secondary send-failed__copy" @click="copy">
      {{ t(`${form}.failed.copy`) }}
    </button>
    <!-- Always on the page, so the confirmation is announced (4.1.3). -->
    <p class="send-failed__status" role="status">
      {{ copied ? t(`${form}.failed.${copied === 'yes' ? 'copied' : 'copy_fallback'}`) : '' }}
    </p>
    <div v-if="copied === 'fallback'" class="field">
      <label for="send-failed-answers">{{ t(`${form}.failed.copy_box_label`) }}</label>
      <textarea
        id="send-failed-answers"
        ref="box"
        class="input"
        rows="10"
        readonly
        :value="answers"
      />
    </div>
    <template v-if="sayHello">
      <p>{{ t(`${form}.failed.say_hello_note`) }}</p>
      <NuxtLink to="/say-hello">{{ t('apply.stop.say_hello') }}</NuxtLink>
    </template>
  </div>
</template>
