<script setup lang="ts">
import { roleKey, type PublishedRole } from '#shared/forms/roles'

// "What happens after you apply", from the role config: on the role page
// (#13) and again once an application is sent (#17), so the two never differ.
const props = defineProps<{ role: PublishedRole }>()
const { t } = useI18n()
const key = computed(() => roleKey(props.role.slug))
</script>

<template>
  <ol class="role-next__steps">
    <li v-for="(id, index) in role.page.next" :key="id">
      <span class="role-next__number" aria-hidden="true">{{ index + 1 }}</span>
      <div>
        <h3 class="role-next__title">{{ t(`${key}.page.next.${id}.title`) }}</h3>
        <p>{{ t(`${key}.page.next.${id}.body`) }}</p>
      </div>
    </li>
  </ol>
</template>
