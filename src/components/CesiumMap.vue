<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import TIFFImageryProvider from 'tiff-imagery-provider'
import { getMapStore, COLORSCALE_OPTIONS, type LayerItem } from '../stores/mapStore'

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

/** 注册图层到 store */
function registerLayer(item: LayerItem) {
  store.layers.push(item)
}

/** 从 GeoJSON 加载控制点 */
async function loadGeoJsonPoints(url: string, color: Cesium.Color, label: string): Promise<Cesium.GeoJsonDataSource | null> {
  if (!viewer) return null
  try {
    const dataSource = await Cesium.GeoJsonDataSource.load(url, {
      clampToGround: true,
      markerSize: 0,
    })
    // 自定义点样式
    dataSource.entities.values.forEach((entity) => {
      entity.billboard = undefined
      entity.point = new Cesium.PointGraphics({
        color,
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
    console.error(`加载控制点失败 ${url}:`, err)
    return null
  }
}

/** 加载模型控制点（local → ECEF → lon/lat 转换） */
async function loadModelGcp(tileset: Cesium.Cesium3DTileset): Promise<Cesium.GeoJsonDataSource | null> {
  if (!viewer) return null
  try {
    const resp = await fetch('/geojson/model-gcp.json')
    const json = await resp.json()
    const matrix = tileset.root.transform
    const positions: Cesium.Cartesian3[] = []

    const features: Record<string, any>[] = []
    for (const pt of json.points) {
      const local = Cesium.Cartesian3.fromElements(pt.local[0], pt.local[1], pt.local[2], new Cesium.Cartesian3())
      const ecef = Cesium.Matrix4.multiplyByPoint(matrix, local, new Cesium.Cartesian3())
      const carto = Cesium.Cartographic.fromCartesian(ecef)
      const lon = Cesium.Math.toDegrees(carto.longitude)
      const lat = Cesium.Math.toDegrees(carto.latitude)
      positions.push(ecef)
      features.push({
        type: 'Feature',
        properties: { id: pt.id },
        geometry: { type: 'Point', coordinates: [lon, lat, carto.height] },
      })
    }

    // 用 GeoJsonDataSource 统一样式
    const fc = { type: 'FeatureCollection', features }
    const dataSource = await Cesium.GeoJsonDataSource.load(fc, {
      clampToGround: true,
      markerSize: 0,
    })
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

  // 3. 高德卫星底图
  const gaodeProvider = new Cesium.UrlTemplateImageryProvider({
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    credit: '高德卫星影像',
    minimumLevel: 0,
    maximumLevel: 18,
  })
  viewer.imageryLayers.addImageryProvider(gaodeProvider)

  // 4. COGTiff 高光谱影像
  try {
    tiffProvider = await TIFFImageryProvider.fromUrl('/cog/final-cog.tif', {
      enablePickFeatures: true,
      renderOptions: {
        single: { band: 1, colorScale: 'viridis', domain: [0, 1] },
      },
    })
    // 读取实际波段统计值作为 domain 默认值
    const b1 = tiffProvider.bands?.[1]
    if (b1 && b1.min !== undefined && b1.max !== undefined) {
      store.tiff.domainMin = b1.min
      store.tiff.domainMax = b1.max
    }
    applyTiffRender()
    registerLayer({
      name: '高光谱影像',
      key: 'tiff',
      visible: true,
      loading: false,
      loaded: true,
      flyTo: () => {
        if (tiffProvider?.ready) viewer?.camera.flyToBoundingSphere(tiffProvider.rectangle as any)
      },
      setVisible: (v) => { if (tiffLayer) tiffLayer.show = v },
    })
  } catch (err) {
    console.error('加载 COGTiff 失败:', err)
  }

  // 5. 倾斜摄影模型
  obliqueTileset = await loadTileset('/terra_osgbs-3dtiles/tileset.json')
  if (obliqueTileset) {
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

  // 7. 地表控制点（蓝色）
  const surfaceDs = await loadGeoJsonPoints(
    '/geojson/surface-gcp.geojson',
    Cesium.Color.ROYALBLUE,
    '地表控制点',
  )
  registerLayer({
    name: '地表控制点',
    key: 'surface-gcp',
    visible: true,
    loading: false,
    loaded: !!surfaceDs,
    flyTo: () => { if (surfaceDs) viewer?.flyTo(surfaceDs) },
    setVisible: (v) => { if (surfaceDs) surfaceDs.show = v },
  })

  // 8. 模型控制点（红色）- 需要 3DGS 的 transform 做坐标转换
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
    const cartesian = viewer!.camera.pickEllipsoid(
      click.position,
      viewer!.scene.globe.ellipsoid,
    )
    if (!cartesian) {
      store.spectralData = null
      return
    }
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
        // 按波段号排序
        const sorted = bands.map((b, i) => ({ b, v: values[i] })).sort((a, b) => a.b - b.b)
        store.spectralData = {
          lon,
          lat,
          bands: sorted.map(s => s.b),
          values: sorted.map(s => s.v),
        }
      }
    } catch (err) {
      console.error('光谱点选失败:', err)
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // 10. 挂到 window 方便调试
  ;(window as any).viewer = viewer

  // 10. 隐藏水印
  ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
})

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

// ---------- 高光谱渲染参数 ----------

function applyTiffRender() {
  if (!viewer || !tiffProvider) return
  const s = store.tiff
  tiffProvider.renderOptions.single = {
    band: s.band,
    colorScale: s.colorScale as any,
    domain: [s.domainMin, s.domainMax],
  }
  // 移除旧层并重建，清空缓存使新参数生效
  const idx = tiffLayer ? viewer.imageryLayers.indexOf(tiffLayer) : -1
  if (tiffLayer) {
    viewer.imageryLayers.remove(tiffLayer)
  }
  tiffLayer = viewer.imageryLayers.addImageryProvider(
    tiffProvider as unknown as Cesium.ImageryProvider,
    idx >= 0 ? idx : undefined,
  )
}

watch(
  () => [store.tiff.band, store.tiff.colorScale, store.tiff.domainMin, store.tiff.domainMax],
  () => { applyTiffRender() },
)

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
