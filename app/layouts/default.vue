<template>
  <div class="site">
    <SkipLink />
    <SiteHeader />
    <main id="main" class="site__main" tabindex="-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
