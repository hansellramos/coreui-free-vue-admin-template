<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Detalles de la Organización</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="organization">
            <p class="d-none"><strong>ID:</strong> <span class="text-body-secondary">{{ organization.id }}</span></p>
            <p><strong>Nombre:</strong> <span class="text-body-secondary">{{ organization.name }}</span></p>
            <div class="mt-4 d-flex flex-wrap gap-2">
              <RouterLink :to="`/business/organizations/${organization.id}/edit`">
                <CButton color="primary" size="sm">Editar</CButton>
              </RouterLink>
              <CButton color="danger" size="sm" @click="onDelete">Eliminar</CButton>
              <RouterLink to="/business/organizations">
                <CButton color="secondary" size="sm" variant="outline">Volver a la Lista</CButton>
              </RouterLink>
            </div>
            <hr />
            <div>
              <h6>Usuarios con Acceso</h6>
              <CListGroup v-if="users.length" flush>
                <CListGroupItem v-for="user in users" :key="user.id" class="d-flex align-items-center">
                  <CAvatar v-if="user.avatar_url" :src="user.avatar_url" size="sm" class="me-2" />
                  <CAvatar v-else color="primary" size="sm" class="me-2">
                    {{ (user.display_name || user.email || '?').charAt(0).toUpperCase() }}
                  </CAvatar>
                  <div>
                    <div>{{ user.display_name || user.email }}</div>
                    <small v-if="user.display_name && user.email" class="text-muted">{{ user.email }}</small>
                  </div>
                </CListGroupItem>
              </CListGroup>
              <div v-else class="text-body-secondary">No hay usuarios asignados.</div>
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
import { useRoute, useRouter } from 'vue-router'
import { getOrganizationById, deleteOrganization } from '@/services/organizationService'
import { fetchUsersByOrganization } from '@/services/userOrganizationService'

const route = useRoute()
const router = useRouter()
const organization = ref(null)
const users = ref([])

const onDelete = async () => {
  if (confirm(`¿Estás seguro de eliminar la organización "${organization.value.name}"?`)) {
    await deleteOrganization(organization.value.id)
    router.push('/business/organizations')
  }
}

async function loadUsers() {
  users.value = await fetchUsersByOrganization(route.params.id)
}

onMounted(async () => {
  organization.value = await getOrganizationById(route.params.id)
  await loadUsers()
})
</script>
