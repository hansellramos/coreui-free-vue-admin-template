<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Perfiles</strong>
          <CButton color="primary" size="sm" @click="$router.push('/admin/profiles/new')">
            Crear Perfil
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Código</CTableHeaderCell>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Descripción</CTableHeaderCell>
                <CTableHeaderCell>Permisos</CTableHeaderCell>
                <CTableHeaderCell>Sistema</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="profile in profiles" :key="profile.id">
                <CTableDataCell>{{ profile.code }}</CTableDataCell>
                <CTableDataCell>{{ profile.name }}</CTableDataCell>
                <CTableDataCell>{{ profile.description || '—' }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge color="info" class="me-1" v-for="perm in (profile.permissions || []).slice(0, 3)" :key="perm">
                    {{ perm }}
                  </CBadge>
                  <span v-if="(profile.permissions || []).length > 3" class="text-muted">
                    +{{ profile.permissions.length - 3 }} más
                  </span>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="profile.is_system ? 'secondary' : 'primary'">
                    {{ profile.is_system ? 'Sí' : 'No' }}
                  </CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton
                      color="info"
                      size="sm"
                      variant="ghost"
                      @click="$router.push(`/admin/profiles/${profile.id}`)"
                      title="Ver detalle"
                    >
                      <CIcon :icon="cilZoom" />
                    </CButton>
                    <CButton
                      v-if="!profile.is_system"
                      color="primary"
                      size="sm"
                      variant="ghost"
                      @click="$router.push(`/admin/profiles/${profile.id}/edit`)"
                      title="Editar"
                    >
                      <CIcon :icon="cilPencil" />
                    </CButton>
                    <CButton
                      v-if="!profile.is_system"
                      color="danger"
                      size="sm"
                      variant="ghost"
                      @click="deleteProfile(profile)"
                      title="Eliminar"
                    >
                      <CIcon :icon="cilTrash" />
                    </CButton>
                  </div>
                </CTableDataCell>
              </CTableRow>
              <CTableRow v-if="profiles.length === 0">
                <CTableDataCell colspan="6" class="text-center text-muted">
                  No hay perfiles registrados
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { CIcon } from '@coreui/icons-vue'
import { cilZoom, cilPencil, cilTrash } from '@coreui/icons'

const profiles = ref([])

const loadProfiles = async () => {
  try {
    const response = await fetch('/api/profiles')
    if (response.ok) {
      profiles.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading profiles:', error)
  }
}

const deleteProfile = async (profile) => {
  if (!confirm(`¿Está seguro de eliminar el perfil "${profile.name}"?`)) return
  
  try {
    const response = await fetch(`/api/profiles/${profile.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (response.ok) {
      await loadProfiles()
    } else {
      const data = await response.json()
      alert(data.error || 'Error al eliminar perfil')
    }
  } catch (error) {
    console.error('Error deleting profile:', error)
    alert('Error al eliminar perfil')
  }
}

onMounted(loadProfiles)
</script>
