<script setup lang="ts">
import type { StopReason } from '#shared/forms/roles'
import { hasPage } from '#shared/site-nav'

// Where a step 1 answer ends the application (#16): under 18, or related to
// or living with someone on the founding team (Rowan, F3). Both use the same
// pattern. Back returns to step 1 with the answers kept, in case one was a
// slip. The page focuses the heading when this appears.
const props = defineProps<{ reason: StopReason }>()
defineEmits<{ back: [] }>()

const { t } = useI18n()
// Not on the under-18 page until area 5 decides how we handle messages from
// under-13s (Theo and Callum, #82).
const sayHello = computed(() => props.reason === 'not_independent' && hasPage('/say-hello'))
const heading = ref<HTMLElement | null>(null)
defineExpose({ focus: () => heading.value?.focus() })
</script>

<template>
  <div class="apply-stop">
    <h1 ref="heading" tabindex="-1">{{ t(`apply.stop.${reason}.title`) }}</h1>
    <p>{{ t(`apply.stop.${reason}.body`) }}</p>
    <p>{{ t(`apply.stop.${reason}.next`) }}</p>
    <div v-if="reason === 'not_independent'" class="apply-stop__links">
      <!-- Every role needs an adult, so the roles list only helps here. -->
      <NuxtLink to="/#roles" class="button button--secondary">
        {{ t('apply.stop.see_roles') }}
      </NuxtLink>
      <NuxtLink v-if="sayHello" to="/say-hello" class="button button--secondary">
        {{ t('apply.stop.say_hello') }}
      </NuxtLink>
    </div>
    <button type="button" class="button button--ghost" @click="$emit('back')">
      {{ t('apply.back') }}
    </button>
  </div>
</template>
