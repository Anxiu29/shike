/**
 * 学习入口：index.html 的 #app → createApp(App) → App.vue → views/components。
 * 本文件只挂载应用和全局样式；页面状态、数据读取、保存后的刷新由 App.vue 协调。
 * Vite 负责开发时编译 .vue；浏览器最终执行的是构建后的 JavaScript。
 */
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './personal-foods.css'
import './diary-refresh.css'
import './camera-fullscreen.css'
import './settings.css'

createApp(App).mount('#app')
