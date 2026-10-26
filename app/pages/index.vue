<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: () => t('home.title'),
  meta: [{ name: 'description', content: () => t('home.lead') }],
})
</script>

<template>
  <div class="placeholder">
    <h1 class="placeholder__title">{{ t('home.title') }}</h1>
    <p class="placeholder__lead">{{ t('home.lead') }}</p>
    <p>{{ t('home.status') }}</p>
  </div>
</template>
