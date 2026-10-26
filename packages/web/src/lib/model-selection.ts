const key = 'shike-local-model-v1'
export function selectedLocalModel(): string { try { return localStorage.getItem(key) || 'default' } catch { return 'default' } }
export function selectLocalModel(id: string) { localStorage.setItem(key, id) }
