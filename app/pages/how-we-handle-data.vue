<script setup lang="ts">
import { privacyPage } from '#shared/pages/privacy'

// The privacy notice (#144), in P9's own words. It's a 404 until the
// founder's M1 review publishes it. Until then, P9's gaps are left out rather
// than filled in: the contact address, the date at the top, and anything P9
// marks in square brackets. Proposed P9 edits sit under `privacy.draft` and
// show in place, so the review reads them where they'd go.
const { t, te } = useI18n()

if (!privacyPage.published) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const lastUpdated = privacyPage.lastUpdated
  ? dateFormat.format(new Date(`${privacyPage.lastUpdated}T00:00:00Z`))
  : undefined
const address = privacyPage.address ?? undefined

/** A proposed P9 edit, while it's still a draft. */
const draft = (key: 'scrambled_ip' | 'turnstile_what' | 'backups') =>
  te(`privacy.draft.${key}`) ? t(`privacy.draft.${key}`) : undefined

const rows = ['hello', 'trustee', 'turnstile'] as const
const rowWhat = (row: (typeof rows)[number]) =>
  (row === 'turnstile' && draft('turnstile_what')) || t(`privacy.why.${row}.what`)

const collected = ['hello', 'trustee', 'form'] as const
const neverCollected = ['analytics', 'cookies', 'ip', 'other_sites'] as const

useHead({
  title: () => t('privacy.page_title'),
  meta: [{ name: 'description', content: () => t('privacy.intro') }],
})
</script>

<template>
  <div class="privacy-page">
    <div class="privacy-intro">
      <h1>{{ t('privacy.title') }}</h1>
      <p v-if="lastUpdated" class="muted">
        <em>{{ t('privacy.last_updated', { date: lastUpdated }) }}</em>
      </p>
      <p class="lede">{{ t('privacy.intro') }}</p>
    </div>

    <div class="privacy-sections">
      <section class="patch" aria-labelledby="who-is-responsible">
        <h2 id="who-is-responsible">{{ t('privacy.controller.heading') }}</h2>
        <p>{{ t('privacy.controller.not_yet') }}</p>
        <p v-if="address">{{ t('privacy.controller.contact', { address }) }}</p>
        <p>{{ t('privacy.controller.cio') }}</p>
      </section>

      <section class="patch" aria-labelledby="what-we-collect">
        <h2 id="what-we-collect">{{ t('privacy.collect.heading') }}</h2>
        <i18n-t
          v-for="item in collected"
          :key="item"
          :keypath="`privacy.collect.${item}`"
          tag="p"
          scope="global"
        >
          <template #label>
            <strong>{{ t(`privacy.collect.${item}_label`) }}</strong>
          </template>
        </i18n-t>
        <p v-if="draft('scrambled_ip')" class="privacy-draft">{{ draft('scrambled_ip') }}</p>
      </section>

      <section class="patch" aria-labelledby="what-we-never-collect">
        <h2 id="what-we-never-collect">{{ t('privacy.never.heading') }}</h2>
        <ul>
          <li v-for="item in neverCollected" :key="item">{{ t(`privacy.never.${item}`) }}</li>
        </ul>
      </section>

      <section class="patch" aria-labelledby="why-we-use-it">
        <h2 id="why-we-use-it">{{ t('privacy.why.heading') }}</h2>
        <div class="privacy-table">
          <table aria-labelledby="why-we-use-it">
            <thead>
              <tr>
                <th scope="col">{{ t('privacy.why.what') }}</th>
                <th scope="col">{{ t('privacy.why.why') }}</th>
                <th scope="col">{{ t('privacy.why.basis') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row">
                <th scope="row">{{ rowWhat(row) }}</th>
                <td>{{ t(`privacy.why.${row}.why`) }}</td>
                <td>{{ t(`privacy.why.${row}.basis`) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="patch" aria-labelledby="who-else-sees-it">
        <h2 id="who-else-sees-it">{{ t('privacy.others.heading') }}</h2>
        <i18n-t keypath="privacy.others.body" tag="p" scope="global">
          <template #cloudflare>
            <strong>{{ t('privacy.others.cloudflare') }}</strong>
          </template>
        </i18n-t>
      </section>

      <section class="patch" aria-labelledby="how-long-we-keep-it">
        <h2 id="how-long-we-keep-it">{{ t('privacy.keep.heading') }}</h2>
        <ul>
          <li>{{ t('privacy.keep.hello') }}</li>
          <li>{{ t('privacy.keep.trustee') }}</li>
          <li>{{ t('privacy.keep.trustee_record') }}</li>
        </ul>
        <p>{{ t('privacy.keep.automatic') }}</p>
        <p v-if="draft('backups')" class="privacy-draft">{{ draft('backups') }}</p>
      </section>

      <section class="patch" aria-labelledby="your-rights">
        <h2 id="your-rights">{{ t('privacy.rights.heading') }}</h2>
        <p>{{ t('privacy.rights.ask') }}</p>
        <p v-if="address">{{ t('privacy.rights.email', { address }) }}</p>
        <p>{{ t('privacy.rights.complain') }}</p>
      </section>

      <section class="patch" aria-labelledby="if-you-are-under-18">
        <h2 id="if-you-are-under-18">{{ t('privacy.under_18.heading') }}</h2>
        <p>{{ t('privacy.under_18.rights') }}</p>
        <p>{{ t('privacy.under_18.private') }}</p>
      </section>

      <section class="patch" aria-labelledby="changes">
        <h2 id="changes">{{ t('privacy.changes.heading') }}</h2>
        <p>{{ t('privacy.changes.body') }}</p>
      </section>
    </div>
  </div>
</template>
