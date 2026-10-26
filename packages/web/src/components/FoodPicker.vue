<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Check, ChevronRight, LoaderCircle, Plus, Search, SlidersHorizontal, Sparkles, Star, X } from '@lucide/vue'
import { packagedCategories, type LibraryFood, type EstimatedFood, type FoodEntry, type PackagedFood } from '@shike/shared'
import { buildFoodChoices, entryForFoodChoice, categorySymbols, isEverydayFood, pickerCategories, recommendFoodChoices, searchFoodChoices, type FoodChoice, type FoodMatchContext } from '../lib/food-picker'
import { db, toggleFoodFavorite } from '../lib/db'
import { numberLabel, rangeLabel } from '../lib/dates'
import { useBackLayer } from '../lib/use-back-layer'

const props = defineProps<{ entry: FoodEntry; selectedId: string; personalFoods: EstimatedFood[]; packagedFoods?: PackagedFood[]; aiCandidate?: FoodEntry; recognition?: FoodMatchContext; mock?: boolean }>()
const emit = defineEmits<{ close: []; select: [id: string]; packages: [] }>()
useBackLayer(() => true, () => emit('close'))
const query = ref(''), category = ref('全部'), visibleCount = ref(60), includeIngredients = ref(false)
const packageCategory = ref('全部商品')
const libraryFoods = ref<LibraryFood[]>([]), favoriteBusy = ref(false), feedback = ref(''), storageError = ref('')
const pendingFavorite = ref('')
const savedIds = computed(() => new Set(libraryFoods.value.map(food => food.choiceId)))
const favorites = computed(() => new Set(libraryFoods.value.filter(food => food.favorite).map(food => food.choiceId)))
const dialog = ref<HTMLElement | null>(null), search = ref<HTMLInputElement | null>(null), closeButton = ref<HTMLButtonElement | null>(null), list = ref<HTMLElement | null>(null)
const allChoices = computed(() => buildFoodChoices(props.personalFoods, props.aiCandidate, { entry: props.entry, selectedId: props.selectedId }, props.packagedFoods, libraryFoods.value))
// 历史已选的生重条目仍可见，隐藏选项不改写历史，也不删除配方需要的原料。
const choices = computed(() => allChoices.value.filter(choice => includeIngredients.value || isEverydayFood(choice) || favorites.value.has(choice.id) || choice.id === props.selectedId))
const categories = computed(() => pickerCategories.map(name => ({ name, count: name === '全部' ? choices.value.length : name === '常用食物' ? choices.value.filter(choice => savedIds.value.has(choice.id)).length : name === '收藏' ? choices.value.filter(choice => favorites.value.has(choice.id)).length : choices.value.filter(choice => choice.category === name).length })).filter(item => item.count > 0 || ['常用食物', '收藏', '我的食物', '包装食品'].includes(item.name)))
const results = computed(() => searchFoodChoices(choices.value, query.value, ['收藏', '常用食物'].includes(category.value) ? '全部' : category.value).filter(choice => category.value !== '常用食物' || savedIds.value.has(choice.id)).filter(choice => category.value !== '收藏' || favorites.value.has(choice.id)).filter(choice => category.value !== '包装食品' || packageCategory.value === '全部商品' || choice.packageCategory === packageCategory.value))
const packageTabs = computed(() => ['全部商品', ...packagedCategories].filter(name => name === '全部商品' || choices.value.some(choice => choice.packageCategory === name)))
const recommendations = computed(() => recommendFoodChoices(choices.value, props.recognition ?? { name: props.entry.name, visibleIngredients: [] }))
const shown = computed(() => results.value.slice(0, visibleCount.value))
const showRecommendations = computed(() => !query.value.trim() && category.value === '全部' && recommendations.value.length > 0)

watch([query, category, includeIngredients, packageCategory], () => { visibleCount.value = 60; list.value?.scrollTo?.({ top: 0 }) })
onMounted(async () => {
  try { libraryFoods.value = await db.libraryFoods.toArray() } catch { storageError.value = '个人食品库读取失败，请重试。' }
  nextTick(() => (window.innerWidth >= 768 ? search.value : closeButton.value)?.focus())
})
async function favorite(choice: FoodChoice) {
  if (favoriteBusy.value) return
  favoriteBusy.value = true; pendingFavorite.value = choice.id; storageError.value = ''; feedback.value = ''
  try {
    const entry = entryForFoodChoice(choice.id, null, props.personalFoods, props.packagedFoods ?? [], libraryFoods.value) ?? (choice.id === props.selectedId ? props.entry : null)
    if (!entry) throw new Error('请先将本次识别存入食品库。')
    const added = await toggleFoodFavorite(choice.id, entry)
    libraryFoods.value = await db.libraryFoods.toArray()
    feedback.value = added ? `已收藏「${choice.name}」，下次可从收藏中添加` : `已取消收藏「${choice.name}」`
  } catch (cause) { storageError.value = cause instanceof Error ? cause.message : '收藏保存失败，请重试。' }
  finally { favoriteBusy.value = false; pendingFavorite.value = '' }
}
function calories(choice: FoodChoice) { const value = (choice.nutritionPerUnit?.value ?? choice.nutrientsPer100g).energyKcal; return choice.energyRange ? `${rangeLabel(choice.energyRange)} kcal` : value === null ? '热量待补充' : `约 ${numberLabel(value)} kcal` }
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
          <div><span class="eyebrow">找到更符合这一餐的食物</span><h2 id="food-picker-title">食品库</h2></div>
          <span class="picker-count">{{ choices.length }} 项可选</span>
          <button type="button" class="icon-button picker-desktop-close" aria-label="关闭食物选择" @click="emit('close')"><X :size="21" /></button>
        </header>
        <div class="food-picker-search-area">
          <label class="food-picker-search"><Search :size="19" /><span class="sr-only">搜索食物</span><input ref="search" v-model="query" type="search" data-testid="food-picker-search" placeholder="搜索食物、别名或配料，如：米饭、番茄" autocomplete="off" maxlength="100" /><button v-if="query" type="button" class="icon-button small" aria-label="清空搜索" data-testid="clear-food-search" @click="query = ''; search?.focus()"><X :size="15" /></button></label>
          <p id="food-picker-description"><Sparkles :size="14" /><span><template v-if="mock"><strong>模拟数据</strong> · </template><template v-if="recognition">{{ mock ? '示例食物' : 'AI 识别' }}：<strong>{{ recognition.name }}</strong><template v-if="recognition.visibleIngredients.length"> · 可见{{ recognition.visibleIngredients.slice(0, 3).join('、') }}</template></template><template v-else>{{ entry.name ? `当前食物：${entry.name}` : '按分类浏览，或搜索你吃下的食物' }}</template></span></p>
          <div class="food-picker-filter"><span>默认查看熟食与即食食物</span><label><input v-model="includeIngredients" data-testid="include-raw-ingredients" type="checkbox" /> 包含生重／干重食材</label></div>
        </div>
        <p v-if="feedback" class="picker-feedback" role="status" data-testid="favorite-feedback">{{ feedback }}</p>
        <p v-if="storageError" class="notice danger" role="alert">{{ storageError }}</p>
        <div class="food-picker-body">
          <nav class="food-picker-categories" aria-label="食物分类"><button v-for="item in categories" :key="item.name" type="button" :aria-pressed="category === item.name" :class="{ active: category === item.name }" :data-testid="`food-category-${item.name}`" @click="category = item.name"><span>{{ item.name }}</span><small>{{ item.count }}</small></button></nav>
          <div ref="list" class="food-picker-content">
            <div v-if="category === '包装食品'" class="packaged-picker-tools"><div class="package-category-tabs" role="group" aria-label="包装食品分类"><button v-for="name in packageTabs" :key="name" type="button" :aria-pressed="packageCategory === name" :class="{ active: packageCategory === name }" :data-testid="`package-filter-${name}`" @click="packageCategory = name">{{ name }}</button></div><button type="button" class="text-button" data-testid="picker-query-package" @click="emit('packages')">查条码／管理包装库 <ChevronRight :size="14" /></button><p class="tiny muted">公开包装参考可离线选用，请核对条码和当前标签；个人保存的同条码标签优先。</p></div>
            <section v-if="showRecommendations" class="food-recommendations" data-testid="food-recommendations" aria-labelledby="food-recommendations-title">
              <div class="picker-section-heading"><div><h3 id="food-recommendations-title"><Sparkles :size="16" /> 与这一餐相近</h3><p>按名称和配料匹配，请核对做法与生熟状态</p></div></div>
              <div class="food-recommendation-grid"><button v-for="item in recommendations" :key="item.choice.id" type="button" class="food-recommendation" :class="{ selected: selectedId === item.choice.id }" :aria-pressed="selectedId === item.choice.id" :data-testid="`food-recommendation-${item.choice.id}`" @click="emit('select', item.choice.id)"><span class="food-choice-symbol" aria-hidden="true">{{ categorySymbols[item.choice.category] ?? '🍽️' }}</span><Check v-if="selectedId === item.choice.id" class="food-choice-check" :size="15" /><strong>{{ item.choice.name }}</strong><span class="food-choice-description">{{ item.choice.description }}</span><span class="food-choice-energy">{{ calories(item.choice) }}<small> · {{ item.choice.nutritionPerUnit?.unitLabel ?? "每100 g" }}</small></span><span class="food-recommendation-reason">{{ item.reason }}</span></button></div>
            </section>
            <section aria-labelledby="food-results-title">
              <div class="picker-section-heading"><h3 id="food-results-title"><SlidersHorizontal :size="15" /> {{ query.trim() ? '搜索结果' : category === '全部' ? '全部食物' : category }}</h3><span role="status" aria-live="polite" data-testid="food-result-count">{{ results.length }} 项</span></div>
              <div v-if="!shown.length" class="food-search-empty" data-testid="food-search-empty"><Search :size="30" /><h3>{{ category === "常用食物" ? "还没有匹配的常用食物" : category === "收藏" ? "还没有匹配的收藏" : category === "我的食物" ? "还没有匹配的个人食物" : "没有找到合适的食物" }}</h3><p>{{ category === "包装食品" ? "没有匹配的公开参考或个人标签。可查条码，也可拍营养表后保存；公开商品库不保证收录。" : "试试更短的名称、常用别名，或切换到全部分类。" }}</p><button v-if="category !== '全部'" type="button" class="text-button" @click="category = '全部'">搜索全部分类 <ChevronRight :size="14" /></button></div>
              <div v-else class="food-choice-list"><div v-for="choice in shown" :key="choice.id" class="food-choice-item"><button type="button" class="food-choice-row" :class="{ selected: selectedId === choice.id }" :aria-pressed="selectedId === choice.id" :data-testid="`food-option-${choice.id}`" @click="emit('select', choice.id)"><span class="food-choice-symbol" aria-hidden="true">{{ categorySymbols[choice.category] ?? '🍽️' }}</span><span class="food-choice-text"><strong>{{ choice.name }}</strong><span v-if="choice.originalName && choice.originalName !== choice.name" class="food-original-name">原名：{{ choice.originalName }}</span><span>{{ choice.description }}</span></span><span class="food-choice-energy">{{ calories(choice) }}<small>{{ choice.nutritionPerUnit?.unitLabel ?? "每100 g" }}</small></span><span class="food-choice-indicator"><Check v-if="selectedId === choice.id" :size="18" /><Plus v-else :size="17" /></span></button><button v-if="choice.id !== 'ai-current'" type="button" class="food-favorite" :class="{ active: favorites.has(choice.id) }" :disabled="favoriteBusy" :aria-label="`${favorites.has(choice.id) ? '取消收藏' : '收藏'}${choice.name}`" :aria-pressed="favorites.has(choice.id)" :aria-busy="pendingFavorite === choice.id" :data-testid="`food-favorite-${choice.id}`" @click="favorite(choice)"><LoaderCircle v-if="pendingFavorite === choice.id" class="spin" :size="19"/><Star v-else :size="19" :fill="favorites.has(choice.id) ? 'currentColor' : 'none'" /></button></div></div>
              <button v-if="shown.length < results.length" type="button" class="button secondary full food-load-more" data-testid="food-load-more" @click="visibleCount += 60">继续查看 · 还有 {{ results.length - shown.length }} 项</button>
            </section>
          </div>
        </div>
        <footer class="food-picker-footer"><button type="button" class="text-button" data-testid="picker-packages" @click="emit('packages')">查包装食品／条码</button><button type="button" class="text-button" data-testid="food-picker-manual" @click="emit('select', '')">手动填写 <ChevronRight :size="15" /></button></footer>
      </section>
    </div>
  </Teleport>
</template>
