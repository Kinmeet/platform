<script setup lang="ts">
// The wavy edge above the footer and the sand sections (#11, #13).
defineProps<{ tone: 'green' | 'sand' }>()
</script>

<template>
  <svg
    :class="['wave', `wave--${tone}`]"
    viewBox="0 0 1440 40"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M0 22 C120 40 240 4 360 20 S600 40 720 22 S960 2 1080 20 S1320 40 1440 22 V40 H0 Z" />
  </svg>
</template>
