<script setup lang="ts">
import CesiumMap from './components/CesiumMap.vue'
import LayerPanel from './components/LayerPanel.vue'
</script>

<template>
  <CesiumMap />
  <LayerPanel />
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
