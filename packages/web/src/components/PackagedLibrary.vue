<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { PackageOpen, Search, Camera, Trash2, LoaderCircle, Bookmark } from '@lucide/vue'
import { barcodeSchema, builtinPackagedFoods, packagedCategories, packageFromEntry, packagedEntry, labelNutrients, type FoodEntry, type PackagedFood } from '@shike/shared'
import { db, savePackagedFood } from '../lib/db'
import { lookupProduct } from '../lib/food-catalog'
import { readBarcode } from '../lib/barcode'
import { systemPhotoAvailable, takeSystemPhoto } from '../lib/system-photo'
import { numberLabel } from '../lib/dates'
import AppSheet from './AppSheet.vue'
import { notifyKey } from '../lib/toast'
const props = withDefaults(defineProps<{ candidate?: FoodEntry; selection?: boolean; initialBarcode?: string }>(), { selection: true })
const emit = defineEmits<{ close: []; select: [entry: FoodEntry] }>()
const records = ref<PackagedFood[]>([]), query = ref(''), barcode = ref(props.initialBarcode ?? props.candidate?.packageSnapshot?.barcode ?? '')
const brand = ref(props.candidate?.packageSnapshot?.brand ?? ''), busy = ref(false), error = ref(''), message = ref(''), preview = ref<PackagedFood | null>(null)
const notify = inject(notifyKey, () => {})
watch([message, error], ([success, failure]) => { if (failure || success) notify(failure || success) })
const photo = ref<HTMLInputElement | null>(null), barcodeCamera = ref<HTMLInputElement | null>(null)
const previewElement = ref<HTMLElement | null>(null)
const publicCategory = ref('全部商品'), visiblePublic = ref(12)
const filtered = computed(() => { const key = query.value.trim().toLowerCase(); return records.value.filter(food => [food.name, food.brand, food.barcode ?? ''].join(' ').toLowerCase().includes(key)) })
// 内置参考保持只读。只有用户明确保存的标签进入 IndexedDB 和个人备份。
const publicFoods = computed(() => {
  const key = query.value.trim().toLowerCase(), saved = new Set(records.value.map(food => food.barcode).filter(Boolean))
  return builtinPackagedFoods.filter(item => !saved.has(item.food.barcode)
    && (publicCategory.value === '全部商品' || item.category === publicCategory.value)
    && [item.food.name, item.food.brand, item.food.barcode ?? '', ...item.aliases].join(' ').toLowerCase().includes(key))
})
watch([query, publicCategory], () => { visiblePublic.value = 12 })
async function reload() { records.value = (await db.packagedFoods.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }
onMounted(async () => { try { await reload(); if (props.initialBarcode) await searchBarcode() } catch { error.value = '包装库读取失败，请检查本机存储。' } })
async function save(food: PackagedFood) {
  const existing = records.value.find(record => food.barcode ? record.barcode === food.barcode : record.id === food.id)
  if (existing && !window.confirm(`包装库已有「${existing.name}」，覆盖它的标签吗？历史餐食保持原值。`)) return
  await savePackagedFood(existing ? { ...food, id: existing.id, createdAt: existing.createdAt } : food)
  await reload(); message.value = '已保存到我的包装库，下次可直接复用。'
}
async function saveCandidate() {
  if (!props.candidate || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await save(packageFromEntry(props.candidate, brand.value.trim(), barcode.value.trim() || null)) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败，请检查输入与本机存储。' }
  finally { busy.value = false }
}
async function searchBarcode() {
  if (busy.value) return
  error.value = ''; message.value = ''; preview.value = null
  const checked = barcodeSchema.safeParse(barcode.value.trim())
  if (!checked.success) { error.value = '请输入有效的商品条码，检查数字与末位校验码。'; return }
  barcode.value = checked.data
  const local = records.value.find(food => food.barcode === checked.data)
  if (local) { preview.value = local; message.value = '已在本地找到，无需联网查询。'; return }
  const bundled = builtinPackagedFoods.find(item => item.food.barcode === checked.data)
  if (bundled) { preview.value = bundled.food; message.value = '已在内置商品参考中找到，无需联网；请核对当前包装标签。'; return }
  busy.value = true
  try { preview.value = await lookupProduct(barcode.value); if (!preview.value) message.value = 'Open Food Facts 尚未收录此条码，不代表商品不存在。可拍营养表后保存到包装库，或手动填写。' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '查询失败，请稍后重试。' }
  finally { busy.value = false }
}
async function fromPhoto(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file || busy.value) return
  busy.value = true; error.value = ''
  try { barcode.value = await readBarcode(file) } catch (cause) { error.value = cause instanceof Error ? cause.message : '条码读取失败。' }
  finally { busy.value = false }
  if (!error.value) await searchBarcode()
}
async function takeBarcodePhoto() {
  if (busy.value) return
  if (!systemPhotoAvailable()) { barcodeCamera.value?.click(); return }
  busy.value = true; error.value = ''
  let found = false
  try { const file = await takeSystemPhoto(); if (file) { barcode.value = await readBarcode(file); found = true } }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '条码照片读取失败。' }
  finally { busy.value = false }
  if (found) await searchBarcode()
}
async function savePreview() { if (!preview.value || busy.value) return; busy.value = true; error.value = ''; message.value = ''; try { await save(preview.value) } catch { error.value = '保存失败，请检查本机存储。' } finally { busy.value = false } }
async function remove(food: PackagedFood) { if (busy.value) return; if (!window.confirm(`删除包装库中的「${food.name}」？历史餐食仍保留。`)) return; busy.value = true; error.value = ''; message.value = ''; try { await db.packagedFoods.delete(food.id); await reload(); message.value = '库条目已删除，历史记录保持不变。' } catch { error.value = '删除失败，请重试。' } finally { busy.value = false } }
function use(food: PackagedFood) { emit('select', packagedEntry(food)); emit('close') }
async function showPreview(food: PackagedFood) { preview.value = food; message.value = ''; error.value = ''; await nextTick(); previewElement.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
function basis(food: PackagedFood) { return ({ '100g': '每100 g', '100ml': '每100 mL', serving: '每份', package: '每包', unknown: '基准待确认' })[food.label.basis] }
</script>
<template>
  <AppSheet :open="true" :title="candidate ? '保存到包装库' : '包装食品库'" subtitle="内置商品参考 · 免费条码查询" :busy="busy" test-id="packaged-library" @close="emit('close')">
    <section v-if="candidate" class="package-library-save"><h3>{{ candidate.name }}</h3><label>品牌（可选）<input v-model="brand" maxlength="200" data-testid="library-brand" :disabled="busy" /></label><label>商品条码（可选）<input v-model="barcode" inputmode="numeric" maxlength="14" data-testid="library-save-barcode" :disabled="busy" placeholder="填写后下次可扫码查找" /></label><p class="tiny muted">只保存当前标签，不保存本次摄入量。模拟标签不能进入真实包装库。</p><button class="button primary full" data-testid="confirm-save-package" :disabled="busy" @click="saveCandidate"><LoaderCircle v-if="busy" :size="16" class="spin"/><Bookmark v-else :size="16" />{{ busy ? '正在保存…' : '确认保存标签' }}</button></section>
    <template v-else><div class="package-catalog-note"><PackageOpen :size="20" /><p>先查本地；未找到再联网查询 Open Food Facts。无需 API Key，商品数据可能缺失或过期，请核对实物。</p></div><form class="barcode-query" @submit.prevent="searchBarcode"><label>商品条码<input v-model="barcode" data-testid="catalog-barcode" inputmode="numeric" maxlength="14" placeholder="输入包装条码下的数字" :disabled="busy" /></label><button class="button primary" data-testid="catalog-query" :disabled="busy"><LoaderCircle v-if="busy" class="spin" :size="16" /><Search v-else :size="16" />查询</button></form><input ref="photo" tabindex="-1" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-testid="barcode-photo-input" :disabled="busy" @change="fromPhoto" /><input ref="barcodeCamera" class="sr-only" type="file" accept="image/*" capture="environment" data-testid="barcode-camera-input" :disabled="busy" @change="fromPhoto" /><button class="button secondary full" data-testid="catalog-photo" :disabled="busy" @click="takeBarcodePhoto"><Camera :size="17" />拍条码</button><button class="text-button" data-testid="catalog-choose-photo" :disabled="busy" @click="photo?.click()">选条码照片</button><p class="tiny muted">在设备本地读码，不上传条码照片。让条码横向、完整且清晰；也可直接输入。</p></template>
    <p v-if="message" class="notice subtle" role="status" data-testid="catalog-message">{{ message }}</p><p v-if="error" class="notice danger" role="alert" data-testid="catalog-error">{{ error }}</p>
    <article v-if="preview" ref="previewElement" class="catalog-preview" data-testid="catalog-preview"><h3>{{ preview.name }}</h3><p class="small-text muted">{{ preview.brand || '品牌待核对' }} · {{ preview.barcode }}</p><strong>{{ basis(preview) }} · {{ numberLabel(labelNutrients(preview.label).energyKcal) }} kcal</strong><p class="tiny">净含量 {{ preview.label.netContent ? `${numberLabel(preview.label.netContent.amount)} ${preview.label.netContent.unit}` : '待补充' }} · 摄入量在加入后填写</p><p v-if="preview.source" class="tiny"><a :href="preview.source.url" target="_blank" rel="noopener noreferrer">Open Food Facts · {{ preview.source.license }} · 查看来源</a></p><div class="backup-buttons"><button v-if="selection" class="button primary" data-testid="use-catalog-product" :disabled="busy" @click="use(preview)">加入这一餐</button><button class="button secondary" data-testid="save-catalog-product" :disabled="busy" @click="savePreview">保存到包装库</button></div></article>
    <div class="sheet-list-heading"><h3>我的包装食品</h3><span>{{ records.length }} 项</span></div><label class="library-search"><Search :size="16" /><input v-model="query" type="search" data-testid="package-library-search" placeholder="搜名称、品牌或条码" /></label><p v-if="!filtered.length" class="sheet-empty">{{ records.length ? '没有找到匹配条目。' : '还没有个人保存的标签，可从下方内置参考选用，或查询商品条码。' }}</p><article v-for="food in filtered" :key="food.id" class="package-library-row" data-testid="packaged-library-row"><div><strong>{{ food.name }}</strong><p class="tiny muted">{{ food.brand }} {{ food.label.netContent ? `${numberLabel(food.label.netContent.amount)} ${food.label.netContent.unit}` : '' }} · {{ basis(food) }}约 {{ numberLabel(labelNutrients(food.label).energyKcal) }} kcal</p><p v-if="food.source" class="tiny"><a :href="food.source.url" target="_blank" rel="noopener noreferrer">Open Food Facts · ODbL</a></p></div><button v-if="selection" class="text-button" data-testid="use-packaged-food" :disabled="busy" @click="use(food)">选用</button><button class="icon-button" aria-label="删除包装库条目" data-testid="delete-packaged-food" :disabled="busy" @click="remove(food)"><Trash2 :size="17" /></button></article>
    <section v-if="!candidate" data-testid="public-packaged-library">
      <div class="sheet-list-heading"><h3>内置商品参考</h3><span>{{ publicFoods.length }} 项</span></div>
      <p class="tiny muted">可直接选用，按上方名称、品牌或条码搜索。已保存的同条码标签优先；不同规格以实物营养表为准。</p>
      <div class="package-category-tabs" role="group" aria-label="商品参考分类"><button v-for="category in ['全部商品', ...packagedCategories.filter(value => value !== '我的包装')]" :key="category" type="button" :class="{ active: publicCategory === category }" :aria-pressed="publicCategory === category" @click="publicCategory = category">{{ category }}</button></div>
      <p v-if="!publicFoods.length" class="sheet-empty">此分类没有匹配的公开参考，可输入条码联网查询，或拍营养表添加。</p>
      <article v-for="{ food, originalName, nameTranslation } in publicFoods.slice(0, visiblePublic)" :key="food.id" class="package-library-row" data-testid="public-packaged-row">
        <div><strong>{{ food.name }}</strong><p v-if="originalName && originalName !== food.name" class="tiny muted">原名：{{ originalName }}</p><p v-if="nameTranslation === 'category'" class="tiny muted">中文类别提示，非完整商品译名</p><p class="tiny muted">{{ food.brand }} · {{ basis(food) }}约 {{ numberLabel(labelNutrients(food.label).energyKcal) }} kcal</p><p class="tiny muted">{{ food.barcode }} · Open Food Facts</p></div>
        <button class="text-button" :disabled="busy" @click="showPreview(food)">{{ selection ? '查看／选用' : '查看／保存' }}</button>
      </article>
      <button v-if="visiblePublic < publicFoods.length" class="button secondary full" @click="visiblePublic += 12">更多商品（还有 {{ publicFoods.length - visiblePublic }} 项）</button>
    </section>
    <p class="tiny muted">公开商品参考与个人核对标签保留各自来源。公开数据采用 ODbL；查询不上传饮食、体重、API Key 或个人资料。</p><a class="text-button tiny" href="https://world.openfoodfacts.org/terms-of-use" target="_blank" rel="noopener noreferrer">Open Food Facts 使用与再分发许可</a><a class="text-button tiny" href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">浏览 OFF 公开商品库</a>
  </AppSheet>
</template>
