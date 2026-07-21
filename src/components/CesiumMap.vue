<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import TIFFImageryProvider from 'tiff-imagery-provider'
import { getMapStore, type LayerItem } from '../stores/mapStore'

const mapContainer = ref<HTMLDivElement>()
let viewer: Cesium.Viewer | null = null
let tiffProvider: TIFFImageryProvider | null = null
let tiffLayer: Cesium.ImageryLayer | null = null
let obliqueTileset: Cesium.Cesium3DTileset | null = null
let gsTileset: Cesium.Cesium3DTileset | null = null
const store = getMapStore()

async function loadTileset(url: string): Promise<Cesium.Cesium3DTileset | null> {
  if (!viewer) return null
  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url)
    viewer.scene.primitives.add(tileset)
    return tileset
  } catch (err) { console.error('加载 3D Tiles 失败:', err); return null }
}

function registerLayer(item: LayerItem) { store.layers.push(item) }

// 倾斜模型 ENU 偏移
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
      features.push({
        type: 'Feature', properties: { id: pt.id },
        geometry: { type: 'Point', coordinates: [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude), carto.height] },
      })
    }
    const dataSource = await Cesium.GeoJsonDataSource.load({ type: 'FeatureCollection', features }, { clampToGround: true, markerSize: 0 })
    dataSource.entities.values.forEach(e => {
      e.billboard = undefined
      e.point = new Cesium.PointGraphics({
        color: Cesium.Color.RED, pixelSize: 10, outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
      if (e.properties?.id) e.label = new Cesium.LabelGraphics({
        text: e.properties.id.getValue(), font: '12px sans-serif', fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -15),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
    })
    viewer.dataSources.add(dataSource)
    return dataSource
  } catch (err) { console.error('加载模型控制点失败:', err); return null }
}

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

  // Esri 底图
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri World Imagery', minimumLevel: 0, maximumLevel: 19,
  }))

  // COG 高光谱（TIFFImageryProvider 默认加载，无地理参考时包裹全球）
  try {
    tiffProvider = await TIFFImageryProvider.fromUrl('/cog/final-cog.tif', {
      enablePickFeatures: true,
      renderOptions: { single: { band: 1, colorScale: 'viridis', domain: [0, 0.05] } },
    })
    store.tiff.domainMin = 0; store.tiff.domainMax = 0.05
    tiffLayer = viewer.imageryLayers.addImageryProvider(tiffProvider as unknown as Cesium.ImageryProvider)
    registerLayer({
      name: '高光谱影像', key: 'tiff', visible: true, loading: false, loaded: true,
      flyTo: () => { if (tiffProvider?.ready) viewer?.camera.flyToBoundingSphere(tiffProvider.rectangle as any) },
      setVisible: (v) => { if (tiffLayer) tiffLayer.show = v },
    })
  } catch (err) { console.error('加载 COGTiff 失败:', err) }

  // 倾斜摄影
  obliqueTileset = await loadTileset('/terra_osgbs-3dtiles/tileset.json')
  if (obliqueTileset) { applyObliqueOffset(obliqueTileset); viewer.flyTo(obliqueTileset) }
  registerLayer({
    name: '倾斜摄影模型', key: 'oblique', visible: true, loading: false, loaded: !!obliqueTileset,
    flyTo: () => { if (obliqueTileset) viewer?.flyTo(obliqueTileset) },
    setVisible: (v) => { if (obliqueTileset) obliqueTileset.show = v },
  })

  // 3DGS
  gsTileset = await loadTileset('/zju_big-3dtiles/tileset.json')
  registerLayer({
    name: '3DGS 模型', key: '3dgs', visible: true, loading: false, loaded: !!gsTileset,
    flyTo: () => { if (gsTileset) viewer?.flyTo(gsTileset) },
    setVisible: (v) => { if (gsTileset) gsTileset.show = v },
  })

  // 地表控制点
  let surfaceGcpDs: Cesium.CustomDataSource | null = null
  try {
    const resp = await fetch('/geojson/surface-gcp.json'); const json = await resp.json()
    surfaceGcpDs = new Cesium.CustomDataSource('surface-gcp')
    json.points.forEach((pt: any) => {
      surfaceGcpDs!.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, pt.height || 0),
        point: { color: Cesium.Color.ROYALBLUE, pixelSize: 12, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: pt.id, font: '12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
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
  if (gsTileset) modelDs = await loadModelGcp(gsTileset)
  registerLayer({
    name: '模型控制点', key: 'model-gcp', visible: true, loading: false, loaded: !!modelDs,
    flyTo: () => { if (modelDs) viewer?.flyTo(modelDs) },
    setVisible: (v) => { if (modelDs) modelDs.show = v },
  })

  // 点击 → 控制点查询 / 光谱曲线
  viewer.screenSpaceEventHandler.setInputAction(async (click: any) => {
    // 先尝试拾取实体（控制点）
    const picked = viewer!.scene.pick(click.position)
    if (Cesium.defined(picked) && picked.id && picked.id instanceof Cesium.Entity) {
      const entity = picked.id
      const pos = entity.position?.getValue(Cesium.JulianDate.now())
      if (pos) {
        const carto = Cesium.Cartographic.fromCartesian(pos)
        const lon = Cesium.Math.toDegrees(carto.longitude)
        const lat = Cesium.Math.toDegrees(carto.latitude)
        const height = carto.height

        // 判断控制点类型：有 properties.id 为模型控制点，否则为地表控制点
        let id = ''
        let type: '地表控制点' | '模型控制点' = '地表控制点'
        if (entity.properties?.id) {
          id = entity.properties.id.getValue()
          type = '模型控制点'
        } else if (entity.label?.text) {
          id = entity.label.text.getValue()
        }
        store.controlPointInfo = { id, lon, lat, height, type }
        return
      }
    }

    // 没有拾取到实体 → 清空控制点弹窗
    store.controlPointInfo = null

    // 尝试光谱查询
    const cartesian = viewer!.camera.pickEllipsoid(click.position, viewer!.scene.globe.ellipsoid)
    if (!cartesian) { store.spectralData = null; return }
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    const lon = Cesium.Math.toDegrees(carto.longitude)
    const lat = Cesium.Math.toDegrees(carto.latitude)

    if (!tiffProvider?.ready) return
    try {
      const rect = tiffProvider.rectangle
      const imgW = 5509, imgH = 1306
      const pixelX = Math.round(((lon - rect.west) / (rect.east - rect.west) % 1 + 1) % 1 * imgW)
      const pixelY = Math.round(((lat - rect.south) / (rect.north - rect.south) % 1 + 1) % 1 * imgH)

      const level = Math.min(tiffProvider.maximumLevel, 14)
      const tileXY = tiffProvider.tilingScheme.positionToTileXY(carto, level)
      const features = await tiffProvider.pickFeatures(Math.floor(tileXY.x), Math.floor(tileXY.y), level, lon, lat)
      if (features?.length) {
        const props = (features[0] as any).properties || {}
        const entries = Object.entries(props).map(([k, v]) => [parseInt(k.replace(/\D/g, '')), v] as const).filter(([n]) => !isNaN(n))
        entries.sort((a, b) => a[0] - b[0])
        const bands = entries.map(e => e[0])
        const values = entries.map(e => e[1] as number)
        const currentBand = store.tiff.band
        const idx = bands.indexOf(currentBand)
        store.spectralData = { lon, lat, pixelX, pixelY, currentValue: idx >= 0 ? values[idx] : values[0], bands, values }
      }
    } catch (err) { console.error('光谱点选失败:', err) }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  ;(window as any).viewer = viewer
  ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
})

// 高光谱应用渲染配置 — 重建 TIFFImageryProvider（不修改原始文件）
watch(() => store.tiffApplyVersion, async () => {
  if (!viewer) return
  const s = store.tiff
  // 移除旧图层和 provider
  if (tiffLayer) { viewer.imageryLayers.remove(tiffLayer); tiffLayer = null }
  if (tiffProvider) { tiffProvider.destroy(); tiffProvider = null }
  // 用面板参数重建
  try {
    tiffProvider = await TIFFImageryProvider.fromUrl('/cog/final-cog.tif', {
      enablePickFeatures: true,
      renderOptions: { single: { band: s.band, colorScale: s.colorScale as any, domain: [s.domainMin, s.domainMax] } },
    })
    tiffLayer = viewer.imageryLayers.addImageryProvider(tiffProvider as unknown as Cesium.ImageryProvider)
    console.log('[TIFF] 重建成功', s)
  } catch (err) { console.error('[TIFF] 重建失败:', err) }
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
