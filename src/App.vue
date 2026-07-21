<script setup lang="ts">
import { computed } from 'vue'
import CesiumMap from './components/CesiumMap.vue'
import LayerPanel from './components/LayerPanel.vue'
import { useMapStore } from './stores/mapStore'

const { store } = useMapStore()
const cp = computed(() => store.controlPointInfo)

function closePopup() {
  store.controlPointInfo = null
}
</script>

<template>
  <CesiumMap />
  <LayerPanel />

  <!-- 控制点信息弹窗 -->
  <Teleport to="body">
    <div v-if="cp" class="cp-overlay" @click.self="closePopup">
      <div class="cp-card">
        <div class="cp-header">
          <span class="cp-title">控制点信息</span>
          <button class="cp-close" @click="closePopup">✕</button>
        </div>
        <div class="cp-body">
          <div class="cp-row">
            <span class="cp-label">编号</span>
            <span class="cp-value">{{ cp.id }}</span>
          </div>
          <div class="cp-row">
            <span class="cp-label">类型</span>
            <span class="cp-value cp-type" :class="cp.type === '模型控制点' ? 'type-model' : 'type-surface'">
              {{ cp.type }}
            </span>
          </div>
          <div class="cp-row">
            <span class="cp-label">经度</span>
            <span class="cp-value mono">{{ cp.lon.toFixed(6) }}°</span>
          </div>
          <div class="cp-row">
            <span class="cp-label">纬度</span>
            <span class="cp-value mono">{{ cp.lat.toFixed(6) }}°</span>
          </div>
          <div class="cp-row">
            <span class="cp-label">高程</span>
            <span class="cp-value mono">{{ cp.height.toFixed(3) }} m</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { width: 100%; height: 100%; overflow: hidden; }

/* 控制点弹窗 */
.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  pointer-events: auto;
}

.cp-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  width: 300px;
  overflow: hidden;
  pointer-events: auto;
}

.cp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.cp-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.cp-close {
  width: 24px; height: 24px;
  border: none;
  background: transparent;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cp-close:hover { background: rgba(0,0,0,0.08); color: #333; }

.cp-body { padding: 8px 16px 12px; }

.cp-row {
  display: flex;
  align-items: center;
  padding: 5px 0;
  gap: 8px;
}

.cp-label {
  font-size: 12px;
  color: #999;
  width: 36px;
  flex-shrink: 0;
}

.cp-value {
  font-size: 13px;
  color: #333;
  font-weight: 500;
}

.cp-value.mono {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
}

.cp-type {
  padding: 1px 8px;
  border-radius: 3px;
  font-size: 11px;
}

.cp-type.type-surface {
  background: rgba(65, 105, 225, 0.12);
  color: #4169e1;
}

.cp-type.type-model {
  background: rgba(220, 20, 60, 0.12);
  color: #dc143c;
}
</style>
