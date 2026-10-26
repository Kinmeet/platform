<script setup lang="ts">
// Placeholder picnic scene until the illustration artist role is filled (#12).
const { t } = useI18n()
</script>

<template>
  <svg
    class="hero-art__svg"
    viewBox="0 0 600 420"
    preserveAspectRatio="xMidYMid slice"
    role="img"
    :aria-label="t('home.hero.art_label')"
  >
    <rect width="600" height="420" fill="#8FBF88" />
    <circle cx="80" cy="60" r="70" fill="#9ECB96" />
    <circle cx="540" cy="360" r="90" fill="#9ECB96" />
    <circle cx="500" cy="70" r="40" fill="#9ECB96" />
    <path
      d="M0 300 Q60 280 120 300 T240 300"
      stroke="#2E5D4B"
      stroke-width="5"
      fill="none"
      stroke-linecap="round"
      opacity="0.5"
    />
    <path
      d="M380 120 Q440 100 500 120 T620 120"
      stroke="#2E5D4B"
      stroke-width="5"
      fill="none"
      stroke-linecap="round"
      opacity="0.5"
    />
    <rect
      x="150"
      y="150"
      width="120"
      height="90"
      rx="14"
      fill="#E8A13D"
      stroke="#3B3630"
      stroke-width="4"
      transform="rotate(-8 210 195)"
    />
    <rect
      x="330"
      y="140"
      width="120"
      height="90"
      rx="14"
      fill="#F7F3E8"
      stroke="#3B3630"
      stroke-width="4"
      transform="rotate(6 390 185)"
    />
    <rect
      x="240"
      y="260"
      width="130"
      height="90"
      rx="14"
      fill="#FFFFFF"
      stroke="#3B3630"
      stroke-width="4"
      transform="rotate(-3 305 305)"
    />
    <path
      d="M170 170h80M170 190h80M170 210h80"
      stroke="#3B3630"
      stroke-width="3"
      opacity="0.35"
      transform="rotate(-8 210 195)"
    />
    <circle cx="300" cy="200" r="22" fill="#2E5D4B" />
    <circle cx="300" cy="200" r="10" fill="#E8A13D" />
    <g transform="translate(120 250) scale(1.0)">
      <path
        d="M0 6 C-22 4 -22 26 -8.8 22"
        stroke="#3B3630"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <circle cx="-11" cy="-12" r="6" fill="#3B3630" />
      <circle cx="11" cy="-12" r="6" fill="#3B3630" />
      <circle cx="0" cy="0" r="16" fill="#3B3630" />
    </g>
    <g transform="translate(215 110) scale(0.9)">
      <path
        d="M0 6 C22 4 22 26 8.8 22"
        stroke="#2E5D4B"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <circle cx="-11" cy="-12" r="6" fill="#2E5D4B" />
      <circle cx="11" cy="-12" r="6" fill="#2E5D4B" />
      <circle cx="0" cy="0" r="16" fill="#2E5D4B" />
    </g>
    <g transform="translate(470 250) scale(1.05)">
      <path
        d="M0 6 C22 4 22 26 8.8 22"
        stroke="#3B3630"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <circle cx="-11" cy="-12" r="6" fill="#3B3630" />
      <circle cx="11" cy="-12" r="6" fill="#3B3630" />
      <circle cx="0" cy="0" r="16" fill="#3B3630" />
    </g>
    <g transform="translate(380 330) scale(0.85)">
      <path
        d="M0 6 C-22 4 -22 26 -8.8 22"
        stroke="#2E5D4B"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <circle cx="-11" cy="-12" r="6" fill="#2E5D4B" />
      <circle cx="11" cy="-12" r="6" fill="#2E5D4B" />
      <circle cx="0" cy="0" r="16" fill="#2E5D4B" />
    </g>
    <g transform="translate(140 350) scale(0.8)">
      <path
        d="M0 6 C22 4 22 26 8.8 22"
        stroke="#E8A13D"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <circle cx="-11" cy="-12" r="6" fill="#E8A13D" />
      <circle cx="11" cy="-12" r="6" fill="#E8A13D" />
      <circle cx="0" cy="0" r="16" fill="#E8A13D" />
    </g>
    <path
      d="M520 90 l40 -30"
      stroke="#3B3630"
      stroke-width="5"
      stroke-linecap="round"
      stroke-dasharray="1 12"
    />
  </svg>
</template>
