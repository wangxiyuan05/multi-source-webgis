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
  pixelX: number
  pixelY: number
  currentValue: number
  bands: number[]
  values: number[]
}

export type RenderMode = 'singleBand' | 'rgb'

export interface RgbConfig {
  rBand: number; rMin: number; rMax: number
  gBand: number; gMin: number; gMax: number
  bBand: number; bMin: number; bMax: number
}

export interface TiffState {
  renderMode: RenderMode
  band: number
  colorScale: string
  domainMin: number
  domainMax: number
  rgb: RgbConfig
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
  tiff: TiffState
  tiffOffset: { lon: number; lat: number; gsd: number }
  tiffApplyVersion: number
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
  tiff: {
    renderMode: 'singleBand',
    band: 1,
    colorScale: 'viridis',
    domainMin: 0,
    domainMax: 0.3,
    rgb: { rBand: 1, rMin: 0, rMax: 0.3, gBand: 2, gMin: 0, gMax: 0.3, bBand: 3, bMin: 0, bMax: 0.3 },
  },
  tiffOffset: { lon: 120.08, lat: 30.31, gsd: 0.0000027 },
  tiffApplyVersion: 0,
})

export function useMapStore() {
  return { store }
}

export function getMapStore() {
  return store
}
