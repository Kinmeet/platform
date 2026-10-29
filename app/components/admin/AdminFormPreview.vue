<script setup lang="ts">
// The builder's preview (ADR-0010, B3, #160): the draft exactly as the
// server would give it to the form's page (`GET .../check`), drawn with the
// public field renderer, FormField, so what an admin sees is what a visitor
// gets. Every page of the flow is shown one after another. Nothing typed
// here is sent or stored: there is no form element and no spam check, and
// answers live in this component only.
import type { PublicForm } from '#shared/forms/view'
import { fieldPath, flowSteps, shownFieldIds } from '#shared/forms/view'

const props = defineProps<{ form: PublicForm }>()
const { t } = useI18n()

// Narrows the preview to a phone's width, so the stacked layout can be seen (canvas, B9).
const narrow = ref(false)
const values = ref<Record<string, string>>({})
const callName = ref('')
const email = ref('')
// A new preview starts empty, so an old answer never shows against a new question.
watch(
  () => props.form,
  () => {
    values.value = {}
  },
)

const shown = computed(() => shownFieldIds(props.form.definition, values.value))
const pages = computed(() =>
  props.form.kind === 'form'
    ? [{ kind: 'single' as const }]
    : flowSteps(props.form.definition).map((flow) => ({ kind: 'flow' as const, flow })),
)
const count = computed(() => pages.value.length)
const title = (flow: Parameters<typeof stepTitle>[1]) => stepTitle(props.form, flow, t)

/** Whether a choice can reveal another question on its own step (Robin, #158). */
function revealsMore(id: string): boolean {
  return props.form.definition.steps.some(
    (each) =>
      each.fields.some((field) => field.id === id) &&
      each.fields.some((field) => field.showIf?.field === id),
  )
}
// The preview's fields get their own ids, so they never clash with the builder's.
const previewPath = (path: string) => `preview.${path}`
</script>

<template>
  <button
    type="button"
    class="button button--small button--secondary admin-preview__width"
    :aria-pressed="narrow ? 'true' : 'false'"
    @click="narrow = !narrow"
  >
    {{ t('admin.forms.preview.narrow') }}
  </button>
  <div class="admin-preview" :class="{ 'admin-preview--narrow': narrow }">
    <template v-for="(page, index) in pages" :key="index">
      <div class="admin-preview__page">
        <p v-if="count > 1" class="eyebrow">
          {{ t('admin.forms.preview.page', { page: index + 1, count }) }}
        </p>
        <template v-if="page.kind === 'single'">
          <h3 :id="`preview-page-${index + 1}`">{{ form.text.title }}</h3>
          <p v-if="form.text.intro" class="lede">{{ form.text.intro }}</p>
          <template v-for="(step, s) in form.definition.steps" :key="step.id">
            <template v-if="s === form.definition.aboutYou">
              <FormTextField
                :id="fieldId('preview.callName')"
                v-model="callName"
                :label="t('hello.callName.label')"
                :hint="t('hello.callName.hint')"
                autocomplete="off"
              />
              <FormTextField
                :id="fieldId('preview.email')"
                v-model="email"
                type="email"
                :label="t('hello.email.label')"
                :hint="t('hello.email.hint')"
                autocomplete="off"
              />
            </template>
            <template v-for="field in step.fields" :key="field.id">
              <FormField
                v-if="shown.has(field.id)"
                v-model="values[field.id]"
                :field="field"
                :text="form.text"
                :path="previewPath(fieldPath(step, field))"
                :reveals-more="revealsMore(field.id)"
              />
            </template>
          </template>
        </template>
        <template v-else>
          <h3 :id="`preview-page-${index + 1}`">{{ title(page.flow) }}</h3>
          <p v-if="index === 0 && form.text.intro">{{ form.text.intro }}</p>
          <template v-if="page.flow.kind === 'fields'">
            <template v-for="field in page.flow.step.fields" :key="field.id">
              <FormField
                v-if="shown.has(field.id)"
                v-model="values[field.id]"
                :field="field"
                :text="form.text"
                :path="previewPath(fieldPath(page.flow.step, field))"
                :reveals-more="revealsMore(field.id)"
              />
            </template>
            <div v-if="form.definition.note && index === 0" class="note">
              <p class="apply__note-title">{{ form.text['note.heading'] }}</p>
              <p>{{ form.text['note.body'] }}</p>
            </div>
          </template>
          <template v-else-if="page.flow.kind === 'about_you'">
            <FormTextField
              :id="fieldId('preview.callName')"
              v-model="callName"
              :label="t('apply.about_you.callName.label')"
              :hint="t('apply.about_you.callName.hint')"
              autocomplete="off"
            />
            <FormTextField
              :id="fieldId('preview.email')"
              v-model="email"
              type="email"
              :label="t('apply.about_you.email.label')"
              :hint="t('apply.about_you.email.hint')"
              autocomplete="off"
            />
          </template>
          <p v-else>{{ t('admin.forms.preview.check') }}</p>
        </template>
        <FormSafetyNote v-if="index === count - 1" :form="form" />
      </div>
    </template>
  </div>
</template>
