<script setup lang="ts">
// "Pass to safeguarding" for one message or application on the admin page
// (#36). One confirmation, which reminds the reader of SG-03 section 4: 999
// first if anyone is in immediate danger, nothing copied or forwarded, and
// tell the safeguarding lead afterwards. There is deliberately no copy,
// export or forward control here.
const props = defineProps<{ name: string; busy: boolean }>()
const emit = defineEmits<{ confirm: [] }>()

const { t } = useI18n()
const id = useId()
const open = ref(false)
const opener = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

async function show() {
  if (props.busy) return
  open.value = true
  await nextTick()
  panel.value?.focus()
}

async function cancel() {
  open.value = false
  await nextTick()
  opener.value?.focus()
}

function confirm() {
  if (props.busy) return
  emit('confirm')
}
</script>

<template>
  <div class="pass">
    <button
      v-if="!open"
      ref="opener"
      type="button"
      class="pass__open"
      :aria-disabled="busy ? 'true' : undefined"
      @click="show"
    >
      {{ t('admin.safeguarding.pass') }}
      <span class="visually-hidden">{{ t('admin.forName', { name }) }}</span>
    </button>
    <div
      v-else
      ref="panel"
      class="pass__panel"
      role="group"
      tabindex="-1"
      :aria-labelledby="`${id}-heading`"
    >
      <p :id="`${id}-heading`" class="pass__heading">
        {{ t('admin.safeguarding.confirmHeading') }}
      </p>
      <p class="pass__urgent">{{ t('admin.safeguarding.immediateDanger') }}</p>
      <p>{{ t('admin.safeguarding.whatHappens') }}</p>
      <p>{{ t('admin.safeguarding.doNotCopy') }}</p>
      <p>{{ t('admin.safeguarding.tellLead') }}</p>
      <div class="pass__actions">
        <button type="button" :aria-disabled="busy ? 'true' : undefined" @click="confirm">
          {{ t('admin.safeguarding.confirm') }}
          <span class="visually-hidden">{{ t('admin.forName', { name }) }}</span>
        </button>
        <button type="button" class="pass__cancel" @click="cancel">
          {{ t('admin.safeguarding.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pass {
  margin-top: 0.75rem;
}

.pass__panel {
  border: 2px solid var(--colour-ink);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
}

.pass__panel:focus-visible {
  outline: 3px solid var(--colour-ink);
  outline-offset: 2px;
}

.pass__heading,
.pass__urgent {
  font-weight: 700;
}

.pass__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pass .pass__cancel {
  background: var(--colour-ground);
  color: var(--colour-ink);
}
</style>
