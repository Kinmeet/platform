<script setup lang="ts">
// The phone progress line and bar (#15). The bar repeats the words, so it is
// hidden from screen readers. Desktop shows ApplySteps instead.
defineProps<{ step: Step }>()
const { t } = useI18n()
</script>

<template>
  <div class="apply-progress">
    <p class="apply-progress__label">
      {{ t('apply.progress', { step, title: t(`apply.steps.${step}`) }) }}
    </p>
    <div class="apply-progress__bar" aria-hidden="true">
      <span
        v-for="n in STEPS"
        :key="n"
        :class="[
          'apply-progress__segment',
          {
            'apply-progress__segment--done': n < step,
            'apply-progress__segment--current': n === step,
          },
        ]"
      />
    </div>
  </div>
</template>
