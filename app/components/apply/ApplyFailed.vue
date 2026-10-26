<script setup lang="ts">
import { hasPage } from '#shared/site-nav'

// "That didn't send" (#17). The answers stay in the form, and Copy my answers
// puts them on the clipboard as plain text, so nothing is lost if the page
// reloads. Where the clipboard can't be used, the text appears in a box,
// selected, ready to copy. It names no Kinmeet address: there's no domain
// yet. The page focuses this box when it appears.
const props = defineProps<{ reason: SendProblem; answers: string }>()

const { t } = useI18n()
const sayHello = hasPage('/say-hello')
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
    <h2 id="send-failed-title">{{ t('apply.failed.title') }}</h2>
    <p>{{ t(`apply.failed.${reason}`) }}</p>
    <p>{{ t('apply.failed.copy_note') }}</p>
    <button type="button" class="button button--secondary send-failed__copy" @click="copy">
      {{ t('apply.failed.copy') }}
    </button>
    <!-- Always on the page, so the confirmation is announced (4.1.3). -->
    <p class="send-failed__status" role="status">
      {{ copied ? t(copied === 'yes' ? 'apply.failed.copied' : 'apply.failed.copy_fallback') : '' }}
    </p>
    <div v-if="copied === 'fallback'" class="field">
      <label for="send-failed-answers">{{ t('apply.failed.copy_box_label') }}</label>
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
      <p>{{ t('apply.failed.say_hello_note') }}</p>
      <NuxtLink to="/say-hello">{{ t('apply.stop.say_hello') }}</NuxtLink>
    </template>
  </div>
</template>
