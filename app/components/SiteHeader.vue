<script setup lang="ts">
import { linkHref, liveLinks, mainNav } from '#shared/site-nav'

const { t } = useI18n()
const links = liveLinks(mainNav)
</script>

<template>
  <header class="site-header">
    <NuxtLink to="/" class="site-header__home">
      <SiteWordmark />
    </NuxtLink>
    <nav v-if="links.length > 0" class="site-nav" :aria-label="t('site.nav.main_label')">
      <NuxtLink
        v-for="link in links"
        :key="link.id"
        :to="linkHref(link)"
        :class="
          link.id === 'say_hello' ? 'button button--secondary button--small' : 'site-nav__link'
        "
      >
        {{ t(`site.nav.${link.id}`) }}
      </NuxtLink>
    </nav>
  </header>
</template>
