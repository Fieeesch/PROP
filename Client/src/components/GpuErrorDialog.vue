<script setup lang="ts">
import { AlertTriangle, RefreshCw } from '@lucide/vue';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{
  title: string;
  message: string;
}>();

const emit = defineEmits<{
  reload: [];
}>();

const backdrop = ref<HTMLElement | null>(null);
const reloadButton = ref<HTMLButtonElement | null>(null);
const backgroundInertStates = new Map<HTMLElement, boolean>();

onMounted(async () => {
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement) || element === backdrop.value) continue;
    backgroundInertStates.set(element, element.inert);
    element.inert = true;
  }

  await nextTick();
  reloadButton.value?.focus();
});

onBeforeUnmount(() => {
  for (const [element, wasInert] of backgroundInertStates) {
    element.inert = wasInert;
  }
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    reloadButton.value?.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="backdrop"
      class="gpu-error-backdrop"
      role="presentation"
      @keydown="handleKeydown"
    >
      <section
        class="gpu-error-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gpu-error-title"
        aria-describedby="gpu-error-description gpu-error-message"
      >
        <header class="gpu-error-dialog__header">
          <span class="gpu-error-dialog__icon" aria-hidden="true">
            <AlertTriangle :size="24" />
          </span>
          <div>
            <span class="gpu-error-dialog__eyebrow">GPU-Fehler</span>
            <h2 id="gpu-error-title">{{ title }}</h2>
            <p id="gpu-error-description">
              Die GPU-Berechnung wurde abgebrochen. Lade die Seite neu, um den
              Grafikprozessor und die Vorschau erneut zu initialisieren.
            </p>
          </div>
        </header>

        <pre id="gpu-error-message" class="gpu-error-dialog__message">{{ message }}</pre>

        <footer class="gpu-error-dialog__actions">
          <button
            ref="reloadButton"
            class="gpu-error-dialog__reload"
            type="button"
            @click="emit('reload')"
          >
            <RefreshCw :size="17" aria-hidden="true" />
            Seite neu laden
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.gpu-error-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 20px;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(3px);
}

.gpu-error-dialog {
  width: min(540px, 100%);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  border: 1px solid #fecaca;
  border-radius: 10px;
  color: #172033;
  background: #ffffff;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.38);
}

.gpu-error-dialog__header {
  display: flex;
  gap: 14px;
  padding: 21px 22px 18px;
}

.gpu-error-dialog__icon {
  display: grid;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 50%;
  color: #b91c1c;
  background: #fee2e2;
}

.gpu-error-dialog__eyebrow {
  display: block;
  margin-bottom: 3px;
  color: #b91c1c;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gpu-error-dialog__header h2 {
  margin: 0 0 6px;
  font-size: 18px;
  overflow-wrap: anywhere;
}

.gpu-error-dialog__header p {
  margin: 0;
  color: #526070;
  font-size: 13px;
  line-height: 1.5;
}

.gpu-error-dialog__message {
  max-height: 180px;
  margin: 0 22px 20px;
  overflow: auto;
  border-left: 3px solid #ef4444;
  padding: 10px 12px;
  color: #7f1d1d;
  background: #fff7f7;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.gpu-error-dialog__actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #d5dde5;
  padding: 14px 22px;
  background: #f8fafc;
}

.gpu-error-dialog__reload {
  border-color: #b91c1c;
  color: #ffffff;
  background: #b91c1c;
}

.gpu-error-dialog__reload:hover {
  border-color: #991b1b;
  background: #991b1b;
}
</style>
