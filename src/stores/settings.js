import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const developmentMode = ref(localStorage.getItem('developmentMode') === 'true')
  const godModeViewAll = ref(localStorage.getItem('godModeViewAll') === 'true')

  watch(developmentMode, (val) => {
    localStorage.setItem('developmentMode', val ? 'true' : 'false')
  })

  watch(godModeViewAll, (val) => {
    localStorage.setItem('godModeViewAll', val ? 'true' : 'false')
  })

  function toggleDevelopmentMode() {
    developmentMode.value = !developmentMode.value
  }

  function toggleGodModeViewAll() {
    godModeViewAll.value = !godModeViewAll.value
  }

  return {
    developmentMode,
    toggleDevelopmentMode,
    godModeViewAll,
    toggleGodModeViewAll
  }
})
