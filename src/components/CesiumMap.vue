<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as Cesium from 'cesium'
import { getMapStore, type LayerItem } from '../stores/mapStore'
import { initCogReader, readBand, renderToCanvas, readPixelAllBands } from '../utils/cogRenderer'

const mapContainer = ref<HTMLDivElement>()
let viewer: Cesium.Viewer | null = null
let tiffEntity: Cesium.Entity | null = null
let tiffRect: { west: number; south: number; east: number; north: number } | null = null
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

/** 获取 COG 当前的地理矩形 */
function getTiffRect() {
  const { lon, lat, gsd } = store.tiffOffset
  const cosLat = Math.cos(lat * Math.PI / 180)
  const w = 5509 * gsd / cosLat
  const h = 1306 * gsd
  return {
    west: lon - w / 2,
    east: lon + w / 2,
    south: lat - h / 2,
    north: lat + h / 2,
  }
}

/** 从 GeoJSON 加载控制点 */
async function loadGeoJsonPoints(url: string, color: Cesium.Color, _label: string): Promise<Cesium.GeoJsonDataSource | null> {
  if (!viewer) return null
  try {
    const dataSource = await Cesium.GeoJsonDataSource.load(url, {
      clampToGround: true,
      markerSize: 0,
    })
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

// ---------- 高光谱渲染（用 Entity Rectangle + 影像材质） ----------

async function applyTiffRender() {
  if (!viewer) return
  const s = store.tiff
  const rect = getTiffRect()
  tiffRect = rect

  const result = await readBand(s.band)
  if (!result) {
    console.warn('[COG] 无数据，跳过渲染')
    return
  }

  const canvas = renderToCanvas(result.data, result.width, result.height, s.domainMin, s.domainMax, s.colorScale)
  if (!canvas) {
    console.error('[COG] Canvas 渲染失败')
    return
  }

  // 移除旧 entity
  if (tiffEntity) {
    viewer.entities.remove(tiffEntity)
  }

  // 创建新 entity（矩形贴地，WGS84 严格定位）
  tiffEntity = viewer.entities.add({
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north),
      material: new Cesium.ImageMaterialProperty({
        image: canvas.toDataURL('image/png'),
        transparent: true,
      }),
      height: 0,
    },
  })
  console.log('[COG] 渲染完成', JSON.stringify(rect))
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

  // 3. 高德卫星底图（Web Mercator）
  const gaodeProvider = new Cesium.UrlTemplateImageryProvider({
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    credit: '高德卫星影像',
    minimumLevel: 0,
    maximumLevel: 18,
  })
  viewer.imageryLayers.addImageryProvider(gaodeProvider)

  // 4. COGTiff 高光谱影像（用 geotiff 读数据 + SingleTileImageryProvider 定位）
  try {
    await initCogReader('/cog/final-cog.tif')

    // 初次加载自动计算 domain（不传固定值域）
    const initialData = await readBand(1)
    if (initialData) {
      store.tiff.domainMin = initialData.min
      store.tiff.domainMax = initialData.max
    }

    await applyTiffRender()
    registerLayer({
      name: '高光谱影像',
      key: 'tiff',
      visible: true,
      loading: false,
      loaded: true,
      flyTo: () => {
        if (tiffRect) {
          const dest = Cesium.Cartesian3.fromDegrees(
            (tiffRect.west + tiffRect.east) / 2,
            (tiffRect.north + tiffRect.south) / 2,
            2000,
          )
          viewer?.camera.flyTo({ destination: dest })
        }
      },
      setVisible: (v) => { if (tiffEntity) tiffEntity.show = v },
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

  // 7. 地表控制点（蓝色，WGS84 贴地）
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

  // 8. 模型控制点（红色，经 3DGS 矩阵 → ECEF → WGS84 转换后贴地）
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

  // 9. 点击地图 → 光谱曲线（使用 cogRenderer 直接读取）
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

    const rect = getTiffRect()
    if (lon < rect.west || lon > rect.east || lat < rect.south || lat > rect.north) return

    try {
      const result = await readPixelAllBands(lon, lat, rect)
      if (result) {
        store.spectralData = {
          lon, lat,
          bands: result.bands,
          values: result.values,
        }
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

// 高光谱参数变化 → 重新渲染
watch(
  () => [store.tiff.band, store.tiff.colorScale, store.tiff.domainMin, store.tiff.domainMax],
  () => { applyTiffRender() },
)

// 偏移变化 → 重新渲染
watch(
  () => [store.tiffOffset.lon, store.tiffOffset.lat, store.tiffOffset.gsd],
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
