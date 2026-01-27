<script setup>
import { onMounted, ref, computed } from 'vue'
import router from '@/router'
import { useBreadcrumbStore } from '@/stores/breadcrumb.js'

const breadcrumbStore = useBreadcrumbStore()
const breadcrumbs = ref()

const getBreadcrumbs = () => {
  return router.currentRoute.value.matched.map((route) => {
    let displayName = route.meta?.breadcrumb || route.name
    if (route.name === 'Root') displayName = 'Inicio'
    return {
      active: route.path === router.currentRoute.value.fullPath,
      name: displayName,
      path: `${router.options.history.base}${route.path}`,
    }
  })
}

const displayBreadcrumbs = computed(() => {
  if (!breadcrumbs.value) return []
  return breadcrumbs.value.map((item, index) => {
    // Si es el último item y hay título dinámico, usarlo
    if (item.active && breadcrumbStore.dynamicTitle) {
      return { ...item, name: breadcrumbStore.dynamicTitle }
    }
    return item
  })
})

router.afterEach(() => {
  breadcrumbStore.clearTitle()
  breadcrumbs.value = getBreadcrumbs()
})

onMounted(() => {
  breadcrumbs.value = getBreadcrumbs()
})
</script>

<template>
  <CBreadcrumb class="my-0">
    <CBreadcrumbItem
      v-for="item in displayBreadcrumbs"
      :key="item.path"
      :href="item.active ? '' : item.path"
      :active="item.active"
    >
      {{ item.name }}
    </CBreadcrumbItem>
  </CBreadcrumb>
</template>