<script setup lang="ts">
const head = useLocaleHead()
</script>

<template>
  <Html :lang="head.htmlAttrs?.lang">
    <Body>
      <NuxtPage />
    </Body>
  </Html>
</template>
