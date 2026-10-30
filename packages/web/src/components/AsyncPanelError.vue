<script setup lang="ts">
// 由用户决定刷新，不自动重载，以免丢失其它页面尚未保存的内容。
function reload() { window.location.reload() }
</script>

<template>
  <section class="notice danger" role="alert" data-testid="async-panel-error">
    <p>内容加载失败，可能是网络中断或应用已更新。请刷新后重试；刷新会丢失未保存的内容。</p>
    <button type="button" class="button secondary" @click="reload">刷新重试</button>
  </section>
</template>
