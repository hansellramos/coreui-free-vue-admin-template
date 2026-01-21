import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const developmentMode = ref(localStorage.getItem('developmentMode') === 'true')

  watch(developmentMode, (val) => {
    localStorage.setItem('developmentMode', val ? 'true' : 'false')
  })

  function toggleDevelopmentMode() {
    developmentMode.value = !developmentMode.value
  }

  return {
    developmentMode,
    toggleDevelopmentMode
  }
})
