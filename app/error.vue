<script setup lang="ts">
// The page shown for a missing page (W10, #18), and for any other error. Nuxt
// shows this in place of app.vue, so it sets the site head itself and wraps
// itself in the default layout. A link away clears the error (Nuxt does this
// on any navigation), and a link onto a form page loads a fresh document
// (#20). The say hello link waits for its page, like the header's.
import type { NuxtError } from '#app'
import { hasPage } from '#shared/site-nav'

const props = defineProps<{ error: NuxtError }>()
const { t } = useI18n()

const head = useSiteHead()

const kind = computed(() => (props.error.statusCode === 404 ? 'not_found' : 'failed'))
const sayHello = hasPage('/say-hello')

useHead({ title: () => t(`error_page.${kind.value}.page_title`) })
</script>

<template>
  <Html :lang="head.htmlAttrs?.lang">
    <Body>
      <NuxtLayout name="default">
        <div class="error-page">
          <div class="patch error-page__patch">
            <p class="sticker">{{ t(`error_page.${kind}.sticker`) }}</p>
            <h1>{{ t(`error_page.${kind}.title`) }}</h1>
            <p class="lede">{{ t(`error_page.${kind}.body`) }}</p>
            <div class="error-page__links">
              <NuxtLink to="/" class="button button--primary">{{ t('error_page.home') }}</NuxtLink>
              <NuxtLink v-if="sayHello" to="/say-hello" class="button button--secondary">
                {{ t('site.nav.say_hello') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </NuxtLayout>
    </Body>
  </Html>
</template>
