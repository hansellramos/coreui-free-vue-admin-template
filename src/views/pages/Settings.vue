<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Settings</strong>
        </CCardHeader>
        <CCardBody>
          <div class="mb-3">
            <CFormCheck 
              id="developmentMode"
              v-model="settingsStore.developmentMode"
              label="Development Mode"
            />
            <div class="form-text text-muted">
              Habilita las secciones Theme, Components y Extras en el menú lateral.
            </div>
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
</script>
