import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useBreadcrumbStore = defineStore('breadcrumb', () => {
  const dynamicTitle = ref(null)

  const setTitle = (title) => {
    dynamicTitle.value = title
  }

  const clearTitle = () => {
    dynamicTitle.value = null
  }

  return { dynamicTitle, setTitle, clearTitle }
})
