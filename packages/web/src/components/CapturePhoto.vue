<script setup lang="ts">
import type { MealType } from '@shike/shared'
import SystemCapture from './SystemCapture.vue'
import CaptureCamera from './CaptureCamera.vue'
import { systemPhotoAvailable } from '../lib/system-photo'
defineProps<{ mealType: MealType }>()
const emit = defineEmits<{ close: []; capture: [file: File, kind: 'food' | 'label', meal: MealType]; barcode: [value: string, meal: MealType]; skip: [meal: MealType, kind: string] }>()
const system = systemPhotoAvailable()
function capture(file: File, kind: 'food' | 'label', meal: MealType) { emit('capture', file, kind, meal) }
function barcode(value: string, meal: MealType) { emit('barcode', value, meal) }
function skip(meal: MealType, kind: string) { emit('skip', meal, kind) }
</script>
<template>
  <component :is="system ? SystemCapture : CaptureCamera" :meal-type="mealType" @close="emit('close')" @capture="capture" @barcode="barcode" @skip="skip" />
</template>
