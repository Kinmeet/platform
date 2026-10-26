<script setup lang="ts">
const { t } = useI18n()
const head = useLocaleHead()

// Each page sets its own title; the site name goes after it (#11).
useHead({
  titleTemplate: (page) =>
    page ? t('site.title_pattern', { page, site: t('site.name') }) : t('site.name'),
})
</script>

<template>
  <Html :lang="head.htmlAttrs?.lang">
    <Body>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </Body>
  </Html>
</template>
