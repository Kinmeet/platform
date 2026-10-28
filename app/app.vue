<script setup lang="ts">
// Each page sets its own title; the site name goes after it (#11).
const head = useSiteHead()
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
