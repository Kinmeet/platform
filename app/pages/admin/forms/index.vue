<script setup lang="ts">
// Every stored form (ADR-0010, B3, #160): its kind, status, P3 retention and
// who sees what it collects, with a way to make a new one. Behind Cloudflare
// Access. Data is fetched in the browser, so each request carries the
// visitor's own Access session, as on the admin page (#32).
import type { AdminFormSummary } from '#shared/admin'
import type { FormKind } from '#shared/forms/runtime'

const { t } = useI18n()

useHead({
  title: () => t('admin.forms.title'),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const { data, status } = useFetch<{ forms: AdminFormSummary[] }>('/api/admin/forms', {
  server: false,
})
const forms = computed(() => data.value?.forms ?? [])

const slug = ref('')
const kind = ref<FormKind>('form')
const creating = ref(false)
const createError = ref('')
const errorView = ref<HTMLElement | null>(null)

async function create() {
  if (creating.value) return
  creating.value = true
  createError.value = ''
  try {
    const reply = await $fetch<{ ok: true; id: string }>('/api/admin/forms', {
      method: 'POST',
      body: { slug: slug.value.trim(), kind: kind.value },
    })
    await navigateTo(`/admin/forms/${reply.id}`)
  } catch (error) {
    const code = (error as { data?: { error?: string } }).data?.error
    createError.value = t(
      code && ['slug_taken', 'slug_invalid', 'slug_reserved'].includes(code)
        ? `admin.forms.create.errors.${code}`
        : 'admin.actionFailed',
    )
    await nextTick()
    errorView.value?.focus()
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <main class="admin admin--wide">
    <AdminNav />
    <h1>{{ t('admin.forms.title') }}</h1>
    <p>{{ t('admin.forms.lead') }}</p>

    <section aria-labelledby="forms-heading">
      <h2 id="forms-heading">{{ t('admin.forms.list.heading') }}</h2>
      <p v-if="status === 'pending' && !data">{{ t('admin.loading') }}</p>
      <p v-else-if="status === 'error'">{{ t('admin.loadFailed') }}</p>
      <p v-else-if="!forms.length">{{ t('admin.forms.list.empty') }}</p>
      <div v-else class="admin-table">
        <table>
          <caption class="visually-hidden">
            {{
              t('admin.forms.list.caption', forms.length)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.forms.list.form') }}</th>
              <th scope="col">{{ t('admin.forms.list.kind') }}</th>
              <th scope="col">{{ t('admin.forms.list.status') }}</th>
              <th scope="col">{{ t('admin.forms.list.kept') }}</th>
              <th scope="col">{{ t('admin.forms.list.readers') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="form in forms" :key="form.id">
              <th scope="row">
                <NuxtLink :to="`/admin/forms/${form.id}`">{{ form.title ?? form.slug }}</NuxtLink>
                <span class="admin-table__sub">{{ form.slug }}</span>
              </th>
              <td>{{ t(`admin.forms.kind.${form.kind}`) }}</td>
              <td>
                {{ t(`admin.forms.status.${form.status}`) }}
                <span v-if="form.version !== null" class="admin-table__sub">
                  {{ t('admin.forms.list.version', { version: form.version }) }}
                </span>
                <span v-if="form.hasDraft" class="admin-table__sub">
                  {{ t('admin.forms.list.hasDraft') }}
                </span>
              </td>
              <td>{{ keptFor(form.p3Row, form.retentionMonths, t) }}</td>
              <td>{{ readerList(form.readers, t) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="create-heading">
      <h2 id="create-heading">{{ t('admin.forms.create.heading') }}</h2>
      <p>{{ t('admin.forms.create.lead') }}</p>
      <p v-if="createError" ref="errorView" class="admin__alert" tabindex="-1" role="alert">
        {{ createError }}
      </p>
      <form class="admin-form" novalidate @submit.prevent="create">
        <div class="field">
          <label for="new-form-slug">{{ t('admin.forms.create.slug') }}</label>
          <p id="new-form-slug-hint" class="hint">{{ t('admin.forms.create.slugHint') }}</p>
          <input
            id="new-form-slug"
            v-model="slug"
            class="input"
            type="text"
            maxlength="32"
            autocomplete="off"
            spellcheck="false"
            aria-describedby="new-form-slug-hint"
          />
        </div>
        <fieldset>
          <legend>{{ t('admin.forms.create.kind') }}</legend>
          <label class="choice">
            <input v-model="kind" type="radio" name="new-form-kind" value="form" />
            {{ t('admin.forms.kind.form') }}
          </label>
          <label class="choice">
            <input v-model="kind" type="radio" name="new-form-kind" value="application" />
            {{ t('admin.forms.kind.application') }}
          </label>
        </fieldset>
        <button
          type="submit"
          class="button button--primary"
          :aria-disabled="creating ? 'true' : undefined"
        >
          {{ t('admin.forms.create.submit') }}
        </button>
      </form>
    </section>
  </main>
</template>
