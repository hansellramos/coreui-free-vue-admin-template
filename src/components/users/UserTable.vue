<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Usuarios</strong>
      <RouterLink to="/users/create">
        <CButton color="success" size="sm">+ Nuevo Usuario</CButton>
      </RouterLink>
    </CCardHeader>
    <CCardBody>
      <div class="mb-3">
        <label class="form-label">Buscar:</label>
        <input type="text" v-model="searchQuery" class="form-control" placeholder="Buscar por nombre o email" />
      </div>
      <CTable hover responsive>
        <CTableHead>
          <CTableRow>
            <CTableHeaderCell scope="col">Avatar</CTableHeaderCell>
            <CTableHeaderCell scope="col">Nombre</CTableHeaderCell>
            <CTableHeaderCell scope="col">Email</CTableHeaderCell>
            <CTableHeaderCell scope="col">Rol</CTableHeaderCell>
            <CTableHeaderCell scope="col">Estado</CTableHeaderCell>
            <CTableHeaderCell scope="col">Acciones</CTableHeaderCell>
          </CTableRow>
        </CTableHead>
        <CTableBody>
          <CTableRow v-for="user in filteredUsers" :key="user.id">
            <CTableDataCell>
              <CAvatar :src="user.avatar_url || 'https://via.placeholder.com/40'" size="md" />
            </CTableDataCell>
            <CTableDataCell>{{ user.display_name || 'Sin nombre' }}</CTableDataCell>
            <CTableDataCell>{{ user.email || 'Sin email' }}</CTableDataCell>
            <CTableDataCell>
              <CBadge :color="getRoleColor(user.role)">{{ user.role || 'user' }}</CBadge>
            </CTableDataCell>
            <CTableDataCell>
              <CBadge :color="user.is_locked ? 'danger' : 'success'">
                {{ user.is_locked ? 'Bloqueado' : 'Activo' }}
              </CBadge>
            </CTableDataCell>
            <CTableDataCell>
              <CButton color="primary" size="sm" @click="onEdit(user)">Editar</CButton>
              <CButton 
                v-if="user.is_locked" 
                color="success" 
                size="sm" 
                class="ms-2" 
                @click="onUnlock(user)"
              >Desbloquear</CButton>
              <CButton 
                v-else 
                color="warning" 
                size="sm" 
                class="ms-2" 
                @click="onLock(user)"
              >Bloquear</CButton>
              <CButton color="danger" size="sm" class="ms-2" @click="onDelete(user)">Eliminar</CButton>
            </CTableDataCell>
          </CTableRow>
        </CTableBody>
      </CTable>
    </CCardBody>
  </CCard>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchUsers, deleteUser, lockUser, unlockUser } from '@/services/userService'

const users = ref([])
const searchQuery = ref('')
const router = useRouter()

const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value
  const query = searchQuery.value.toLowerCase()
  return users.value.filter(u => 
    (u.display_name && u.display_name.toLowerCase().includes(query)) ||
    (u.email && u.email.toLowerCase().includes(query))
  )
})

function getRoleColor(role) {
  switch(role) {
    case 'admin': return 'danger'
    case 'manager': return 'warning'
    case 'user': return 'info'
    default: return 'secondary'
  }
}

async function loadUsers() {
  try {
    users.value = await fetchUsers()
  } catch (error) {
    console.error('Error loading users:', error)
  }
}

onMounted(() => {
  loadUsers()
})

function onEdit(user) {
  router.push(`/users/${user.id}/edit`)
}

async function onLock(user) {
  if (confirm(`¿Estás seguro de que deseas bloquear a "${user.display_name || user.email}"?`)) {
    try {
      await lockUser(user.id)
      await loadUsers()
    } catch (error) {
      alert(error.message)
    }
  }
}

async function onUnlock(user) {
  if (confirm(`¿Estás seguro de que deseas desbloquear a "${user.display_name || user.email}"?`)) {
    try {
      await unlockUser(user.id)
      await loadUsers()
    } catch (error) {
      alert(error.message)
    }
  }
}

async function onDelete(user) {
  if (confirm(`¿Estás seguro de que deseas eliminar a "${user.display_name || user.email}"? Esta acción no se puede deshacer.`)) {
    try {
      await deleteUser(user.id)
      await loadUsers()
    } catch (error) {
      alert(error.message)
    }
  }
}
</script>
