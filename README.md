# 多源 WebGIS 可视化平台

基于 **Vite + Vue3 + TypeScript + Cesium** 的多源地理空间数据可视化平台，支持倾斜摄影、3DGS 点云、高光谱影像、控制点等多源数据的叠加显示与交互分析。

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

启动后在浏览器打开 `http://localhost:5173`。

## 数据准备

将以下数据按结构放入 `public/` 目录（原始数据老师已有）：

```
public/
├── cog/
│   └── final-cog.tif              # 151 波段 COGTiff 高光谱影像
│
├── terra_osgbs-3dtiles/
│   ├── tileset.json                # 倾斜摄影 3D Tiles 入口
│   └── Data/                       # 倾斜摄影瓦片数据
│       ├── BlockRX/
│       └── BlockRA/
│
├── zju_big-3dtiles/
│   ├── tileset.json                # 3DGS 3D Tiles 入口
│   ├── tiles/                      # 3DGS 瓦片数据
│   └── Point/                      # 点云数据
│
└── geojson/
    ├── surface-gcp.json            # 地表控制点（WGS-84 经纬度）
    └── model-gcp.json              # 模型控制点（局部坐标系）
```

### 数据说明

| 数据 | 格式 | 坐标系 | 说明 |
|------|------|--------|------|
| 高光谱影像 | COGTiff, Float32, 151 波段 | 无地理参考（TIFFImageryProvider 自动包裹全球） | 5509×1306 像素 |
| 倾斜摄影模型 | 3D Tiles v1.0 | ECEF（transform 矩阵定位） | gltfUpAxis=Z |
| 3DGS 模型 | 3D Tiles v1.1 | ECEF（transform 矩阵定位） | 带 Point 点云 |
| 地表控制点 | JSON（自定义格式） | WGS-84 经纬度 | 5 个点，blue |
| 模型控制点 | JSON（自定义格式） | 局部坐标（通过 3DGS transform 矩阵转 ECEF） | 5 个点，red |

### 坐标系说明

- **底图**: Esri World Imagery — WGS-84 / Web Mercator（EPSG:3857）
- **倾斜摄影模型**: 通过 tileset.json 内 ECEF transform 矩阵定位，经 ENU 偏移校正
- **3DGS 模型**: 通过 tileset.json 内 ECEF transform 矩阵定位
- **地表控制点**: WGS-84 经纬度，CLAMP_TO_GROUND 贴地
- **模型控制点**: 局部坐标 → 3DGS 模型 transform 矩阵 → ECEF → WGS-84

## 功能列表

### 图层控制（右侧面板）
- 倾斜摄影模型：显隐切换、定位飞行
- 3DGS 模型：显隐切换、定位飞行
- 高光谱影像：显隐切换、定位飞行
- 地表控制点（蓝色）：显隐切换、定位飞行
- 模型控制点（红色）：显隐切换、定位飞行

### 高光谱渲染
- 单波段渲染：波段选择、色带选择（viridis/inferno/turbo 等 17 种）、值域范围
- RGB 多波段合成：R/G/B 三通道独立波段选择、独立值域拉伸
- 模式切换：单波段 / RGB 单选切换
- 点击「应用渲染配置」按钮生效

### 光谱曲线查询
- 左键点击高光谱影像区域 → 读取 151 波段原始 Float32 值
- 显示：点击位置经纬度、像素坐标、当前波段数值
- ECharts 折线图：横轴波段号 1-151，纵轴 DN 值
- 红色临时标记点 + 经纬度标签
- 无有效数据时提示「该位置无有效高光谱像素」

### RTK 控制点查询
- 左键点击控制点 → 弹出信息卡片
- 显示：点编号、类型（地表/模型）、经度、纬度、高程
- 点击空白处或 ✕ 关闭

### 辅助功能
- 分屏对比（已撤销）
- 全局模型偏移（经度/纬度/高程，实时生效）—— 已撤销

## 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3 + TypeScript | 前端框架 |
| Vite | 构建工具 |
| Cesium | 3D 地球渲染 |
| tiff-imagery-provider | COGTiff 加载与渲染 |
| geotiff.js | COG 像素数据读取（光谱查询） |
| ECharts | 光谱曲线图表 |
| vite-plugin-cesium | Cesium 静态资源处理 |

## 项目结构

```
WebGIS/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/                       # 静态资源（数据文件）
│   ├── cog/final-cog.tif
│   ├── terra_osgbs-3dtiles/
│   ├── zju_big-3dtiles/
│   └── geojson/
└── src/
    ├── main.ts                   # 入口
    ├── App.vue                   # 根组件 + 控制点弹窗
    ├── stores/
    │   └── mapStore.ts           # 全局响应式状态
    ├── components/
    │   ├── CesiumMap.vue         # 地图组件（加载/渲染/交互）
    │   └── LayerPanel.vue        # 右侧图层面板
    └── utils/
        └── cogRenderer.ts        # COG 渲染工具（备用）
```
