<script setup lang="ts">
// The desktop list of steps (#15), with the current one marked for screen
// readers (`aria-current="step"`) and in words, not only by colour.
defineProps<{ step: Step; titles: readonly string[] }>()
const { t } = useI18n()
</script>

<template>
  <!-- A labelled list rather than a nav: the steps aren't links (Robin, #81). -->
  <div class="apply-steps">
    <ol class="apply-steps__list" :aria-label="t('apply.steps_label')">
      <li
        v-for="(title, index) in titles"
        :key="index"
        :class="[
          'apply-steps__item',
          {
            'apply-steps__item--done': index + 1 < step,
            'apply-steps__item--current': index + 1 === step,
          },
        ]"
        :aria-current="index + 1 === step ? 'step' : undefined"
      >
        <span class="apply-steps__number" aria-hidden="true">{{ index + 1 }}</span>
        <span class="apply-steps__text">
          <span class="apply-steps__title">{{ title }}</span>
          <span class="apply-steps__status muted small">
            {{
              t(
                `apply.step_status.${index + 1 < step ? 'done' : index + 1 === step ? 'current' : 'todo'}`,
              )
            }}
          </span>
        </span>
      </li>
    </ol>
  </div>
</template>
