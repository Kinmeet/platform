<script setup lang="ts">
// The desktop list of steps (#15), with the current one marked for screen
// readers (`aria-current="step"`) and in words, not only by colour.
defineProps<{ step: Step }>()
const { t } = useI18n()
</script>

<template>
  <!-- A labelled list rather than a nav: the steps aren't links (Robin, #81). -->
  <div class="apply-steps">
    <ol class="apply-steps__list" :aria-label="t('apply.steps_label')">
      <li
        v-for="n in STEPS"
        :key="n"
        :class="[
          'apply-steps__item',
          { 'apply-steps__item--done': n < step, 'apply-steps__item--current': n === step },
        ]"
        :aria-current="n === step ? 'step' : undefined"
      >
        <span class="apply-steps__number" aria-hidden="true">{{ n }}</span>
        <span class="apply-steps__text">
          <span class="apply-steps__title">{{ t(`apply.steps.${n}`) }}</span>
          <span class="apply-steps__status muted small">
            {{ t(`apply.step_status.${n < step ? 'done' : n === step ? 'current' : 'todo'}`) }}
          </span>
        </span>
      </li>
    </ol>
  </div>
</template>
