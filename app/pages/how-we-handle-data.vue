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

/** The key of a proposed P9 edit, while it's still a draft. */
const draftKey = (key: string) => (te(`privacy.draft.${key}`) ? `privacy.draft.${key}` : undefined)
/** A proposed P9 edit, while it's still a draft. */
const draft = (key: string) => {
  const found = draftKey(key)
  return found ? t(found) : undefined
}
/** P9's own key, or the draft that would replace it. */
const pick = (key: string, draftName?: string) => {
  const found = draftName ? draftKey(draftName) : undefined
  return { key: found ?? key, draft: found !== undefined }
}

const rows = ['hello', 'trustee', 'turnstile'] as const
const rowWhat = (row: (typeof rows)[number]) =>
  (row === 'turnstile' && draft('turnstile_what')) || t(`privacy.why.${row}.what`)

const collected = [
  { item: 'hello', ...pick('privacy.collect.hello') },
  { item: 'trustee', ...pick('privacy.collect.trustee', 'collect_trustee') },
  { item: 'form', ...pick('privacy.collect.form') },
] as const
const keepHello = pick('privacy.keep.hello', 'keep_hello')
const underPrivate = pick('privacy.under_18.private', 'under_18_private')
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
      <section class="patch">
        <h2 id="who-is-responsible">{{ t('privacy.controller.heading') }}</h2>
        <p>{{ t('privacy.controller.not_yet') }}</p>
        <p v-if="address">{{ t('privacy.controller.contact', { address }) }}</p>
        <p>{{ t('privacy.controller.cio') }}</p>
      </section>

      <section class="patch">
        <h2 id="what-we-collect">{{ t('privacy.collect.heading') }}</h2>
        <i18n-t
          v-for="entry in collected"
          :key="entry.item"
          :keypath="entry.key"
          tag="p"
          scope="global"
          :class="{ 'privacy-draft': entry.draft }"
        >
          <template #label>
            <strong>{{ t(`privacy.collect.${entry.item}_label`) }}</strong>
          </template>
        </i18n-t>
        <p v-if="draft('scrambled_ip')" class="privacy-draft">{{ draft('scrambled_ip') }}</p>
      </section>

      <section class="patch">
        <h2 id="what-we-never-collect">{{ t('privacy.never.heading') }}</h2>
        <ul>
          <li v-for="item in neverCollected" :key="item">{{ t(`privacy.never.${item}`) }}</li>
        </ul>
      </section>

      <section class="patch">
        <h2 id="why-we-use-it">{{ t('privacy.why.heading') }}</h2>
        <div class="privacy-table">
          <!-- On a narrow screen the rows stack (privacy.css), which drops
               table semantics in some browsers, so the roles are explicit.
               Each cell repeats its column header from data-label. -->
          <table role="table" aria-labelledby="why-we-use-it">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">{{ t('privacy.why.what') }}</th>
                <th role="columnheader" scope="col">{{ t('privacy.why.why') }}</th>
                <th role="columnheader" scope="col">{{ t('privacy.why.basis') }}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              <tr v-for="row in rows" :key="row" role="row">
                <th role="rowheader" scope="row">{{ rowWhat(row) }}</th>
                <td role="cell" :data-label="t('privacy.why.why')">
                  {{ t(`privacy.why.${row}.why`) }}
                </td>
                <td role="cell" :data-label="t('privacy.why.basis')">
                  {{ t(`privacy.why.${row}.basis`) }}
                </td>
              </tr>
              <!-- The legal reason for a handed-over message is a gap for area
                   5 and the founder (Ezra, #146), so its cell stays empty. -->
              <tr v-if="draft('safety_what')" role="row" class="privacy-draft">
                <th role="rowheader" scope="row">{{ draft('safety_what') }}</th>
                <td role="cell" :data-label="t('privacy.why.why')">{{ draft('safety_why') }}</td>
                <td role="cell" :data-label="t('privacy.why.basis')"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="patch">
        <h2 id="who-else-sees-it">{{ t('privacy.others.heading') }}</h2>
        <i18n-t keypath="privacy.others.body" tag="p" scope="global">
          <template #cloudflare>
            <strong>{{ t('privacy.others.cloudflare') }}</strong>
          </template>
        </i18n-t>
      </section>

      <section class="patch">
        <h2 id="how-long-we-keep-it">{{ t('privacy.keep.heading') }}</h2>
        <ul>
          <li :class="{ 'privacy-draft': keepHello.draft }">{{ t(keepHello.key) }}</li>
          <li>{{ t('privacy.keep.trustee') }}</li>
          <li>{{ t('privacy.keep.trustee_record') }}</li>
          <li v-if="draft('keep_email_log')" class="privacy-draft">
            {{ draft('keep_email_log') }}
          </li>
        </ul>
        <p>{{ t('privacy.keep.automatic') }}</p>
        <p v-if="draft('keep_safety')" class="privacy-draft">{{ draft('keep_safety') }}</p>
        <p v-if="draft('backups')" class="privacy-draft">{{ draft('backups') }}</p>
      </section>

      <section class="patch">
        <h2 id="your-rights">{{ t('privacy.rights.heading') }}</h2>
        <p>{{ t('privacy.rights.ask') }}</p>
        <p v-if="address">{{ t('privacy.rights.email', { address }) }}</p>
        <p>{{ t('privacy.rights.complain') }}</p>
      </section>

      <section class="patch">
        <h2 id="if-you-are-under-18">{{ t('privacy.under_18.heading') }}</h2>
        <p>{{ t('privacy.under_18.rights') }}</p>
        <p :class="{ 'privacy-draft': underPrivate.draft }">{{ t(underPrivate.key) }}</p>
        <p>{{ t('privacy.under_18.danger') }}</p>
      </section>

      <section class="patch">
        <h2 id="changes">{{ t('privacy.changes.heading') }}</h2>
        <p>{{ t('privacy.changes.body') }}</p>
      </section>
    </div>
  </div>
</template>
