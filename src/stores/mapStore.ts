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

export interface ControlPointInfo {
  id: string
  lon: number
  lat: number
  height: number
  type: '地表控制点' | '模型控制点'
}

export interface MapStore {
  viewer: Viewer | null
  layers: LayerItem[]
  spectralData: SpectralData | null
  controlPointInfo: ControlPointInfo | null
  splitMode: boolean
  tiff: TiffState
  /** COG 手动定位偏移（度），仅当 TIFF 无地理参考时生效 */
  tiffOffset: { lon: number; lat: number; gsd: number }
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
  controlPointInfo: null,
  splitMode: false,
  tiff: {
    band: 1,
    colorScale: 'viridis',
    domainMin: 0,
    domainMax: 1,
  },
  tiffOffset: { lon: 120.08, lat: 30.31, gsd: 0.0000027 },
})

export function useMapStore() {
  return { store }
}

export function getMapStore() {
  return store
}
