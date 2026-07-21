/**
 * COG 渲染器：用 geotiff 读取波段数据 → 渲染到 Canvas →
 * 通过 Cesium Entity Rectangle 在指定 WGS-84 位置显示。
 * 同时提供单像素查询能力。
 */
import * as Cesium from 'cesium'
import { fromUrl } from 'geotiff'

let geoTiff: any = null
let tiffWidth = 0
let tiffHeight = 0
let tiffSamples = 0

export async function initCogReader(url: string) {
  geoTiff = await fromUrl(url)
  const image = await geoTiff.getImage()
  tiffWidth = image.getWidth()
  tiffHeight = image.getHeight()
  tiffSamples = image.getSamplesPerPixel()
  console.log(`[COG] 初始化: ${tiffWidth}×${tiffHeight}, ${tiffSamples} 波段`)
  return geoTiff
}

/** 利用 overview 读取指定波段（等级越低分辨率越高） */
export async function readBand(
  bandIndex: number,
  level = 2,
): Promise<{ data: Float32Array; width: number; height: number; min: number; max: number } | null> {
  if (!geoTiff) { console.warn('[COG] 未初始化'); return null }
  try {
    const count = await geoTiff.getImageCount()
    const idx = Math.min(level, count - 1)
    const image = await geoTiff.getImage(idx)
    const w = image.getWidth()
    const h = image.getHeight()

    const raster = await image.readRasters({ samples: [bandIndex - 1] })
    const data = raster[0] as Float32Array

    let min = Infinity, max = -Infinity
    for (let i = 0; i < data.length; i++) {
      const v = data[i]; if (v < min) min = v; if (v > max) max = v
    }
    return { data, width: w, height: h, min, max }
  } catch (err) {
    console.error('[COG] readBand 失败:', err)
    return null
  }
}

/** 渲染波段到 Canvas */
export function renderToCanvas(
  data: Float32Array, w: number, h: number,
  min: number, max: number, colorScale: string,
): HTMLCanvasElement | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { console.error('[COG] Canvas 不可用'); return null }

    const imageData = ctx.createImageData(w, h)
    const px = imageData.data
    const pal = getPalette(colorScale)
    const n = pal.length / 4
    const range = max - min || 1

    for (let i = 0; i < data.length; i++) {
      const t = (data[i] - min) / range
      const idx = Math.max(0, Math.min(n - 1, Math.floor(t * (n - 1)))) * 4
      px[i * 4] = pal[idx]; px[i * 4 + 1] = pal[idx + 1]
      px[i * 4 + 2] = pal[idx + 2]; px[i * 4 + 3] = 255
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } catch (err) { console.error('[COG] renderToCanvas 失败:', err); return null }
}

/** 查询指定经纬度的像素值和全波段光谱 */
export async function queryPixel(
  lon: number, lat: number,
  rect: { west: number; south: number; east: number; north: number },
): Promise<{ pixelX: number; pixelY: number; currentValue: number; allBands: { bands: number[]; values: number[] } } | null> {
  if (!geoTiff) return null
  try {
    const image = await geoTiff.getImage(0) // 全分辨率
    const w = image.getWidth()
    const h = image.getHeight()

    // 经纬度 → 像素坐标
    const px = ((lon - rect.west) / (rect.east - rect.west)) * w
    const py = ((rect.north - lat) / (rect.north - rect.south)) * h
    const ix = Math.round(Math.max(0, Math.min(w - 1, px)))
    const iy = Math.round(Math.max(0, Math.min(h - 1, py)))

    const samples = image.getSamplesPerPixel()
    const bands: number[] = []
    const values: number[] = []

    for (let b = 0; b < Math.min(samples, 151); b++) {
      const raster = await image.readRasters({ samples: [b], window: [ix, iy, ix + 1, iy + 1] })
      bands.push(b + 1)
      values.push(raster[0][0])
    }
    return { pixelX: ix, pixelY: iy, currentValue: values[0], allBands: { bands, values } }
  } catch (err) { console.error('[COG] queryPixel 失败:', err); return null }
}

// ---------- 内置 viridis 色带（精简版 128 色） ----------
const PAL = new Uint8Array([
  68,1,84,255, 70,8,92,255, 71,16,99,255, 72,24,106,255,
  72,31,112,255, 72,38,119,255, 71,46,124,255, 70,53,129,255,
  68,61,132,255, 66,65,134,255, 63,72,137,255, 60,79,138,255,
  57,86,140,255, 53,94,141,255, 49,102,142,255, 45,110,142,255,
  41,118,142,255, 38,127,142,255, 35,136,142,255, 34,143,141,255,
  33,145,140,255, 31,150,139,255, 30,156,137,255, 30,161,135,255,
  32,165,133,255, 35,170,130,255, 42,176,126,255, 50,182,121,255,
  59,187,117,255, 70,192,111,255, 82,197,105,255, 96,201,98,255,
  112,204,90,255, 129,207,81,255, 147,210,71,255, 165,213,61,255,
  184,217,49,255, 200,221,38,255, 213,225,27,255, 226,228,24,255,
  236,231,25,255, 244,232,29,255, 250,233,35,255, 254,235,46,255,
  253,237,59,255, 249,240,75,255, 244,242,93,255, 240,244,110,255,
  238,246,128,255, 240,248,145,255, 244,249,161,255, 249,250,176,255,
  252,251,189,255, 254,252,200,255, 255,253,211,255, 255,253,221,255,
  255,253,230,255, 255,254,237,255, 255,254,244,255, 255,255,249,255,
])

function getPalette(_name: string): Uint8Array { return PAL }
