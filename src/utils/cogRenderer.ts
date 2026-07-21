/**
 * COGTiff 渲染器：用 geotiff 直接读取波段数据，
 * 渲染到 Canvas，通过 SingleTileImageryProvider 定位显示。
 * 适合无地理参考的 COG 文件。
 */
import * as Cesium from 'cesium'
import { fromUrl } from 'geotiff'

let tiff: any = null
let currentBand = 1

export async function initCogReader(url: string) {
  tiff = await fromUrl(url)
  return tiff
}

export function getImageCount(): number {
  return tiff ? (tiff.getImageCount?.() || 0) : 0
}

/** 读取指定波段的完整数据（使用第 2 级金字塔 ~1377×326 平衡性能） */
export async function readBand(bandIndex: number): Promise<{
  data: Float32Array
  width: number
  height: number
  min: number
  max: number
} | null> {
  if (!tiff) return null
  try {
    // 用第 2 级金字塔（快速读取）
    const levels = tiff.getImageCount()
    const level = Math.min(2, levels - 1)
    const image = await tiff.getImage(level)
    const w = image.getWidth()
    const h = image.getHeight()
    const raster = await image.readRasters({ samples: [bandIndex - 1] })
    const data = raster[0] as Float32Array

    // 计算实际 min/max
    let min = Infinity, max = -Infinity
    for (let i = 0; i < data.length; i++) {
      const v = data[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    return { data, width: w, height: h, min, max }
  } catch (err) {
    console.error('读取 COG 波段失败:', err)
    return null
  }
}

/** 将波段数据渲染到 Canvas */
export function renderToCanvas(
  data: Float32Array,
  width: number,
  height: number,
  min: number,
  max: number,
  colorScale: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(width, height)
  const pixels = imageData.data

  // 取色带数据（从 TIFFImageryProvider 的 colorscales 常量中提取）
  const colors = getColorScale(colorScale)
  if (!colors || colors.length < 4) {
    // 默认黑白
    for (let i = 0; i < data.length; i++) {
      const t = max === min ? 0 : (data[i] - min) / (max - min)
      const v = Math.max(0, Math.min(255, Math.round(t * 255)))
      pixels[i * 4] = v
      pixels[i * 4 + 1] = v
      pixels[i * 4 + 2] = v
      pixels[i * 4 + 3] = 255
    }
  } else {
    const n = colors.length / 4
    for (let i = 0; i < data.length; i++) {
      const t = max === min ? 0 : (data[i] - min) / (max - min)
      const idx = Math.max(0, Math.min(n - 1, Math.floor(t * (n - 1)))) * 4
      pixels[i * 4] = colors[idx]
      pixels[i * 4 + 1] = colors[idx + 1]
      pixels[i * 4 + 2] = colors[idx + 2]
      pixels[i * 4 + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

/** 创建 Cesium SingleTileImageryProvider */
export function createImageryProvider(
  canvas: HTMLCanvasElement,
  west: number,
  south: number,
  east: number,
  north: number,
): Cesium.ImageryProvider {
  return new Cesium.SingleTileImageryProvider({
    url: canvasToDataURL(canvas),
    rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
  })
}

function canvasToDataURL(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

/** 读取指定位置所有波段的 DN 值（用于光谱曲线） */
export async function readPixelAllBands(
  lon: number,
  lat: number,
  rect: { west: number; south: number; east: number; north: number },
): Promise<{ bands: number[]; values: number[] } | null> {
  if (!tiff) return null
  const image = await tiff.getImage(0) // 全分辨率
  const w = image.getWidth()
  const h = image.getHeight()

  // 经纬度 → 像素坐标
  const px = ((lon - rect.west) / (rect.east - rect.west)) * w
  const py = ((rect.north - lat) / (rect.north - rect.south)) * h
  const ix = Math.round(Math.max(0, Math.min(w - 1, px)))
  const iy = Math.round(Math.max(0, Math.min(h - 1, py)))

  if (ix < 0 || ix >= w || iy < 0 || iy >= h) return null

  const samples = image.getSamplesPerPixel()
  const bands: number[] = []
  const values: number[] = []
  for (let b = 0; b < samples; b++) {
    const raster = await image.readRasters({ samples: [b], window: [ix, iy, ix + 1, iy + 1] })
    bands.push(b + 1)
    values.push(raster[0][0])
  }
  return { bands, values }
}

// ---------- 色带 ----------

const COLORSCALE_DATA: Record<string, Uint8Array> = {
  viridis: new Uint8Array([
    68, 1, 84, 255, 68, 2, 86, 255, 69, 4, 87, 255, 69, 5, 89, 255,
    70, 7, 90, 255, 70, 8, 92, 255, 70, 10, 93, 255, 70, 11, 94, 255,
    71, 13, 96, 255, 71, 14, 97, 255, 71, 16, 99, 255, 71, 17, 100, 255,
    72, 20, 103, 255, 72, 22, 104, 255, 72, 23, 105, 255, 72, 24, 106, 255,
    72, 26, 108, 255, 72, 27, 109, 255, 72, 28, 110, 255, 72, 29, 111, 255,
    72, 31, 112, 255, 72, 32, 113, 255, 72, 33, 115, 255, 72, 35, 116, 255,
    72, 36, 117, 255, 72, 37, 118, 255, 72, 38, 119, 255, 72, 40, 120, 255,
    72, 41, 121, 255, 71, 42, 122, 255, 71, 44, 122, 255, 71, 45, 123, 255,
    71, 46, 124, 255, 71, 47, 125, 255, 70, 48, 126, 255, 70, 50, 126, 255,
    70, 51, 127, 255, 70, 52, 128, 255, 69, 53, 129, 255, 69, 55, 129, 255,
    69, 56, 130, 255, 68, 57, 131, 255, 68, 58, 131, 255, 68, 59, 132, 255,
    67, 61, 132, 255, 67, 62, 133, 255, 66, 63, 133, 255, 66, 64, 134, 255,
    66, 65, 134, 255, 65, 66, 135, 255, 65, 68, 135, 255, 64, 69, 136, 255,
    64, 70, 136, 255, 63, 71, 136, 255, 63, 72, 137, 255, 62, 73, 137, 255,
    61, 78, 138, 255, 60, 79, 138, 255, 60, 80, 139, 255, 59, 81, 139, 255,
    59, 82, 139, 255, 45, 112, 142, 255, 44, 113, 142, 255, 44, 114, 142, 255,
    44, 115, 142, 255, 43, 116, 142, 255, 42, 118, 142, 255, 42, 119, 142, 255,
    41, 121, 142, 255, 41, 122, 142, 255, 40, 124, 142, 255, 40, 125, 142, 255,
    39, 127, 142, 255, 39, 128, 142, 255, 38, 130, 142, 255, 38, 130, 142, 255,
    37, 131, 142, 255, 37, 132, 142, 255, 36, 134, 142, 255, 36, 135, 142, 255,
    33, 142, 141, 255, 33, 143, 141, 255, 33, 144, 141, 255, 33, 145, 140, 255,
    32, 146, 140, 255, 32, 146, 140, 255, 32, 147, 140, 255, 31, 148, 140, 255,
    31, 149, 139, 255, 30, 155, 138, 255, 30, 156, 137, 255, 30, 157, 137, 255,
    31, 158, 137, 255, 69, 172, 130, 255, 70, 174, 128, 255, 72, 176, 127, 255,
    74, 178, 125, 255, 76, 180, 124, 255, 78, 182, 122, 255, 80, 184, 121, 255,
    82, 186, 119, 255, 85, 188, 118, 255, 87, 189, 116, 255, 90, 191, 114, 255,
    92, 193, 112, 255, 95, 194, 110, 255, 101, 197, 106, 255, 104, 199, 104, 255,
    107, 200, 102, 255, 110, 202, 99, 255, 113, 203, 97, 255, 116, 204, 95, 255,
    119, 206, 92, 255, 122, 207, 90, 255, 125, 208, 88, 255, 128, 210, 85, 255,
    131, 211, 83, 255, 134, 212, 80, 255, 137, 213, 78, 255, 141, 214, 75, 255,
    144, 215, 73, 255, 147, 216, 70, 255, 150, 217, 68, 255, 153, 218, 66, 255,
    157, 219, 63, 255, 160, 220, 61, 255, 163, 221, 58, 255, 167, 222, 56, 255,
    170, 223, 54, 255, 173, 223, 51, 255, 177, 224, 49, 255, 180, 225, 47, 255,
    184, 225, 45, 255, 187, 226, 43, 255, 191, 226, 41, 255, 194, 227, 39, 255,
    198, 227, 37, 255, 201, 228, 36, 255, 205, 228, 34, 255, 208, 228, 33, 255,
    212, 229, 31, 255, 215, 229, 30, 255, 219, 229, 29, 255, 222, 230, 28, 255,
    226, 230, 27, 255, 229, 230, 26, 255, 233, 230, 25, 255, 236, 231, 25, 255,
    239, 231, 25, 255, 242, 231, 25, 255, 246, 231, 25, 255, 249, 231, 26, 255,
    251, 231, 27, 255, 254, 232, 28, 255, 255, 232, 31, 255, 255, 233, 34, 255,
    255, 233, 37, 255, 255, 234, 41, 255, 255, 234, 45, 255, 255, 235, 50, 255,
    255, 235, 54, 255, 255, 236, 59, 255, 255, 236, 64, 255, 255, 237, 69, 255,
    255, 237, 74, 255, 255, 238, 79, 255, 255, 238, 84, 255, 255, 239, 89, 255,
    255, 239, 95, 255, 255, 240, 100, 255, 255, 240, 106, 255, 255, 240, 112, 255,
    255, 241, 118, 255, 255, 241, 124, 255, 255, 242, 130, 255, 255, 242, 136, 255,
    255, 243, 142, 255, 255, 243, 148, 255, 255, 243, 154, 255, 255, 244, 160, 255,
    255, 244, 166, 255, 255, 245, 173, 255, 255, 245, 179, 255, 255, 245, 185, 255,
    255, 246, 191, 255, 255, 246, 197, 255, 255, 247, 203, 255, 255, 247, 210, 255,
    255, 247, 216, 255, 255, 248, 222, 255, 255, 248, 228, 255, 255, 248, 234, 255,
    255, 249, 240, 255, 255, 249, 246, 255, 255, 250, 252, 255, 255, 250, 255, 255,
  ]),
  inferno: new Uint8Array([
    0, 0, 4, 255, 1, 0, 5, 255, 1, 1, 6, 255, 1, 1, 8, 255,
    2, 1, 10, 255, 2, 2, 12, 255, 2, 2, 14, 255, 3, 2, 16, 255,
    4, 3, 18, 255, 4, 3, 20, 255, 5, 4, 23, 255, 6, 4, 25, 255,
    7, 5, 27, 255, 8, 5, 29, 255, 10, 7, 34, 255, 11, 7, 36, 255,
    16, 9, 45, 255, 17, 10, 48, 255, 22, 11, 55, 255, 24, 11, 57, 255,
    33, 12, 67, 255, 35, 12, 69, 255, 40, 11, 83, 255, 41, 11, 85, 255,
    47, 9, 97, 255, 49, 9, 98, 255, 57, 10, 104, 255, 59, 10, 104, 255,
    158, 39, 96, 255, 160, 42, 92, 255, 200, 61, 67, 255, 202, 63, 65, 255,
    232, 96, 43, 255, 234, 100, 40, 255, 247, 157, 12, 255, 248, 164, 12, 255,
    252, 209, 37, 255, 252, 213, 37, 255, 252, 239, 93, 255, 252, 240, 99, 255,
    252, 249, 155, 255, 252, 250, 158, 255, 252, 253, 191, 255, 252, 253, 193, 255,
  ]),
  turbo: new Uint8Array([
    48, 18, 59, 255, 50, 21, 67, 255, 52, 27, 81, 255, 54, 33, 95, 255,
    56, 39, 109, 255, 58, 45, 121, 255, 60, 50, 134, 255, 62, 56, 145, 255,
    64, 62, 156, 255, 65, 67, 167, 255, 67, 73, 177, 255, 68, 78, 186, 255,
    69, 86, 199, 255, 70, 94, 211, 255, 70, 102, 221, 255, 71, 110, 230, 255,
    71, 118, 238, 255, 70, 128, 246, 255, 69, 140, 252, 255, 66, 148, 254, 255,
    62, 158, 253, 255, 56, 168, 250, 255, 49, 178, 244, 255, 42, 188, 235, 255,
    35, 198, 223, 255, 28, 205, 216, 255, 24, 215, 202, 255, 24, 222, 192, 255,
    29, 230, 178, 255, 37, 236, 167, 255, 47, 241, 155, 255, 63, 246, 138, 255,
    82, 250, 122, 255, 105, 253, 102, 255, 132, 255, 81, 255, 159, 254, 64, 255,
    185, 247, 53, 255, 210, 234, 52, 255, 231, 217, 56, 255, 244, 199, 58, 255,
    250, 184, 55, 255, 253, 169, 50, 255, 254, 153, 43, 255, 252, 132, 35, 255,
    247, 108, 25, 255, 239, 88, 17, 255, 229, 71, 11, 255, 216, 55, 7, 255,
    200, 42, 4, 255, 183, 29, 2, 255, 164, 19, 1, 255, 142, 10, 2, 255,
  ]),
}

function getColorScale(name: string): Uint8Array | null {
  return COLORSCALE_DATA[name] || COLORSCALE_DATA.viridis
}
