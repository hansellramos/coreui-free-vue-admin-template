<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Accommodations</strong>
        </CCardHeader>
        <CCardBody>
          <AccommodationTable />
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import AccommodationTable from '@/components/accommodations/AccommodationTable.vue'
</script>
