<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Detalle de Organización</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="organization">
            <p><strong>ID:</strong> <span class="text-body-secondary">{{ organization.id }}</span></p>
            <p><strong>Nombre:</strong> <span class="text-body-secondary">{{ organization.name }}</span></p>
            <div class="mt-4">
              <RouterLink :to="`/business/organizations/${organization.id}/edit`">
                <CButton color="primary" size="sm">Editar</CButton>
              </RouterLink>
              <RouterLink to="/business/organizations">
                <CButton color="secondary" size="sm" variant="outline" class="ms-2">Volver a la lista</CButton>
              </RouterLink>
            </div>
          </template>
          <template v-else>
            <CSpinner color="primary" /> Cargando...
          </template>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getOrganizationById } from '@/services/organizationService'

const route = useRoute()
const organization = ref(null)

onMounted(async () => {
  organization.value = await getOrganizationById(route.params.id)
})
</script>
