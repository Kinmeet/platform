<script setup lang="ts">
// The links between the admin pages (#160). The current page is marked with
// aria-current, so screen readers say where they are.
const { t } = useI18n()
const route = useRoute()
const links = [
  { to: '/admin', key: 'admin.nav.inbox' },
  { to: '/admin/forms', key: 'admin.nav.forms' },
]
const current = (to: string) =>
  to === '/admin' ? route.path === '/admin' : route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <nav class="admin-nav" :aria-label="t('admin.nav.label')">
    <ul>
      <li v-for="link in links" :key="link.to">
        <NuxtLink :to="link.to" :aria-current="current(link.to) ? 'page' : undefined">
          {{ t(link.key) }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
