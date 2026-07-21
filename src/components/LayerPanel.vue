<script setup lang="ts">
import { computed, watch, ref, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { useMapStore, COLORSCALE_OPTIONS, type LayerItem } from '../stores/mapStore'

const { store } = useMapStore()

const layers = computed(() => store.layers)
const spectral = computed(() => store.spectralData)

// ---------- 图层开关 ----------

function toggle(layer: LayerItem) {
  const v = !layer.visible
  layer.visible = v
  layer.setVisible(v)
}

// ---------- 光谱图表 ----------

const chartContainer = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

onMounted(() => {
  if (!chartContainer.value) return
  chart = echarts.init(chartContainer.value, undefined, { renderer: 'canvas' })
  // 初始空状态
  chart.setOption(getBaseOption())
  // 窗口变化自适应
  const ro = new ResizeObserver(() => chart?.resize())
  ro.observe(chartContainer.value)
})

onUnmounted(() => {
  chart?.dispose()
  chart = null
})

watch(spectral, (data) => {
  // 确保 chart 绑定到当前 DOM（v-if 切换后 ref 可能会变）
  if (!chart && chartContainer.value) {
    chart = echarts.init(chartContainer.value, undefined, { renderer: 'canvas' })
    const ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartContainer.value)
  }
  if (!chart) return
  if (!data || data.values.every((v: number) => v === 0)) {
    chart.clear()
    chart.setOption(getBaseOption())
    return
  }
  chart.setOption({
    title: { show: false },
    xAxis: {
      type: 'category',
      data: data.bands,
      name: '波段号',
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 9, interval: Math.max(1, Math.floor(data.bands.length / 12)) },
    },
    yAxis: {
      type: 'value',
      name: 'DN 值',
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 9 },
      scale: true,
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = params[0]
        return `波段 ${p.name}<br/>DN: <b>${p.value}</b>`
      },
    },
    series: [
      {
        type: 'line',
        data: data.values,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(24, 144, 255, 0.4)' },
            { offset: 1, color: 'rgba(24, 144, 255, 0.05)' },
          ]),
        },
      },
    ],
  })
})

function getBaseOption() {
  return {
    title: {
      text: '点击地图查看光谱',
      textStyle: { fontSize: 11, color: '#999' },
      left: 'center',
      top: 'center',
    },
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
  }
}

function clearChart() {
  store.spectralData = null
}
</script>

<template>
  <div class="layer-panel">
    <h3 class="panel-title">图层控制</h3>
    <div class="layer-list">
      <div
        v-for="layer in layers"
        :key="layer.key"
        class="layer-item"
        :class="{ 'is-loading': layer.loading }"
      >
        <label class="layer-switch">
          <input
            type="checkbox"
            :checked="layer.visible"
            :disabled="!layer.loaded"
            @change="toggle(layer)"
          />
          <span class="switch-slider" />
        </label>
        <span class="layer-name" :class="{ 'not-loaded': !layer.loaded }">
          {{ layer.loaded ? layer.name : `${layer.name} (未加载)` }}
        </span>
        <button
          class="btn-fly"
          :disabled="!layer.loaded"
          title="定位到该图层"
          @click="layer.flyTo"
        >
          定位
        </button>
      </div>
      <div v-if="layers.length === 0" class="empty-hint">加载中...</div>
    </div>

    <!-- 高光谱渲染 -->
    <div class="tiff-section">
      <div class="tiff-header">高光谱渲染</div>
      <div class="tiff-row">
        <span class="tiff-label">波段</span>
        <select v-model.number="store.tiff.band" class="tiff-control">
          <option v-for="b in 151" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>
      <div class="tiff-row">
        <span class="tiff-label">色带</span>
        <select v-model="store.tiff.colorScale" class="tiff-control">
          <option v-for="s in COLORSCALE_OPTIONS" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="tiff-row">
        <span class="tiff-label">最小值</span>
        <input
          type="number"
          v-model.number="store.tiff.domainMin"
          class="tiff-control"
          step="any"
        />
      </div>
      <div class="tiff-row">
        <span class="tiff-label">最大值</span>
        <input
          type="number"
          v-model.number="store.tiff.domainMax"
          class="tiff-control"
          step="any"
        />
      </div>
      <div class="tiff-divider" />
      <div class="tiff-row">
        <span class="tiff-label">经度</span>
        <input
          type="number"
          v-model.number="store.tiffOffset.lon"
          class="tiff-control"
          step="0.0001"
        />
      </div>
      <div class="tiff-row">
        <span class="tiff-label">纬度</span>
        <input
          type="number"
          v-model.number="store.tiffOffset.lat"
          class="tiff-control"
          step="0.0001"
        />
      </div>
      <div class="tiff-row">
        <span class="tiff-label">GSD</span>
        <input
          type="number"
          v-model.number="store.tiffOffset.gsd"
          class="tiff-control"
          step="0.0000001"
          title="像元大小（度/像素），默认 ~0.3m"
        />
      </div>
      <button class="tiff-apply-btn" @click="store.tiffApplyVersion++">
        应用渲染配置
      </button>
    </div>

    <!-- 光谱曲线 -->
    <div class="spectral-section" :class="{ 'spectral-empty': !spectral }">
      <div v-if="spectral" class="spectral-header">
        <span class="spectral-title">光谱曲线</span>
        <button class="btn-close" title="关闭" @click="clearChart">✕</button>
      </div>
      <div v-if="spectral" class="spectral-info">
        <div class="si-row"><span class="si-label">位置</span><span class="si-val">{{ spectral.lat.toFixed(5) }}, {{ spectral.lon.toFixed(5) }}</span></div>
        <div class="si-row"><span class="si-label">像素</span><span class="si-val">({{ spectral.pixelX }}, {{ spectral.pixelY }})</span></div>
        <div class="si-row"><span class="si-label">波段 {{ store.tiff.band }}</span><span class="si-val mono">{{ spectral.currentValue.toFixed(6) }}</span></div>
      </div>
      <div v-if="spectral && spectral.values.every(v => v === 0)" class="spectral-nodata">该位置无有效高光谱像素</div>
      <div ref="chartContainer" class="chart-box" style="height:180px" />
    </div>
  </div>
</template>

<style scoped>
.layer-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 260px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(8px);
  border-radius: 10px;
  padding: 12px 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  user-select: none;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
}

.panel-title {
  margin: 0 0 6px;
  padding: 0 14px 10px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* ---- Layer list ---- */

.layer-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  transition: background 0.15s;
}

.layer-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.layer-item.is-loading {
  opacity: 0.5;
}

.layer-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
}

.layer-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #ccc;
  border-radius: 18px;
  transition: background 0.2s;
}

.switch-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.layer-switch input:checked + .switch-slider {
  background: #4caf50;
}

.layer-switch input:checked + .switch-slider::before {
  transform: translateX(14px);
}

.layer-switch input:disabled + .switch-slider {
  opacity: 0.4;
  cursor: not-allowed;
}

.layer-name {
  flex: 1;
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.layer-name.not-loaded {
  color: #999;
}

.btn-fly {
  flex-shrink: 0;
  padding: 2px 10px;
  font-size: 12px;
  border: 1px solid #1890ff;
  background: transparent;
  color: #1890ff;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-fly:hover:not(:disabled) {
  background: #1890ff;
  color: #fff;
}

.btn-fly:disabled {
  border-color: #d9d9d9;
  color: #d9d9d9;
  cursor: not-allowed;
}

.empty-hint {
  padding: 12px 14px;
  font-size: 13px;
  color: #999;
  text-align: center;
}

/* ---- TIFF render ---- */

.tiff-section {
  padding: 6px 14px 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  margin-top: 4px;
}

.tiff-header {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  margin-bottom: 6px;
}

.tiff-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.tiff-label {
  font-size: 12px;
  color: #666;
  width: 44px;
  flex-shrink: 0;
}

.tiff-control {
  flex: 1;
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  color: #333;
  outline: none;
  transition: border-color 0.2s;
  min-width: 0;
}

.tiff-control:focus {
  border-color: #1890ff;
}

/* number input 右边箭头区域窄一点 */
.tiff-control[type='number'] {
  -moz-appearance: textfield;
}

.tiff-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 6px 0;
}

.tiff-apply-btn {
  display: block;
  width: calc(100% - 28px);
  margin: 8px 14px 0;
  padding: 5px 0;
  font-size: 12px;
  border: 1px solid #1890ff;
  background: #1890ff;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.tiff-apply-btn:hover {
  background: #40a9ff;
  border-color: #40a9ff;
}

.tiff-apply-btn:active {
  background: #096dd9;
}

/* ---- Spectral chart ---- */

.spectral-section {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  margin-top: 6px;
}

.spectral-section.spectral-empty {
  border-top: none;
  margin-top: 0;
}

.spectral-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 4px;
}

.spectral-title {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.spectral-pos {
  font-size: 10px;
  font-weight: 400;
  color: #999;
  margin-left: 6px;
}

.btn-close {
  width: 20px;
  height: 20px;
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

.btn-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #333;
}

.spectral-info {
  padding: 2px 14px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.si-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.si-label {
  font-size: 11px;
  color: #999;
  width: 44px;
  flex-shrink: 0;
}

.si-val {
  font-size: 12px;
  color: #333;
  font-weight: 500;
}

.si-val.mono {
  font-family: 'Consolas', 'Monaco', monospace;
}

.spectral-nodata {
  padding: 20px 14px;
  text-align: center;
  font-size: 12px;
  color: #999;
}

.chart-box {
  width: 100%;
  height: 180px;
  padding: 0 4px;
}
</style>
