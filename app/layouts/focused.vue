<script setup lang="ts">
import { findRole } from '#shared/forms/roles'

// The apply flow's layout: the wordmark and a way out, nothing else to
// distract from the form (W2, W6). Leave goes back to the role's page if
// that role is published, otherwise to the home page.
const { t } = useI18n()
const route = useRoute()
const leaveTo = computed(() => {
  const slug = route.params.role
  const role = typeof slug === 'string' ? findRole(slug) : undefined
  return role?.published ? `/roles/${role.slug}` : '/'
})
</script>

<template>
  <div class="site">
    <SkipLink />
    <header class="site-header">
      <SiteWordmark />
      <NuxtLink :to="leaveTo" class="site-header__leave">
        {{ t('site.leave') }}
      </NuxtLink>
    </header>
    <main id="main" class="site__main site__main--focused" tabindex="-1">
      <slot />
    </main>
  </div>
</template>
