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
  lon: number
  lat: number
  bands: number[]
  values: number[]
}

export interface TiffState {
  band: number
  colorScale: string
  domainMin: number
  domainMax: number
}

export interface MapStore {
  viewer: Viewer | null
  layers: LayerItem[]
  spectralData: SpectralData | null
  splitMode: boolean
  tiff: TiffState
  /** COG 手动定位偏移（度），仅当 TIFF 无地理参考时生效 */
  tiffOffset: { lon: number; lat: number; gsd: number }
  /** 倾斜摄影模型位置微调（米，ENU 局部坐标系） */
  obliqueOffset: { east: number; north: number; up: number }
}

export const COLORSCALE_OPTIONS = [
  'viridis',
  'inferno',
  'turbo',
  'rainbow',
  'jet',
  'hot',
  'cool',
  'spring',
  'summer',
  'autumn',
  'winter',
  'greens',
  'bluered',
  'rdbu',
  'greys',
  'magma',
  'plasma',
]

const store = reactive<MapStore>({
  viewer: null,
  layers: [],
  spectralData: null,
  splitMode: false,
  tiff: {
    band: 1,
    colorScale: 'viridis',
    domainMin: 0,
    domainMax: 1,
  },
  tiffOffset: { lon: 120.08, lat: 30.31, gsd: 0.0000027 },
  obliqueOffset: { east: 0, north: 0, up: 0 },
})

export function useMapStore() {
  return { store }
}

export function getMapStore() {
  return store
}
