<script setup lang="ts">
import { publishedRoles, roleKey } from '#shared/forms/roles'
import { hasPage } from '#shared/site-nav'

// The pre-launch home page (W3, #12). Only published roles are listed (Q3).
// Buttons to pages that aren't built yet stay hidden until their route is
// listed, so the page never shows a dead link (W10).
const { t } = useI18n()

useHead({
  title: () => t('home.title'),
  meta: [{ name: 'description', content: () => t('home.hero.lede') }],
})

const roles = publishedRoles().map((role) => ({
  ...role,
  key: roleKey(role.slug),
  path: `/roles/${role.slug}`,
}))

// The art button points at an artist role, so it waits until one is open.
const artRole = roles.find((role) => role.slug.startsWith('artist-') && hasPage(role.path))
const sayHello = hasPage('/say-hello')
const promise = hasPage('/all-ages-promise')
</script>

<template>
  <div class="home">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="home-hero__text">
        <span class="sticker">{{ t('home.hero.sticker') }}</span>
        <h1 id="home-title" class="home-hero__title">{{ t('home.hero.title') }}</h1>
        <p class="lede">{{ t('home.hero.lede') }}</p>
        <div class="home-hero__actions">
          <a href="#roles" class="button button--primary">{{ t('home.hero.see_roles') }}</a>
          <NuxtLink v-if="sayHello" to="/say-hello" class="button button--secondary">
            {{ t('site.nav.say_hello') }}
          </NuxtLink>
        </div>
      </div>
      <div class="home-hero__art">
        <HeroIllustration />
        <NuxtLink
          v-if="artRole"
          :to="artRole.path"
          class="button button--primary button--small home-hero__art-button"
        >
          {{ t('home.hero.art_button') }}
        </NuxtLink>
      </div>
    </section>

    <section id="roles" class="home-roles" aria-labelledby="roles-title">
      <h2 id="roles-title">{{ t('home.roles.title') }}</h2>
      <p class="muted">{{ t('home.roles.lede') }}</p>
      <ul v-if="roles.length > 0" class="patch role-list">
        <li v-for="role in roles" :key="role.slug" class="role-list__item">
          <div class="role-list__about">
            <h3>{{ t(`${role.key}.title`) }}</h3>
            <p>{{ t(`${role.key}.summary`) }}</p>
          </div>
          <ul class="tag-list">
            <li
              v-for="tag in role.tags"
              :key="tag.id"
              :class="tag.style === 'paid' ? 'tag tag--paid' : 'tag'"
            >
              {{ t(`${role.key}.tags.${tag.id}`) }}
            </li>
          </ul>
          <NuxtLink
            v-if="hasPage(role.path)"
            :to="role.path"
            class="button button--secondary button--small role-list__link"
            :aria-label="t('home.roles.read_more_label', { role: t(`${role.key}.title`) })"
          >
            {{ t('home.roles.read_more') }}
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section class="band home-parents" aria-labelledby="parents-title">
      <div class="home-parents__text">
        <h2 id="parents-title">{{ t('home.parents.title') }}</h2>
        <p>{{ t('home.parents.body') }}</p>
      </div>
      <NuxtLink v-if="promise" to="/all-ages-promise" class="button button--secondary">
        {{ t('home.parents.read_promise') }}
      </NuxtLink>
    </section>
  </div>
</template>
