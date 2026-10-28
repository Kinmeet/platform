// The title pattern and the locale head (#11). Both app.vue and error.vue use
// this, because Nuxt shows error.vue in place of app.vue, so a missing page
// still gets "Page – Kinmeet" and the page language.
export function useSiteHead() {
  const { t } = useI18n()
  useHead({
    titleTemplate: (page) =>
      page ? t('site.title_pattern', { page, site: t('site.name') }) : t('site.name'),
  })
  return useLocaleHead()
}
