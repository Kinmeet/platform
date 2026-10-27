<script setup lang="ts">
// The box at the top of a form that failed its checks (#15). The form calls
// focus() after rendering it, and each link moves focus to its field rather
// than only scrolling, so keyboard and screen-reader users land on it.
defineProps<{ items: ErrorSummaryItem[] }>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)

function goToField(target: string) {
  const field = document.getElementById(target)
  field?.focus()
  field?.scrollIntoView({ block: 'center' })
}

defineExpose({ focus: () => root.value?.focus() })
</script>

<template>
  <div ref="root" class="error-summary" tabindex="-1" aria-labelledby="error-summary-title">
    <h2 id="error-summary-title">{{ t('apply.errors.summary', items.length) }}</h2>
    <ul>
      <li v-for="item in items" :key="item.target">
        <a :href="`#${item.target}`" @click.prevent="goToField(item.target)">{{ item.text }}</a>
      </li>
    </ul>
  </div>
</template>
