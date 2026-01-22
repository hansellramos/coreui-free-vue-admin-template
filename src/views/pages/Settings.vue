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
    
    <CCol :xs="12" v-if="user?.is_super_admin">
      <CCard class="mb-4 border-warning">
        <CCardHeader class="bg-warning bg-opacity-25">
          <strong>God Mode</strong>
          <CBadge color="warning" class="ms-2">Super Admin</CBadge>
        </CCardHeader>
        <CCardBody>
          <p class="text-muted mb-4">
            Esta sección solo es visible para super administradores. Desde aquí puedes gestionar los permisos de super admin de otros usuarios.
          </p>
          
          <h6 class="mb-3">Super Admins Actuales</h6>
          
          <div v-if="loadingSuperAdmins" class="text-center py-3">
            <CSpinner size="sm" />
          </div>
          
          <CTable v-else-if="superAdmins && superAdmins.length > 0" hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Usuario</CTableHeaderCell>
                <CTableHeaderCell>Email</CTableHeaderCell>
                <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="admin in superAdmins" :key="admin.id">
                <CTableDataCell>
                  <div class="d-flex align-items-center gap-2">
                    <CAvatar :src="admin.avatar_url" size="sm" v-if="admin.avatar_url" />
                    <CAvatar color="secondary" size="sm" v-else>
                      {{ (admin.display_name || admin.email || '?')[0].toUpperCase() }}
                    </CAvatar>
                    {{ admin.display_name || 'Sin nombre' }}
                  </div>
                </CTableDataCell>
                <CTableDataCell>{{ admin.email }}</CTableDataCell>
                <CTableDataCell class="text-end">
                  <CButton 
                    v-if="admin.id !== user.id"
                    color="danger" 
                    variant="ghost"
                    size="sm"
                    @click="revokeSuperAdmin(admin)"
                    :disabled="savingId === admin.id"
                  >
                    <CSpinner size="sm" v-if="savingId === admin.id" />
                    <span v-else>Revocar</span>
                  </CButton>
                  <CBadge v-else color="info">Tú</CBadge>
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
          
          <CAlert color="info" v-else>
            No hay super admins configurados.
          </CAlert>
          
          <hr class="my-4" />
          
          <h6 class="mb-3">Agregar Super Admin</h6>
          <div class="d-flex gap-2 align-items-end">
            <div class="flex-grow-1">
              <CFormLabel>Seleccionar usuario</CFormLabel>
              <CFormSelect v-model="selectedUserId">
                <option value="">Seleccionar...</option>
                <option 
                  v-for="u in availableUsers" 
                  :key="u.id" 
                  :value="u.id"
                >
                  {{ u.display_name || u.email }}
                </option>
              </CFormSelect>
            </div>
            <CButton 
              color="warning" 
              :disabled="!selectedUserId || savingId === selectedUserId"
              @click="grantSuperAdmin"
            >
              <CSpinner size="sm" v-if="savingId === selectedUserId" />
              <span v-else>Otorgar Super Admin</span>
            </CButton>
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

const settingsStore = useSettingsStore()
const { user } = useAuth()

const superAdmins = ref([])
const allUsers = ref([])
const loadingSuperAdmins = ref(false)
const savingId = ref(null)
const selectedUserId = ref('')

const availableUsers = computed(() => {
  const superAdminIds = (superAdmins.value || []).map(a => a.id)
  return (allUsers.value || []).filter(u => !superAdminIds.includes(u.id))
})

async function loadSuperAdmins() {
  if (!user.value?.is_super_admin) return
  
  loadingSuperAdmins.value = true
  try {
    const [adminsRes, usersRes] = await Promise.all([
      fetch('/api/users/super-admins', { credentials: 'include' }),
      fetch('/api/users', { credentials: 'include' })
    ])
    
    if (adminsRes.ok) {
      superAdmins.value = await adminsRes.json()
    }
    if (usersRes.ok) {
      allUsers.value = await usersRes.json()
    }
  } catch (error) {
    console.error('Error loading super admins:', error)
  } finally {
    loadingSuperAdmins.value = false
  }
}

watch(() => user.value?.is_super_admin, (isSuperAdmin) => {
  if (isSuperAdmin && (!superAdmins.value || superAdmins.value.length === 0)) {
    loadSuperAdmins()
  }
}, { immediate: true })

async function revokeSuperAdmin(admin) {
  if (!confirm(`¿Estás seguro de revocar el permiso de super admin a ${admin.display_name || admin.email}?`)) {
    return
  }
  
  savingId.value = admin.id
  try {
    const res = await fetch(`/api/users/${admin.id}/super-admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_super_admin: false })
    })
    
    if (res.ok) {
      await loadSuperAdmins()
    } else {
      const data = await res.json()
      alert(data.error || 'Error al revocar permiso')
    }
  } catch (error) {
    alert('Error al revocar permiso')
  } finally {
    savingId.value = null
  }
}

async function grantSuperAdmin() {
  if (!selectedUserId.value) return
  
  const targetUser = allUsers.value.find(u => u.id === selectedUserId.value)
  if (!confirm(`¿Estás seguro de otorgar permiso de super admin a ${targetUser?.display_name || targetUser?.email}?`)) {
    return
  }
  
  savingId.value = selectedUserId.value
  try {
    const res = await fetch(`/api/users/${selectedUserId.value}/super-admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_super_admin: true })
    })
    
    if (res.ok) {
      selectedUserId.value = ''
      await loadSuperAdmins()
    } else {
      const data = await res.json()
      alert(data.error || 'Error al otorgar permiso')
    }
  } catch (error) {
    alert('Error al otorgar permiso')
  } finally {
    savingId.value = null
  }
}

</script>
