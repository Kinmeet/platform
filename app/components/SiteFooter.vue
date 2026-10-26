<script setup lang="ts">
import { footerNav, linkHref, liveLinks } from '#shared/site-nav'

const { t } = useI18n()
const links = liveLinks(footerNav)
</script>

<template>
  <div class="site-footer-wrap">
    <WaveDivider tone="green" />
    <footer class="site-footer on-dark">
      <div class="site-footer__about">
        <SiteWordmark />
        <p>{{ t('site.footer.tagline') }}</p>
        <p class="small">{{ t('site.footer.no_tracking') }}</p>
        <i18n-t keypath="site.footer.fonts" tag="p" class="small" scope="global">
          <template #fredoka>
            <a href="/fonts/Fredoka-OFL.txt">{{ t('site.footer.fonts_fredoka') }}</a>
          </template>
          <template #atkinson>
            <a href="/fonts/AtkinsonHyperlegibleNext-OFL.txt">{{
              t('site.footer.fonts_atkinson')
            }}</a>
          </template>
        </i18n-t>
      </div>
      <nav
        v-if="links.length > 0"
        class="site-footer__nav"
        :aria-label="t('site.nav.footer_label')"
      >
        <NuxtLink v-for="link in links" :key="link.id" :to="linkHref(link)">
          {{ t(`site.nav.${link.id}`) }}
        </NuxtLink>
      </nav>
    </footer>
  </div>
</template>
