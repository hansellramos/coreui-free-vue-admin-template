<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Accommodations</strong>
          <CButtonGroup>
            <CButton 
              :color="viewMode === 'table' ? 'primary' : 'secondary'" 
              :variant="viewMode === 'table' ? undefined : 'outline'"
              size="sm"
              @click="viewMode = 'table'"
            >
              <CIcon icon="cil-list" /> Tabla
            </CButton>
            <CButton 
              :color="viewMode === 'calendar' ? 'primary' : 'secondary'" 
              :variant="viewMode === 'calendar' ? undefined : 'outline'"
              size="sm"
              @click="viewMode = 'calendar'"
            >
              <CIcon icon="cil-calendar" /> Calendario
            </CButton>
          </CButtonGroup>
        </CCardHeader>
        <CCardBody>
          <AccommodationTable v-if="viewMode === 'table'" />
          <AccommodationCalendar v-else />
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref } from 'vue'
import { CIcon } from '@coreui/icons-vue'
import AccommodationTable from '@/components/accommodations/AccommodationTable.vue'
import AccommodationCalendar from '@/components/accommodations/AccommodationCalendar.vue'

const viewMode = ref('table')
</script>
