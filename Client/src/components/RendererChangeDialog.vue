<script setup lang="ts">
import { AlertTriangle, ArrowRight } from '@lucide/vue';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import type { RendererBackend } from '../config/rendererBackends';

defineProps<{
  currentRenderer: RendererBackend;
  nextRenderer: RendererBackend;
  objectCount: number;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const backdrop = ref<HTMLElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const previouslyFocusedElement = document.activeElement instanceof HTMLElement
  ? document.activeElement
  : null;
const backgroundInertStates = new Map<HTMLElement, boolean>();

onMounted(async () => {
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement) || element === backdrop.value) continue;
    backgroundInertStates.set(element, element.inert);
    element.inert = true;
  }

  await nextTick();
  focusableElements()[0]?.focus();
});

onBeforeUnmount(() => {
  for (const [element, wasInert] of backgroundInertStates) {
    element.inert = wasInert;
  }
  previouslyFocusedElement?.focus();
});

function focusableElements() {
  if (!dialog.value) return [];
  return Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
    return;
  }
  if (event.key !== 'Tab') return;

  const elements = focusableElements();
  if (elements.length === 0) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="backdrop"
      class="renderer-dialog-backdrop"
      role="presentation"
      @click.self="emit('cancel')"
      @keydown="handleKeydown"
    >
      <section
        ref="dialog"
        class="renderer-dialog"
        role="alertdialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="renderer-dialog-title"
        aria-describedby="renderer-dialog-description"
      >
        <header class="renderer-dialog__header">
          <span class="renderer-dialog__icon" aria-hidden="true">
            <AlertTriangle :size="22" />
          </span>
          <div>
            <h2 id="renderer-dialog-title">Renderer wechseln?</h2>
            <p id="renderer-dialog-description">
              Der neue Renderer kann andere Objekte oder eine andere Renderer-Strategie verwenden.
            </p>
          </div>
        </header>

        <div class="renderer-dialog__change">
          <div class="renderer-dialog__renderer">
            <span>Aktuell</span>
            <strong>{{ currentRenderer.name }}</strong>
            <small>{{ currentRenderer.strategy.id }}</small>
          </div>
          <ArrowRight class="renderer-dialog__arrow" :size="20" aria-hidden="true" />
          <div class="renderer-dialog__renderer renderer-dialog__renderer--next">
            <span>Neu</span>
            <strong>{{ nextRenderer.name }}</strong>
            <small>{{ nextRenderer.strategy.id }}</small>
          </div>
        </div>

        <p class="renderer-dialog__warning">
          <strong>{{ objectCount }} {{ objectCount === 1 ? 'erstelltes Objekt wird' : 'erstellte Objekte werden' }} gelöscht.</strong>
          Dieser Schritt kann nicht rückgängig gemacht werden.
        </p>

        <footer class="renderer-dialog__actions">
          <button type="button" @click="emit('cancel')">Abbrechen</button>
          <button class="renderer-dialog__confirm" type="button" @click="emit('confirm')">
            Renderer wechseln
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.renderer-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.62);
  backdrop-filter: blur(2px);
}

.renderer-dialog {
  width: min(520px, 100%);
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  border: 1px solid #c8d1da;
  border-radius: 10px;
  color: #172033;
  background: #ffffff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.32);
}

.renderer-dialog__header {
  display: flex;
  gap: 13px;
  padding: 20px 22px 17px;
  border-bottom: 1px solid #d5dde5;
}

.renderer-dialog__header h2 {
  margin: 1px 0 5px;
  font-size: 17px;
}

.renderer-dialog__header p {
  margin: 0;
  color: #526070;
  font-size: 13px;
  line-height: 1.5;
}

.renderer-dialog__icon {
  display: grid;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 50%;
  color: #b45309;
  background: #fef3c7;
}

.renderer-dialog__change {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 18px 22px 12px;
}

.renderer-dialog__renderer {
  display: grid;
  gap: 3px;
  min-width: 0;
  border: 1px solid #d5dde5;
  border-radius: 8px;
  padding: 11px 12px;
  background: #f8fafc;
}

.renderer-dialog__renderer--next {
  border-color: rgba(47, 125, 118, 0.45);
  background: rgba(47, 125, 118, 0.07);
}

.renderer-dialog__renderer span,
.renderer-dialog__renderer small {
  overflow: hidden;
  color: #64748b;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.renderer-dialog__renderer strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.renderer-dialog__arrow {
  color: #64748b;
}

.renderer-dialog__warning {
  margin: 4px 22px 20px;
  border-left: 3px solid #f59e0b;
  padding: 9px 11px;
  color: #526070;
  background: #fffbeb;
  font-size: 12px;
  line-height: 1.5;
}

.renderer-dialog__warning strong {
  display: block;
  color: #92400e;
}

.renderer-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  border-top: 1px solid #d5dde5;
  padding: 14px 22px;
  background: #f8fafc;
}

.renderer-dialog__confirm {
  border-color: #b91c1c;
  color: #ffffff;
  background: #b91c1c;
}

.renderer-dialog__confirm:hover {
  border-color: #991b1b;
  background: #991b1b;
}

@media (max-width: 520px) {
  .renderer-dialog__change {
    grid-template-columns: 1fr;
  }

  .renderer-dialog__arrow {
    justify-self: center;
    transform: rotate(90deg);
  }
}
</style>
