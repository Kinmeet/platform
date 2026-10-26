<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: () => t('home.title'),
  meta: [{ name: 'description', content: () => t('home.lead') }],
})
</script>

<template>
  <main class="placeholder">
    <p class="placeholder__name">{{ t('site.name') }}</p>
    <h1 class="placeholder__title">{{ t('home.title') }}</h1>
    <p class="placeholder__lead">{{ t('home.lead') }}</p>
    <p>{{ t('home.status') }}</p>
  </main>
</template>
