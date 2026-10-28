<script setup lang="ts">
// The phone progress line and bar (#15). The bar repeats the words, so it is
// hidden from screen readers. Desktop shows ApplySteps instead.
const props = defineProps<{ step: Step; titles: readonly string[] }>()
const { t } = useI18n()
const title = computed(() => props.titles[props.step - 1] ?? '')
</script>

<template>
  <div class="apply-progress">
    <p class="apply-progress__label">
      {{ t('apply.progress', { step, count: titles.length, title }) }}
    </p>
    <div class="apply-progress__bar" aria-hidden="true">
      <span
        v-for="(_, index) in titles"
        :key="index"
        :class="[
          'apply-progress__segment',
          {
            'apply-progress__segment--done': index + 1 < step,
            'apply-progress__segment--current': index + 1 === step,
          },
        ]"
      />
    </div>
  </div>
</template>
