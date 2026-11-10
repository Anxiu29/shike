<script setup lang="ts">
import type { AssistantNutrition } from '@shike/shared'
import { assistantEnergyLabel } from '../lib/meal-assistant'
import { numberLabel } from '../lib/dates'
defineProps<{ nutrition: AssistantNutrition }>()
</script>
<template>
  <section class="assistant-nutrition" data-testid="assistant-nutrition" aria-label="本地热量计算结果">
    <p class="assistant-nutrition-heading">{{ nutrition.scope === 'estimate' ? '仅估算 · 不会记入饮食' : nutrition.scope === 'saved' ? '已保存的一餐' : '本餐热量估算' }}<span v-if="nutrition.mode === 'mock'"> · 模拟数据</span></p>
    <strong class="assistant-nutrition-total">{{ assistantEnergyLabel(nutrition) }}</strong>
    <ul class="assistant-nutrition-items">
      <li v-for="(item, index) in nutrition.items" :key="index"><div><span>{{ item.name }}</span><small>{{ item.portion }}</small></div><span>{{ item.energyKcal === null ? '热量待补充' : `约 ${numberLabel(item.energyKcal)} kcal` }}</span></li>
    </ul>
    <details class="assistant-nutrition-sources"><summary>查看计算依据</summary><div v-for="(item, index) in nutrition.items" :key="index"><b>{{ item.name }}</b><p>{{ item.source || '营养来源待补充' }}</p><p v-for="(assumption, number) in item.assumptions" :key="number">{{ assumption }}</p></div><p>按本地资料和上述份量换算；参考份量、配方和实际做法可能不同。缺失营养不当作0。</p></details>
  </section>
</template>
