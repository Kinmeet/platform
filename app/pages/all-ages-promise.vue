<script setup lang="ts">
import { promisePage } from '#shared/pages/promise'

// The all-ages promise (#77): a plain-English summary of SG-01, SG-05 and
// SG-06. Built ahead of its copy, so it's a 404 until the page is published
// with every key in `promise` filled in.
const { t } = useI18n()

if (!promisePage.published) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

useHead({
  title: () => t('promise.page_title'),
  meta: [{ name: 'description', content: () => t('promise.lede') }],
})
</script>

<template>
  <div class="promise-page">
    <section class="promise-intro" aria-labelledby="promise-title">
      <h1 id="promise-title">{{ t('promise.title') }}</h1>
      <p class="lede">{{ t('promise.lede') }}</p>
    </section>
    <div class="promise-sections">
      <section
        v-for="id in promisePage.sections"
        :key="id"
        class="patch"
        :aria-labelledby="`promise-${id}`"
      >
        <h2 :id="`promise-${id}`">{{ t(`promise.sections.${id}.heading`) }}</h2>
        <p>{{ t(`promise.sections.${id}.body`) }}</p>
      </section>
    </div>
  </div>
</template>
