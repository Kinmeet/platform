import { describe, expect, it } from 'vitest'
import en from '../../../i18n/locales/en-GB.json'
import { publicRoutes } from '../../../shared/routes'
import { footerNav, linkHref, liveLinks, mainNav } from '../../../shared/site-nav'

const all = [...mainNav, ...footerNav]

describe('site nav', () => {
  it('has wording for every link', () => {
    const nav: Record<string, string> = en.site.nav
    for (const link of all) expect(nav[link.id], link.id).toBeTruthy()
  })

  it('leaves out links to pages that are not built yet', () => {
    const routes = [{ path: '/', form: false }]
    expect(liveLinks(footerNav, routes).map((link) => link.id)).toEqual(['roles'])
  })

  it('shows a link once its page is listed', () => {
    const routes = [
      { path: '/', form: false },
      { path: '/say-hello', form: true },
    ]
    expect(liveLinks(mainNav, routes).map((link) => link.id)).toEqual(['roles', 'say_hello'])
  })

  it('only shows links to listed routes by default', () => {
    for (const link of [...liveLinks(mainNav), ...liveLinks(footerNav)]) {
      expect(publicRoutes.some((route) => route.path === link.path)).toBe(true)
    }
  })

  it('builds hrefs with the section', () => {
    expect(linkHref({ id: 'roles', path: '/', hash: 'roles' })).toBe('/#roles')
    expect(linkHref({ id: 'say_hello', path: '/say-hello' })).toBe('/say-hello')
  })
})

describe('site wording', () => {
  it('puts the site name after each page title', () => {
    expect(en.site.title_pattern).toContain('{page}')
    expect(en.site.title_pattern).toContain('{site}')
  })

  it('names both font licences in one sentence', () => {
    expect(en.site.footer.fonts).toContain('{fredoka}')
    expect(en.site.footer.fonts).toContain('{atkinson}')
  })
})
