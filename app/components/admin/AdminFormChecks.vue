<script setup lang="ts">
// What publishing the draft would find (ADR-0010, B3, #160). Problems come
// from the server as codes and paths only, so every word here is our fixed
// text. Each problem names the question or setting it is about and, where
// the builder page has one, links to the thing to fix. A code we have no
// words for yet is shown as itself, so a problem is never hidden.
import type { AdminFormCheck } from '#shared/admin'
import type { FormDefinition } from '#shared/forms/definition'

const props = defineProps<{
  check: AdminFormCheck
  definition: FormDefinition
  text: Readonly<Record<string, string>>
  /** Whether the problems link to the builder's inputs, which only the builder page has. */
  linked?: boolean
  /** Where each link goes when not on the builder, such as the builder page itself. */
  builderPath?: string
}>()

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)

/** The question or setting a path is about, in words, or `undefined` for the form as a whole. */
function where(path: string): string | undefined {
  const key = /^text\.en-GB\.(.+)$/.exec(path)?.[1]
  const fieldFromKey = key ? /^fields\.([^.]+)\./.exec(key)?.[1] : undefined
  const indexed = /^definition\.steps\.(\d+)\.fields\.(\d+)/.exec(path)
  const named = /^definition\.fields\.([^.]+)/.exec(path)?.[1]
  const fieldId =
    fieldFromKey ??
    named ??
    (indexed
      ? props.definition.steps[Number(indexed[1])]?.fields[Number(indexed[2])]?.id
      : undefined)
  if (fieldId) {
    const label = props.text[`fields.${fieldId}.label`]?.trim()
    return label
      ? t('admin.forms.checks.where.question', { label })
      : t('admin.forms.checks.where.untitled', { id: fieldId })
  }
  if (key === 'title' || key === 'intro') return t(`admin.forms.checks.where.${key}`)
  if (key?.startsWith('note.')) return t('admin.forms.checks.where.note')
  const stepKey = key ? /^steps\.([^.]+)\.heading$/.exec(key)?.[1] : undefined
  const stepIndex = stepKey
    ? props.definition.steps.findIndex((step) => step.id === stepKey)
    : Number(/^definition\.steps\.(\d+)/.exec(path)?.[1] ?? -1)
  if (stepIndex >= 0) return t('admin.forms.checks.where.step', { step: stepIndex + 1 })
  if (path === 'purpose' || path === 'definition' || path.startsWith('definition.')) {
    return t('admin.forms.checks.where.settings')
  }
  return undefined
}

function message(code: string): string {
  return knownProblems.has(code)
    ? t(`admin.forms.problems.${code}`)
    : t('admin.forms.problems.unknown', { code })
}

const items = computed(() =>
  props.check.problems.map((problem, index) => {
    const place = where(problem.path)
    const words = message(problem.code)
    return {
      key: `${index}-${problem.code}-${problem.path}`,
      target: problemTarget(props.definition, problem.path),
      text: place ? t('admin.forms.checks.item', { where: place, message: words }) : words,
    }
  }),
)

function goTo(target: string) {
  const element = document.getElementById(target)
  element?.focus()
  element?.scrollIntoView({ block: 'center' })
}

defineExpose({ focus: () => root.value?.focus() })
</script>

<template>
  <div ref="root" class="admin-checks" tabindex="-1" aria-labelledby="checks-result">
    <p id="checks-result" class="admin-checks__result">
      {{
        check.ok
          ? t('admin.forms.checks.ready')
          : t('admin.forms.checks.toFix', check.problems.length)
      }}
    </p>
    <ul v-if="items.length">
      <li v-for="item in items" :key="item.key">
        <a v-if="linked" :href="`#${item.target}`" @click.prevent="goTo(item.target)">
          {{ item.text }}
        </a>
        <NuxtLink v-else-if="builderPath" :to="`${builderPath}#${item.target}`">
          {{ item.text }}
        </NuxtLink>
        <template v-else>{{ item.text }}</template>
      </li>
    </ul>
    <p v-if="check.needsSecondApproval" class="admin-checks__second">
      {{ t('admin.forms.checks.secondApproval') }}
    </p>
  </div>
</template>
