<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { AlertTriangle, CircleHelp } from '@lucide/vue';

withDefaults(defineProps<{
  text: string;
  variant?: 'warning' | 'help';
}>(), {
  variant: 'warning',
});

const anchor = ref<HTMLElement | null>(null);
const tooltip = ref<HTMLElement | null>(null);
const visible = ref(false);
const left = ref(0);
const top = ref(0);
const tooltipId = `validation-tooltip-${Math.random().toString(36).slice(2)}`;
let hideTimer: number | undefined;

async function show() {
  cancelScheduledHide();
  visible.value = true;
  await nextTick();

  if (!visible.value) return;
  positionTooltip();
  window.addEventListener('resize', positionTooltip);
  document.addEventListener('scroll', positionTooltip, true);
}

function hide() {
  cancelScheduledHide();
  visible.value = false;
  removePositionListeners();
}

function scheduleHide() {
  cancelScheduledHide();
  hideTimer = window.setTimeout(hide, 100);
}

function cancelScheduledHide() {
  if (hideTimer === undefined) return;
  window.clearTimeout(hideTimer);
  hideTimer = undefined;
}

function positionTooltip() {
  if (!visible.value || !anchor.value || !tooltip.value) return;

  const gap = 8;
  const viewportPadding = 12;
  const anchorRect = anchor.value.getBoundingClientRect();
  const tooltipRect = tooltip.value.getBoundingClientRect();
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;

  const maxLeft = Math.max(
    viewportPadding,
    window.innerWidth - tooltipRect.width - viewportPadding,
  );
  left.value = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));

  const above = anchorRect.top - tooltipRect.height - gap;
  const preferredTop = above >= viewportPadding
    ? above
    : anchorRect.bottom + gap;
  const maxTop = Math.max(
    viewportPadding,
    window.innerHeight - tooltipRect.height - viewportPadding,
  );
  top.value = Math.min(maxTop, Math.max(viewportPadding, preferredTop));
}

function removePositionListeners() {
  window.removeEventListener('resize', positionTooltip);
  document.removeEventListener('scroll', positionTooltip, true);
}

onBeforeUnmount(() => {
  cancelScheduledHide();
  removePositionListeners();
});
</script>

<template>
  <span
    ref="anchor"
    class="validation-tooltip-anchor"
    tabindex="0"
    :aria-describedby="visible ? tooltipId : undefined"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focus="show"
    @blur="hide"
  >
    <CircleHelp
      v-if="variant === 'help'"
      :size="15"
      class="help-info"
      aria-hidden="true"
    />
    <AlertTriangle v-else :size="16" class="warning-info" aria-hidden="true" />
  </span>

  <Teleport to="body">
    <span
      v-if="visible"
      :id="tooltipId"
      ref="tooltip"
      class="validation-tooltip"
      role="tooltip"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @mouseenter="cancelScheduledHide"
      @mouseleave="scheduleHide"
    >
      {{ text }}
    </span>
  </Teleport>
</template>

<style scoped>
.validation-tooltip-anchor {
  display: inline-flex;
  flex: 0 0 auto;
  border-radius: 3px;
  cursor: help;
}

.validation-tooltip-anchor:focus-visible {
  outline: 2px solid rgba(180, 83, 9, 0.35);
  outline-offset: 2px;
}

.warning-info {
  color: #b45309;
}

.help-info {
  color: #64748b;
}

.validation-tooltip {
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
  width: max-content;
  max-width: min(320px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  border: 1px solid #c8d1da;
  border-radius: 6px;
  padding: 8px 10px;
  color: #172033;
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.24);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  white-space: pre-line;
  pointer-events: auto;
}
</style>
