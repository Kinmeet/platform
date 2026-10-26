<script setup lang="ts">
import { isFormRoute } from '#shared/routes'

// The spam check on say hello and apply step 4 (S5, #20). The script loads
// only when this component mounts, and only on a form route, because the
// security policy allows Cloudflare's origin nowhere else. The form calls
// getToken() when Send is pressed and reset() after every send. Place it
// straight after the Send button, so the notice sits next to it.
//
// The form owns focus after a send: it moves focus to its error summary or
// confirmation as usual. This component only puts focus back on whatever
// had it (normally Send) when the "tick the box" widget closes, so a
// keyboard user isn't dropped at the top of the page (2.4.3).
const props = defineProps<{ action: 'hello' | 'apply' }>()

const { t, locale } = useI18n()
const route = useRoute()
const config = useRuntimeConfig()

const root = ref<HTMLElement | null>(null)
const container = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')
const interactive = ref(false)
let widget: TurnstileWidget | null = null
let focusBefore: HTMLElement | null = null
// Settles once the script has loaded or given up, so a Send pressed while
// it's still loading waits for it rather than failing (#17).
let settled: () => void
const loaded = new Promise<void>((resolve) => (settled = resolve))

// Status text lives in one region that is always on the page, so screen
// readers announce each change (4.1.3). "Couldn't load" is polite here
// because it can arrive while someone is typing; the form repeats it in its
// error summary when Send is pressed.
const statusText = computed(() => {
  if (interactive.value) return t('forms.turnstile.interactive')
  if (status.value === 'unavailable') return t('forms.turnstile.unavailable')
  return ''
})

function onInteractive(needed: boolean) {
  const closing = interactive.value && !needed
  interactive.value = needed
  if (closing && focusBefore?.isConnected) focusBefore.focus()
}

onMounted(async () => {
  const siteKey = config.public.turnstileSiteKey
  if (!siteKey || !isFormRoute(route.path) || !root.value || !container.value) {
    status.value = 'unavailable'
    settled()
    return
  }
  try {
    const api = await loadTurnstileScript(TURNSTILE_SCRIPT_SRC, TURNSTILE_LOAD_TIMEOUT_MS)
    widget = createTurnstileWidget(api, container.value, {
      sitekey: siteKey,
      action: props.action,
      language: locale.value,
      // Measured on the wrapper, because the widget's own box is empty until it renders.
      width: root.value.clientWidth,
      onInteractive,
    })
    status.value = 'ready'
  } catch {
    status.value = 'unavailable'
  } finally {
    settled()
  }
})

onBeforeUnmount(() => widget?.remove())

defineExpose({
  /** A fresh token, or a TurnstileError with reason `unavailable` or `failed`. */
  getToken: async () => {
    if (document.activeElement instanceof HTMLElement) focusBefore = document.activeElement
    await loaded
    if (!widget) throw new TurnstileError('unavailable')
    return widget.getToken()
  },
  reset: () => widget?.reset(),
})
</script>

<template>
  <div ref="root" class="turnstile">
    <p
      :class="[
        'turnstile__status',
        { 'turnstile__status--error': status === 'unavailable' && !interactive },
      ]"
      role="status"
    >
      {{ statusText }}
    </p>
    <div ref="container" class="turnstile__widget" />
    <p class="turnstile__notice muted small">{{ t('forms.turnstile.notice') }}</p>
  </div>
</template>
