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

/** 刷新 COG 图层（重建清空缓存） */
function refreshTiffLayer() {
  if (!viewer || !tiffProvider) return
  const idx = tiffLayer ? viewer.imageryLayers.indexOf(tiffLayer) : -1
  if (tiffLayer) viewer.imageryLayers.remove(tiffLayer)
  tiffLayer = viewer.imageryLayers.addImageryProvider(
    tiffProvider as unknown as Cesium.ImageryProvider,
    idx >= 0 ? idx : undefined,
  )
}

// ---------- 倾斜摄影模型 ENU 偏移（固定值 -30, 20, 70） ----------

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
        type: 'Feature',
        properties: { id: pt.id },
        geometry: { type: 'Point', coordinates: [lon, lat, carto.height] },
      })
    }
    const fc = { type: 'FeatureCollection', features }
    const dataSource = await Cesium.GeoJsonDataSource.load(fc, { clampToGround: true, markerSize: 0 })
    dataSource.entities.values.forEach((entity) => {
      entity.billboard = undefined
      entity.point = new Cesium.PointGraphics({
        color: Cesium.Color.RED,
        pixelSize: 10,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      })
      if (entity.properties?.id) {
        entity.label = new Cesium.LabelGraphics({
          text: entity.properties.id.getValue(),
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        })
      }
    })
    viewer.dataSources.add(dataSource)
    return dataSource
  } catch (err) {
    console.error('加载模型控制点失败:', err)
    return null
  }
}

// ---------- 生命周期 ----------

onMounted(async () => {
  if (!mapContainer.value) return

  // 1. 初始化 Viewer
  viewer = new Cesium.Viewer(mapContainer.value, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    geocoder: false,
    infoBox: false,
    selectionIndicator: false,
    scene3DOnly: true,
    useDefaultRenderLoop: true,
  })
  store.viewer = viewer

  // 2. 清空默认图层
  viewer.imageryLayers.removeAll()

  // 3. Esri 卫星底图（WGS-84）
  const baseProvider = new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri World Imagery',
    minimumLevel: 0,
    maximumLevel: 19,
  })
  viewer.imageryLayers.addImageryProvider(baseProvider)

  // 4. COGTiff 高光谱影像
  try {
    // 必须传 domain，否则 provider 会尝试读取全分辨率数据计算统计值，
    // 对于 151 波段的 3.4GB COG 会导致长时间挂死
    tiffProvider = await TIFFImageryProvider.fromUrl('/cog/final-cog.tif', {
      enablePickFeatures: true,
      renderOptions: {
        single: { band: 1, colorScale: 'viridis', domain: [0, 0.05] },
      },
    })
    // 保存默认 domain 到 store
    store.tiff.domainMin = 0
    store.tiff.domainMax = 0.05
    // 更新 renderOptions
    applyTiffRender()
    // 定位到模型区域
    refreshTiffLayer()
    registerLayer({
      name: '高光谱影像',
      key: 'tiff',
      visible: true,
      loading: false,
      loaded: true,
      flyTo: () => { if (tiffProvider?.ready) viewer?.camera.flyToBoundingSphere(tiffProvider.rectangle as any) },
      setVisible: (v) => { if (tiffLayer) tiffLayer.show = v },
    })
  } catch (err) {
    console.error('加载 COGTiff 失败:', err)
  }

  // 5. 倾斜摄影模型（疑似 GCJ-02 坐标，需修正到 WGS-84）
  obliqueTileset = await loadTileset('/terra_osgbs-3dtiles/tileset.json')
  if (obliqueTileset) {
    applyObliqueOffset(obliqueTileset)
    viewer.flyTo(obliqueTileset)
  }
  registerLayer({
    name: '倾斜摄影模型',
    key: 'oblique',
    visible: true,
    loading: false,
    loaded: !!obliqueTileset,
    flyTo: () => { if (obliqueTileset) viewer?.flyTo(obliqueTileset) },
    setVisible: (v) => { if (obliqueTileset) obliqueTileset.show = v },
  })

  // 6. 3DGS 模型
  gsTileset = await loadTileset('/zju_big-3dtiles/tileset.json')
  registerLayer({
    name: '3DGS 模型',
    key: '3dgs',
    visible: true,
    loading: false,
    loaded: !!gsTileset,
    flyTo: () => { if (gsTileset) viewer?.flyTo(gsTileset) },
    setVisible: (v) => { if (gsTileset) gsTileset.show = v },
  })

  // 7. 地表控制点（蓝色，WGS-84）
  let surfaceGcpDs: Cesium.CustomDataSource | null = null
  try {
    const resp = await fetch('/geojson/surface-gcp.json')
    const json = await resp.json()
    surfaceGcpDs = new Cesium.CustomDataSource('surface-gcp')
    json.points.forEach((pt: any) => {
      surfaceGcpDs!.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, pt.height || 0),
        point: {
          color: Cesium.Color.ROYALBLUE,
          pixelSize: 12,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: pt.id,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    })
    viewer.dataSources.add(surfaceGcpDs)
  } catch (err) {
    console.error('加载地表控制点失败:', err)
  }
  registerLayer({
    name: '地表控制点',
    key: 'surface-gcp',
    visible: true,
    loading: false,
    loaded: !!surfaceGcpDs,
    flyTo: () => { if (surfaceGcpDs) viewer?.flyTo(surfaceGcpDs) },
    setVisible: (v) => { if (surfaceGcpDs) surfaceGcpDs.show = v },
  })

  // 8. 模型控制点（红色）
  let modelDs: Cesium.GeoJsonDataSource | null = null
  if (gsTileset) {
    modelDs = await loadModelGcp(gsTileset)
  }
  registerLayer({
    name: '模型控制点',
    key: 'model-gcp',
    visible: true,
    loading: false,
    loaded: !!modelDs,
    flyTo: () => { if (modelDs) viewer?.flyTo(modelDs) },
    setVisible: (v) => { if (modelDs) modelDs.show = v },
  })

  // 9. 点击地图 → 光谱曲线
  viewer.screenSpaceEventHandler.setInputAction(async (click: any) => {
    const cartesian = viewer!.camera.pickEllipsoid(click.position, viewer!.scene.globe.ellipsoid)
    if (!cartesian) { store.spectralData = null; return }
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    const lon = Cesium.Math.toDegrees(carto.longitude)
    const lat = Cesium.Math.toDegrees(carto.latitude)
    if (!tiffProvider) return
    try {
      const level = Math.min(tiffProvider.maximumLevel, 14)
      const tileXY = tiffProvider.tilingScheme.positionToTileXY(carto, level)
      const tx = Math.floor(Math.max(0, tileXY.x))
      const ty = Math.floor(Math.max(0, tileXY.y))
      const features = await tiffProvider.pickFeatures(tx, ty, level, lon, lat)
      if (features?.length) {
        const props = (features[0] as any).properties
        const bands: number[] = []
        const values: number[] = []
        for (const [key, val] of Object.entries(props)) {
          const num = parseInt(key.replace(/\D/g, ''))
          if (!isNaN(num) && typeof val === 'number') {
            bands.push(num)
            values.push(val)
          }
        }
        const sorted = bands.map((b, i) => ({ b, v: values[i] })).sort((a, b) => a.b - b.b)
        store.spectralData = { lon, lat, bands: sorted.map(s => s.b), values: sorted.map(s => s.v) }
      }
    } catch (err) {
      console.error('光谱点选失败:', err)
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // 10. 挂到 window
  ;(window as any).viewer = viewer

  // 11. 隐藏水印
  ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
})

// ---------- 高光谱渲染参数 ----------

function applyTiffRender() {
  if (!tiffProvider) return
  const s = store.tiff
  tiffProvider.renderOptions.single = {
    band: s.band,
    colorScale: s.colorScale as any,
    domain: [s.domainMin, s.domainMax],
  }
}

// 渲染参数变化 → 更新 provider
watch(
  () => [store.tiff.band, store.tiff.colorScale, store.tiff.domainMin, store.tiff.domainMax],
  () => {
    applyTiffRender()
    refreshTiffLayer()  // 重建图层使新参数生效
  },
)

// 偏移变化 → 重定位
watch(
  () => [store.tiffOffset.lon, store.tiffOffset.lat, store.tiffOffset.gsd],
  () => { refreshTiffLayer() },
)

// ---------- 分屏对比 ----------

watch(() => store.splitMode, (enabled) => {
  if (!obliqueTileset || !gsTileset) return
  const o = obliqueTileset as any
  const g = gsTileset as any
  if (enabled) {
    o.splitDirection = -1
    g.splitDirection = 1
    o.splitPosition = 0.5
    g.splitPosition = 0.5
  } else {
    o.splitDirection = 0
    g.splitDirection = 0
  }
})

onUnmounted(() => {
  if (viewer) {
    viewer.destroy()
    store.viewer = null
    store.layers.splice(0)
    ;(window as any).viewer = undefined
    viewer = null
  }
})
</script>

<template>
  <div ref="mapContainer" class="cesium-map" />
</template>

<style scoped>
.cesium-map {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
