import type { InjectionKey } from 'vue'
export interface ToastAction { label: string; run: () => Promise<void> }
export const notifyKey: InjectionKey<(message: string, action?: ToastAction) => void> = Symbol('shike-notify')
