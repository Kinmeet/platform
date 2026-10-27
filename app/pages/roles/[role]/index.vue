<script setup lang="ts">
import { findRole, roleKey, type PublishedRole } from '#shared/forms/roles'
import { hasPage } from '#shared/site-nav'

// One page per published role (W4, #13). Draft and unknown roles are a 404,
// so a role only gets a page once its content is agreed (Q3).
const { t } = useI18n()
const route = useRoute()

const found = findRole(String(route.params.role))
if (!found?.published) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
const role: PublishedRole = found
const key = roleKey(role.slug)

// Hidden until their pages exist, so nothing here is a dead link (W10).
const applyPath = `/roles/${role.slug}/apply`
const canApply = hasPage(applyPath)
const sayHello = hasPage('/say-hello')

useHead({
  title: () => t(`${key}.title`),
  meta: [{ name: 'description', content: () => t(`${key}.summary`) }],
})
</script>

<template>
  <div class="role-page">
    <section class="role-intro" aria-labelledby="role-title">
      <NuxtLink to="/#roles" class="role-intro__back">
        <span aria-hidden="true">←</span> {{ t('role_page.all_roles') }}
      </NuxtLink>
      <h1 id="role-title">{{ t(`${key}.title`) }}</h1>
      <p class="lede">{{ t(`${key}.summary`) }}</p>
    </section>

    <div class="role-body">
      <aside class="patch role-glance" aria-labelledby="glance-title">
        <h2 id="glance-title">{{ t('role_page.glance') }}</h2>
        <dl class="role-glance__list">
          <div v-for="id in role.page.glance" :key="id">
            <dt>{{ t(`${key}.page.glance.${id}.label`) }}</dt>
            <dd>{{ t(`${key}.page.glance.${id}.value`) }}</dd>
          </div>
        </dl>
        <NuxtLink v-if="canApply" :to="applyPath" class="button button--primary button--block">
          {{ t(`${key}.page.apply`) }}
        </NuxtLink>
        <i18n-t
          v-if="sayHello"
          keypath="role_page.questions"
          tag="p"
          class="role-glance__questions"
          scope="global"
        >
          <template #link>
            <NuxtLink to="/say-hello">{{ t('site.nav.say_hello') }}</NuxtLink>
          </template>
        </i18n-t>
      </aside>

      <div class="role-sections">
        <section v-for="id in role.page.sections" :key="id">
          <h2 :id="`section-${id}`">{{ t(`${key}.page.sections.${id}.heading`) }}</h2>
          <p>{{ t(`${key}.page.sections.${id}.body`) }}</p>
        </section>
      </div>
    </div>

    <WaveDivider tone="sand" />
    <section class="role-next ends-on-sand" aria-labelledby="next-title">
      <h2 id="next-title">{{ t('role_page.next') }}</h2>
      <RoleNextSteps :role="role" />
      <NuxtLink
        v-if="canApply"
        :to="applyPath"
        class="button button--primary button--block role-next__apply"
      >
        {{ t(`${key}.page.apply`) }}
      </NuxtLink>
    </section>
  </div>
</template>
