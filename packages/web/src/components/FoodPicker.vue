<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Check, ChevronRight, Plus, Search, SlidersHorizontal, Sparkles, X } from '@lucide/vue'
import type { EstimatedFood, FoodEntry } from '@shike/shared'
import { buildFoodChoices, categorySymbols, isEverydayFood, pickerCategories, recommendFoodChoices, searchFoodChoices, type FoodChoice, type FoodMatchContext } from '../lib/food-picker'
import { numberLabel, rangeLabel } from '../lib/dates'

const props = defineProps<{ entry: FoodEntry; selectedId: string; personalFoods: EstimatedFood[]; aiCandidate?: FoodEntry; recognition?: FoodMatchContext; mock?: boolean }>()
const emit = defineEmits<{ close: []; select: [id: string] }>()
const query = ref(''), category = ref('全部'), visibleCount = ref(60), includeIngredients = ref(false)
const dialog = ref<HTMLElement | null>(null), search = ref<HTMLInputElement | null>(null), closeButton = ref<HTMLButtonElement | null>(null), list = ref<HTMLElement | null>(null)
const allChoices = computed(() => buildFoodChoices(props.personalFoods, props.aiCandidate, { entry: props.entry, selectedId: props.selectedId }))
// 历史已选的生重条目仍可见，隐藏选项不改写历史，也不删除配方需要的原料。
const choices = computed(() => allChoices.value.filter(choice => includeIngredients.value || isEverydayFood(choice) || choice.id === props.selectedId))
const categories = computed(() => pickerCategories.map(name => ({ name, count: name === '全部' ? choices.value.length : choices.value.filter(choice => choice.category === name).length })).filter(item => item.count > 0))
const results = computed(() => searchFoodChoices(choices.value, query.value, category.value))
const recommendations = computed(() => recommendFoodChoices(choices.value, props.recognition ?? { name: props.entry.name, visibleIngredients: [] }))
const shown = computed(() => results.value.slice(0, visibleCount.value))
const showRecommendations = computed(() => !query.value.trim() && category.value === '全部' && recommendations.value.length > 0)

watch([query, category, includeIngredients], () => { visibleCount.value = 60; list.value?.scrollTo?.({ top: 0 }) })
onMounted(() => nextTick(() => (window.innerWidth >= 768 ? search.value : closeButton.value)?.focus()))
function calories(choice: FoodChoice) { return choice.energyRange ? `${rangeLabel(choice.energyRange)} kcal` : choice.nutrientsPer100g.energyKcal === null ? '热量待补充' : `约 ${numberLabel(choice.nutrientsPer100g.energyKcal)} kcal` }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab') return
  const elements = [...dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []].filter(element => element.getClientRects().length > 0)
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>

<template>
  <Teleport to="body">
    <div class="food-picker-overlay" @click.self="emit('close')" @keydown.stop="keydown">
      <section ref="dialog" class="food-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="food-picker-title" aria-describedby="food-picker-description" data-testid="food-picker">
        <header class="food-picker-header">
          <button ref="closeButton" type="button" class="icon-button picker-back" aria-label="返回饮食编辑" data-testid="close-food-picker" @click="emit('close')"><ArrowLeft :size="21" /></button>
          <div><span class="eyebrow">找到更符合这一餐的食物</span><h2 id="food-picker-title">选择食物</h2></div>
          <span class="picker-count">{{ choices.length }} 项可选</span>
          <button type="button" class="icon-button picker-desktop-close" aria-label="关闭食物选择" @click="emit('close')"><X :size="21" /></button>
        </header>
        <div class="food-picker-search-area">
          <label class="food-picker-search"><Search :size="19" /><span class="sr-only">搜索食物</span><input ref="search" v-model="query" type="search" data-testid="food-picker-search" placeholder="搜索食物、别名或配料，如：米饭、番茄" autocomplete="off" maxlength="100" /><button v-if="query" type="button" class="icon-button small" aria-label="清空搜索" data-testid="clear-food-search" @click="query = ''; search?.focus()"><X :size="15" /></button></label>
          <p id="food-picker-description"><Sparkles :size="14" /><span><template v-if="mock"><strong>模拟数据</strong> · </template><template v-if="recognition">{{ mock ? '示例食物' : 'AI 识别' }}：<strong>{{ recognition.name }}</strong><template v-if="recognition.visibleIngredients.length"> · 可见{{ recognition.visibleIngredients.slice(0, 3).join('、') }}</template></template><template v-else>{{ entry.name ? `当前食物：${entry.name}` : '按分类浏览，或搜索你吃下的食物' }}</template></span></p>
          <div class="food-picker-filter"><span>默认查看熟食与即食食物</span><label><input v-model="includeIngredients" data-testid="include-raw-ingredients" type="checkbox" /> 包含生重／干重食材</label></div>
        </div>
        <div class="food-picker-body">
          <nav class="food-picker-categories" aria-label="食物分类"><button v-for="item in categories" :key="item.name" type="button" :aria-pressed="category === item.name" :class="{ active: category === item.name }" :data-testid="`food-category-${item.name}`" @click="category = item.name"><span>{{ item.name }}</span><small>{{ item.count }}</small></button></nav>
          <div ref="list" class="food-picker-content">
            <section v-if="showRecommendations" class="food-recommendations" data-testid="food-recommendations" aria-labelledby="food-recommendations-title">
              <div class="picker-section-heading"><div><h3 id="food-recommendations-title"><Sparkles :size="16" /> 与这一餐相近</h3><p>按名称和配料匹配，请核对做法与生熟状态</p></div></div>
              <div class="food-recommendation-grid"><button v-for="item in recommendations" :key="item.choice.id" type="button" class="food-recommendation" :class="{ selected: selectedId === item.choice.id }" :aria-pressed="selectedId === item.choice.id" :data-testid="`food-recommendation-${item.choice.id}`" @click="emit('select', item.choice.id)"><span class="food-choice-symbol" aria-hidden="true">{{ categorySymbols[item.choice.category] ?? '🍽️' }}</span><Check v-if="selectedId === item.choice.id" class="food-choice-check" :size="15" /><strong>{{ item.choice.name }}</strong><span class="food-choice-description">{{ item.choice.description }}</span><span class="food-choice-energy">{{ calories(item.choice) }}<small> / 100 g</small></span><span class="food-recommendation-reason">{{ item.reason }}</span></button></div>
            </section>
            <section aria-labelledby="food-results-title">
              <div class="picker-section-heading"><h3 id="food-results-title"><SlidersHorizontal :size="15" /> {{ query.trim() ? '搜索结果' : category === '全部' ? '全部食物' : category }}</h3><span role="status" aria-live="polite" data-testid="food-result-count">{{ results.length }} 项</span></div>
              <div v-if="!shown.length" class="food-search-empty" data-testid="food-search-empty"><Search :size="30" /><h3>没有找到合适的食物</h3><p>试试更短的名称、常用别名，<br />或切换到“全部”分类。</p><button v-if="category !== '全部'" type="button" class="text-button" @click="category = '全部'">搜索全部分类 <ChevronRight :size="14" /></button></div>
              <div v-else class="food-choice-list"><button v-for="choice in shown" :key="choice.id" type="button" class="food-choice-row" :class="{ selected: selectedId === choice.id }" :aria-pressed="selectedId === choice.id" :data-testid="`food-option-${choice.id}`" @click="emit('select', choice.id)"><span class="food-choice-symbol" aria-hidden="true">{{ categorySymbols[choice.category] ?? '🍽️' }}</span><span class="food-choice-text"><strong>{{ choice.name }}</strong><span>{{ choice.description }}</span></span><span class="food-choice-energy">{{ calories(choice) }}<small>每 100 g</small></span><span class="food-choice-indicator"><Check v-if="selectedId === choice.id" :size="18" /><Plus v-else :size="17" /></span></button></div>
              <button v-if="shown.length < results.length" type="button" class="button secondary full food-load-more" data-testid="food-load-more" @click="visibleCount += 60">继续查看 · 还有 {{ results.length - shown.length }} 项</button>
            </section>
          </div>
        </div>
        <footer class="food-picker-footer"><span>没有合适的？也可以自己填写。</span><button type="button" class="text-button" data-testid="food-picker-manual" @click="emit('select', '')">手动填写 <ChevronRight :size="15" /></button></footer>
      </section>
    </div>
  </Teleport>
</template>
