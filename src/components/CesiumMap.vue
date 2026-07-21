<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as Cesium from 'cesium'
import TIFFImageryProvider from 'tiff-imagery-provider'

const mapContainer = ref<HTMLDivElement>()
let viewer: Cesium.Viewer | null = null

// 响应式 tileset 实例，方便控制显隐
const tilesetOblique = ref<Cesium.Cesium3DTileset | null>(null)
const tileset3dgs = ref<Cesium.Cesium3DTileset | null>(null)

// COGTiff 图层实例
const tiffProvider = ref<TIFFImageryProvider | null>(null)
const tiffLayer = ref<Cesium.ImageryLayer | null>(null)

/** 异步加载 3D Tiles 并添加到场景 */
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

  // 2. 清空所有默认图层
  viewer.imageryLayers.removeAll()

  // 3. 手动添加高德卫星影像
  const gaodeProvider = new Cesium.UrlTemplateImageryProvider({
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    credit: '高德卫星影像',
    minimumLevel: 0,
    maximumLevel: 18,
  })
  viewer.imageryLayers.addImageryProvider(gaodeProvider)

  // 4. 加载 COGTiff 高光谱影像
  try {
    tiffProvider.value = await TIFFImageryProvider.fromUrl('/cog/final-cog.tif', {
      enablePickFeatures: true,
      renderOptions: {
        single: {
          band: 1,
          colorScale: 'viridis',
          domain: [0, 255],
        },
      },
    })
    tiffLayer.value = viewer.imageryLayers.addImageryProvider(tiffProvider.value)
  } catch (err) {
    console.error('加载 COGTiff 失败:', err)
  }

  // 5. 加载倾斜摄影模型，加载完成后自动定位
  tilesetOblique.value = await loadTileset('/terra_osgbs-3dtiles/tileset.json')
  if (tilesetOblique.value) {
    viewer.flyTo(tilesetOblique.value)
  }

  // 6. 加载 3DGS 模型
  tileset3dgs.value = await loadTileset('/zju_big-3dtiles/tileset.json')

  // 7. 挂载到 window，方便控制台调试
  ;(window as any).viewer = viewer
  ;(window as any).tilesetOblique = tilesetOblique
  ;(window as any).tileset3dgs = tileset3dgs
  ;(window as any).tiffProvider = tiffProvider
  ;(window as any).tiffLayer = tiffLayer

  // 8. 隐藏 Cesium 水印
  ;(viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none'
})

onUnmounted(() => {
  if (viewer) {
    viewer.destroy()
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
