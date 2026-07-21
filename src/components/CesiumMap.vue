<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import { getMapStore, type LayerItem } from '../stores/mapStore'
import { initCogReader, readBand, renderToCanvas, queryPixel } from '../utils/cogRenderer'

const mapContainer = ref<HTMLDivElement>()
let viewer: Cesium.Viewer | null = null
let tiffEntity: Cesium.Entity | null = null
let obliqueTileset: Cesium.Cesium3DTileset | null = null
let gsTileset: Cesium.Cesium3DTileset | null = null
const store = getMapStore()

// ---------- 工具函数 ----------

async function loadTileset(url: string): Promise<Cesium.Cesium3DTileset | null> {
  if (!viewer) return null
  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url)
    viewer.scene.primitives.add(tileset)
    return tileset
  } catch (err) {
    console.error(`加载 3D Tiles 失败: ${url}`, err)
    return null
  }
}

function registerLayer(item: LayerItem) {
  store.layers.push(item)
}

function getTiffRect() {
  const { lon, lat, gsd } = store.tiffOffset
  const cosLat = Math.cos(lat * Math.PI / 180)
  const w = 5509 * gsd / cosLat
  const h = 1306 * gsd
  return { west: lon - w / 2, east: lon + w / 2, south: lat - h / 2, north: lat + h / 2 }
}

// ---------- 倾斜模型 ENU 偏移 ----------

function applyObliqueOffset(tileset: Cesium.Cesium3DTileset) {
  const t = tileset.root.transform
  const origin = new Cesium.Cartesian3(t[12], t[13], t[14])
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
  const local = new Cesium.Cartesian3(-30, 20, 70)
  const absEcef = Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3())
  const originEcef = Cesium.Matrix4.multiplyByPoint(enu, Cesium.Cartesian3.ZERO, new Cesium.Cartesian3())
  const offsetEcef = Cesium.Cartesian3.subtract(absEcef, originEcef, new Cesium.Cartesian3())
  tileset.modelMatrix = Cesium.Matrix4.fromTranslation(offsetEcef)
}

// ---------- 高光谱渲染（Canvas + Entity Rectangle） ----------

async function renderCog() {
  if (!viewer) return
  const s = store.tiff
  const rect = getTiffRect()

  const result = await readBand(s.band, 2)
  if (!result) { console.warn('[COG] readBand 返回空'); return }

  const canvas = renderToCanvas(result.data, result.width, result.height, s.domainMin, s.domainMax, s.colorScale)
  if (!canvas) return

  // 移除旧 entity
  if (tiffEntity) { viewer.entities.remove(tiffEntity) }

  tiffEntity = viewer.entities.add({
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north),
      material: new Cesium.ImageMaterialProperty({ image: canvas.toDataURL('image/png'), transparent: true }),
      height: 0,
    },
  })
  console.log('[COG] 渲染完成', JSON.stringify(rect))
}

// ---------- 加载模型控制点 ----------

async function loadModelGcp(tileset: Cesium.Cesium3DTileset): Promise<Cesium.GeoJsonDataSource | null> {
  if (!viewer) return null
  try {
    const resp = await fetch('/geojson/model-gcp.json')
    const json = await resp.json()
    const matrix = tileset.root.transform
    const features: Record<string, any>[] = []
    for (const pt of json.points) {
      const local = new Cesium.Cartesian3(pt.local[0], pt.local[1], pt.local[2])
      const ecef = Cesium.Matrix4.multiplyByPoint(matrix, local, new Cesium.Cartesian3())
      const carto = Cesium.Cartographic.fromCartesian(ecef)
      const lon = Cesium.Math.toDegrees(carto.longitude)
      const lat = Cesium.Math.toDegrees(carto.latitude)
      features.push({
        type: 'Feature', properties: { id: pt.id },
        geometry: { type: 'Point', coordinates: [lon, lat, carto.height] },
      })
    }
    const fc = { type: 'FeatureCollection', features }
    const dataSource = await Cesium.GeoJsonDataSource.load(fc, { clampToGround: true, markerSize: 0 })
    dataSource.entities.values.forEach((entity) => {
      entity.billboard = undefined
      entity.point = new Cesium.PointGraphics({
        color: Cesium.Color.RED, pixelSize: 10,
        outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
      if (entity.properties?.id) {
        entity.label = new Cesium.LabelGraphics({
          text: entity.properties.id.getValue(), font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        })
      }
    })
    viewer.dataSources.add(dataSource)
    return dataSource
  } catch (err) { console.error('加载模型控制点失败:', err); return null }
}

// ---------- 生命周期 ----------

onMounted(async () => {
  if (!mapContainer.value) return

  viewer = new Cesium.Viewer(mapContainer.value, {
    animation: false, timeline: false, baseLayerPicker: false,
    fullscreenButton: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, geocoder: false, infoBox: false,
    selectionIndicator: false, scene3DOnly: true, useDefaultRenderLoop: true,
  })
  store.viewer = viewer
  viewer.imageryLayers.removeAll()

  // Esri 卫星底图
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri World Imagery', minimumLevel: 0, maximumLevel: 19,
  }))

  // COGTiff 高光谱
  try {
    await initCogReader('/cog/final-cog.tif')
    const initial = await readBand(1, 2)
    if (initial) { store.tiff.domainMin = initial.min; store.tiff.domainMax = initial.max }
    await renderCog()
    registerLayer({
      name: '高光谱影像', key: 'tiff', visible: true, loading: false, loaded: true,
      flyTo: () => {
        const r = getTiffRect()
        viewer?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees((r.west + r.east) / 2, (r.north + r.south) / 2, 2000) })
      },
      setVisible: (v) => { if (tiffEntity) tiffEntity.show = v },
    })
  } catch (err) { console.error('加载 COGTiff 失败:', err) }

  // 倾斜摄影模型
  obliqueTileset = await loadTileset('/terra_osgbs-3dtiles/tileset.json')
  if (obliqueTileset) { applyObliqueOffset(obliqueTileset); viewer.flyTo(obliqueTileset) }
  registerLayer({
    name: '倾斜摄影模型', key: 'oblique', visible: true, loading: false, loaded: !!obliqueTileset,
    flyTo: () => { if (obliqueTileset) viewer?.flyTo(obliqueTileset) },
    setVisible: (v) => { if (obliqueTileset) obliqueTileset.show = v },
  })

  // 3DGS 模型
  gsTileset = await loadTileset('/zju_big-3dtiles/tileset.json')
  registerLayer({
    name: '3DGS 模型', key: '3dgs', visible: true, loading: false, loaded: !!gsTileset,
    flyTo: () => { if (gsTileset) viewer?.flyTo(gsTileset) },
    setVisible: (v) => { if (gsTileset) gsTileset.show = v },
  })

  // 地表控制点
  let surfaceGcpDs: Cesium.CustomDataSource | null = null
  try {
    const resp = await fetch('/geojson/surface-gcp.json')
    const json = await resp.json()
    surfaceGcpDs = new Cesium.CustomDataSource('surface-gcp')
    json.points.forEach((pt: any) => {
      surfaceGcpDs!.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, pt.height || 0),
        point: {
          color: Cesium.Color.ROYALBLUE, pixelSize: 12,
          outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: pt.id, font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    })
    viewer.dataSources.add(surfaceGcpDs)
  } catch (err) { console.error('加载地表控制点失败:', err) }
  registerLayer({
    name: '地表控制点', key: 'surface-gcp', visible: true, loading: false, loaded: !!surfaceGcpDs,
    flyTo: () => { if (surfaceGcpDs) viewer?.flyTo(surfaceGcpDs) },
    setVisible: (v) => { if (surfaceGcpDs) surfaceGcpDs.show = v },
  })

  // 模型控制点
  let modelDs: Cesium.GeoJsonDataSource | null = null
  if (gsTileset) { modelDs = await loadModelGcp(gsTileset) }
  registerLayer({
    name: '模型控制点', key: 'model-gcp', visible: true, loading: false, loaded: !!modelDs,
    flyTo: () => { if (modelDs) viewer?.flyTo(modelDs) },
    setVisible: (v) => { if (modelDs) modelDs.show = v },
  })

  // 点击 → COG 光谱查询
  viewer.screenSpaceEventHandler.setInputAction(async (click: any) => {
    const cartesian = viewer!.camera.pickEllipsoid(click.position, viewer!.scene.globe.ellipsoid)
    if (!cartesian) { store.spectralData = null; return }

    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    const lon = Cesium.Math.toDegrees(carto.longitude)
    const lat = Cesium.Math.toDegrees(carto.latitude)
    const rect = getTiffRect()

    // 只响应 COG 区域内的点击
    if (lon < rect.west || lon > rect.east || lat < rect.south || lat > rect.north) return

    const result = await queryPixel(lon, lat, rect)
    if (result) {
      store.spectralData = {
        lon, lat,
        bands: result.allBands.bands,
        values: result.allBands.values,
      }
      console.log(`[COG] 查询 (${result.pixelX}, ${result.pixelY}): ${result.allBands.values.length} 波段, 当前值 ${result.currentValue}`)
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  ;(window as any).viewer = viewer
  ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
})

// COG 渲染参数变化
watch(
  () => [store.tiff.band, store.tiff.colorScale, store.tiff.domainMin, store.tiff.domainMax],
  () => { renderCog() },
)
// COG 偏移变化
watch(
  () => [store.tiffOffset.lon, store.tiffOffset.lat, store.tiffOffset.gsd],
  () => { renderCog() },
)

// 分屏对比
watch(() => store.splitMode, (enabled) => {
  if (!obliqueTileset || !gsTileset) return
  const o = obliqueTileset as any; const g = gsTileset as any
  if (enabled) { o.splitDirection = -1; g.splitDirection = 1; o.splitPosition = 0.5; g.splitPosition = 0.5 }
  else { o.splitDirection = 0; g.splitDirection = 0 }
})

onUnmounted(() => {
  if (viewer) { viewer.destroy(); store.viewer = null; store.layers.splice(0); viewer = null }
})
</script>

<template>
  <div ref="mapContainer" class="cesium-map" />
</template>

<style scoped>
.cesium-map { width: 100%; height: 100%; overflow: hidden; }
</style>
