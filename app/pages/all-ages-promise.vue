<script setup lang="ts">
import { promisePage, type PromiseSection } from '#shared/pages/promise'
import type { MessageFunction, VueMessageType } from 'vue-i18n'

// Compiled copy, read back with rt(): a paragraph or a list (PromiseBlock).
type Compiled = string | MessageFunction<VueMessageType>
type PromiseBlockMessage = { text: Compiled } | { items: Compiled[] }

// The all-ages promise (#77): a plain-English summary of SG-01, SG-05 and
// SG-06. Built ahead of its copy, so it's a 404 until the page is published
// with every key in `promise` filled in.
const { t, tm, rt } = useI18n()

/** A section's paragraphs and lists, in order. */
function blocks(id: PromiseSection) {
  return tm(`promise.sections.${id}.blocks`) as unknown as PromiseBlockMessage[]
}

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
    <div class="promise-intro">
      <h1>{{ t('promise.title') }}</h1>
      <p class="lede">{{ t('promise.lede') }}</p>
    </div>
    <div class="promise-sections">
      <section
        v-for="id in promisePage.sections"
        :key="id"
        class="patch"
        :aria-labelledby="`promise-${id}`"
      >
        <h2 :id="`promise-${id}`">{{ t(`promise.sections.${id}.heading`) }}</h2>
        <template v-for="(block, index) in blocks(id)" :key="index">
          <p v-if="'text' in block">{{ rt(block.text) }}</p>
          <ul v-else>
            <li v-for="(item, itemIndex) in block.items" :key="itemIndex">{{ rt(item) }}</li>
          </ul>
        </template>
      </section>
    </div>
  </div>
</template>
