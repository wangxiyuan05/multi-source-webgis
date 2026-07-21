import type { Viewer } from 'cesium'
import { reactive } from 'vue'

export interface LayerItem {
  name: string
  key: string
  visible: boolean
  loading: boolean
  loaded: boolean
  flyTo: () => void
  setVisible: (v: boolean) => void
}

export interface SpectralData {
  /** 点击位置经纬度 */
  lon: number
  lat: number
  /** 波段号 (1‑based) */
  bands: number[]
  /** 各波段 DN 值 */
  values: number[]
}

export interface MapStore {
  viewer: Viewer | null
  layers: LayerItem[]
  /** 光谱曲线数据，null 表示清空 */
  spectralData: SpectralData | null
  /** 分屏对比模式 */
  splitMode: boolean
}

const store = reactive<MapStore>({
  viewer: null,
  layers: [],
  spectralData: null,
  splitMode: false,
})

export function useMapStore() {
  return { store }
}

export function getMapStore() {
  return store
}
