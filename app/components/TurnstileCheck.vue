<script setup lang="ts">
import { isFormRoute } from '#shared/routes'
import { TURNSTILE_ORIGIN } from '#shared/turnstile'

// The spam check on say hello and apply step 4 (S5, #20). The script loads
// only when this component mounts, and only on a form route, because the
// security policy allows Cloudflare's origin nowhere else. The form calls
// getToken() when Send is pressed and reset() after every send. Place it
// straight after the Send button, so the notice sits next to it.
const props = defineProps<{ action: 'hello' | 'apply' }>()

const { t, locale } = useI18n()
const route = useRoute()
const config = useRuntimeConfig()

const container = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')
const interactive = ref(false)
let widget: TurnstileWidget | null = null

// Gives up if the script hasn't loaded in this time, so the form can say so.
const LOAD_TIMEOUT_MS = 15_000

onMounted(async () => {
  const siteKey = config.public.turnstileSiteKey
  if (!siteKey || !isFormRoute(route.path) || !container.value) {
    status.value = 'unavailable'
    return
  }
  try {
    const api = await loadTurnstileScript(
      `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`,
      LOAD_TIMEOUT_MS,
    )
    widget = createTurnstileWidget(api, container.value, {
      sitekey: siteKey,
      action: props.action,
      language: locale.value,
      onInteractive: (needed) => (interactive.value = needed),
    })
    status.value = 'ready'
  } catch {
    status.value = 'unavailable'
  }
})

onBeforeUnmount(() => widget?.remove())

defineExpose({
  /** A fresh token, or a TurnstileError with reason `unavailable` or `failed`. */
  getToken: () => (widget ? widget.getToken() : Promise.reject(new TurnstileError('unavailable'))),
  reset: () => widget?.reset(),
})
</script>

<template>
  <div class="turnstile">
    <p v-if="interactive" class="turnstile__prompt" role="status">
      {{ t('forms.turnstile.interactive') }}
    </p>
    <div ref="container" class="turnstile__widget" />
    <p v-if="status === 'unavailable'" class="turnstile__unavailable" role="alert">
      {{ t('forms.turnstile.unavailable') }}
    </p>
    <p class="turnstile__notice muted small">{{ t('forms.turnstile.notice') }}</p>
  </div>
</template>
