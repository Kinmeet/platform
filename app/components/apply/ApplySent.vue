<script setup lang="ts">
import type { PublishedRole } from '#shared/forms/roles'
import { hasPage } from '#shared/site-nav'

// Once an application is stored (#17): thanks by the name they gave, what the
// receipt does and doesn't say, and the same next steps as the role page. The
// answers are already emptied. The page focuses the heading when this appears.
defineProps<{ role: PublishedRole; sent: ApplicationSent }>()

const { t } = useI18n()
const sayHello = hasPage('/say-hello')
const heading = ref<HTMLElement | null>(null)
defineExpose({ focus: () => heading.value?.focus() })
</script>

<template>
  <div class="apply-sent">
    <p class="sticker">{{ t('apply.sent.label') }}</p>
    <h1 ref="heading" tabindex="-1">{{ t('apply.sent.title', { name: sent.callName }) }}</h1>
    <p>{{ t(`apply.sent.receipt_${sent.receipt}`) }}</p>
    <section class="patch patch--flat apply-sent__next" aria-labelledby="sent-next">
      <h2 id="sent-next">{{ t('apply.sent.next') }}</h2>
      <RoleNextSteps :role="role" />
    </section>
    <NuxtLink to="/#roles" class="button button--secondary">
      {{ t('apply.sent.back_to_roles') }}
    </NuxtLink>
    <template v-if="sayHello">
      <p>{{ t('apply.sent.questions') }}</p>
      <NuxtLink to="/say-hello" class="button button--ghost">{{
        t('apply.stop.say_hello')
      }}</NuxtLink>
    </template>
  </div>
</template>
