<script setup lang="ts">
import { accessibilityPage } from '#shared/pages/accessibility'

// The accessibility statement (#145), in P11's own words. It's a 404 until
// the founder's M1 review publishes it. Until then, P11's gaps are left out
// rather than filled in: the date at the top, the known problems and the
// address people write to.
const { t } = useI18n()

if (!accessibilityPage.published) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const lastReviewed = accessibilityPage.lastReviewed
  ? dateFormat.format(new Date(`${accessibilityPage.lastReviewed}T00:00:00Z`))
  : undefined
const address = accessibilityPage.address ?? undefined
const known = t('accessibility.known.body')

const aims = ['keyboard', 'zoom', 'screen_reader', 'motion', 'plain_english'] as const

useHead({
  title: () => t('accessibility.page_title'),
  meta: [{ name: 'description', content: () => t('accessibility.intro') }],
})
</script>

<template>
  <div class="statement-page">
    <div class="statement-intro">
      <h1>{{ t('accessibility.title') }}</h1>
      <p v-if="lastReviewed" class="muted">
        <em>{{ t('accessibility.last_reviewed', { date: lastReviewed }) }}</em>
      </p>
      <p class="lede">{{ t('accessibility.intro') }}</p>
    </div>

    <div class="statement-sections">
      <section class="patch">
        <h2 id="what-we-aim-for">{{ t('accessibility.aim.heading') }}</h2>
        <p>{{ t('accessibility.aim.body') }}</p>
        <ul>
          <li v-for="aim in aims" :key="aim">{{ t(`accessibility.aim.${aim}`) }}</li>
        </ul>
      </section>

      <section v-if="known" class="patch">
        <h2 id="what-we-know-is-not-right-yet">{{ t('accessibility.known.heading') }}</h2>
        <p>{{ known }}</p>
      </section>

      <section class="patch">
        <h2 id="telling-us-about-a-problem">{{ t('accessibility.report.heading') }}</h2>
        <p v-if="address">{{ t('accessibility.report.email', { address }) }}</p>
        <p>{{ t('accessibility.report.then') }}</p>
      </section>

      <section v-if="address" class="patch">
        <h2 id="meets">{{ t('accessibility.meets.heading') }}</h2>
        <p>{{ t('accessibility.meets.body', { address }) }}</p>
      </section>

      <section class="patch">
        <h2 id="how-we-test">{{ t('accessibility.test.heading') }}</h2>
        <p>{{ t('accessibility.test.body') }}</p>
      </section>
    </div>
  </div>
</template>
