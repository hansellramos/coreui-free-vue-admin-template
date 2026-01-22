<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEditing ? 'Editar Perfil' : 'Crear Perfil' }}</strong>
        </CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="saveProfile">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Código</CFormLabel>
                <CFormInput
                  v-model="form.code"
                  placeholder="organization:custom"
                  required
                  :disabled="isEditing && existingProfile?.is_system"
                />
              </CCol>
              <CCol :md="6">
                <CFormLabel>Nombre</CFormLabel>
                <CFormInput
                  v-model="form.name"
                  placeholder="Nombre del perfil"
                  required
                  :disabled="existingProfile?.is_system"
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :xs="12">
                <CFormLabel>Descripción</CFormLabel>
                <CFormTextarea
                  v-model="form.description"
                  rows="2"
                  placeholder="Descripción del perfil"
                  :disabled="existingProfile?.is_system"
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :xs="12">
                <CFormLabel>Permisos</CFormLabel>
                <div v-if="loading" class="text-muted">Cargando permisos...</div>
                <div v-else class="row">
                  <div v-for="permission in allPermissions" :key="permission.id" class="col-md-4 col-lg-3 mb-2">
                    <CFormCheck
                      :id="permission.code"
                      :label="permission.name"
                      :checked="form.permissions.includes(permission.code)"
                      @change="togglePermission(permission.code)"
                      :disabled="existingProfile?.is_system"
                    />
                    <div class="small text-muted ps-4">{{ permission.description }}</div>
                  </div>
                </div>
              </CCol>
            </CRow>
            <div class="d-flex gap-2">
              <CButton v-if="!existingProfile?.is_system" type="submit" color="primary" :disabled="saving">
                {{ saving ? 'Guardando...' : 'Guardar' }}
              </CButton>
              <CButton color="secondary" variant="outline" @click="goBack">
                {{ existingProfile?.is_system ? 'Volver' : 'Cancelar' }}
              </CButton>
            </div>
          </CForm>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const isEditing = computed(() => !!route.params.id && route.params.id !== 'new')
const existingProfile = ref(null)
const allPermissions = ref([])
const loading = ref(true)
const saving = ref(false)

const form = ref({
  code: '',
  name: '',
  description: '',
  permissions: []
})

const goBack = () => {
  router.push('/admin/profiles')
}

const loadPermissions = async () => {
  try {
    const response = await fetch('/api/permissions')
    if (response.ok) {
      allPermissions.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading permissions:', error)
  } finally {
    loading.value = false
  }
}

const loadProfile = async () => {
  if (!isEditing.value) return
  try {
    const response = await fetch(`/api/profiles/${route.params.id}`)
    if (response.ok) {
      const profile = await response.json()
      existingProfile.value = profile
      form.value = {
        code: profile.code || '',
        name: profile.name || '',
        description: profile.description || '',
        permissions: Array.isArray(profile.permissions) ? profile.permissions : []
      }
    }
  } catch (error) {
    console.error('Error loading profile:', error)
  }
}

const togglePermission = (code) => {
  const index = form.value.permissions.indexOf(code)
  if (index === -1) {
    form.value.permissions.push(code)
  } else {
    form.value.permissions.splice(index, 1)
  }
}

const saveProfile = async () => {
  saving.value = true
  try {
    const url = isEditing.value ? `/api/profiles/${route.params.id}` : '/api/profiles'
    const method = isEditing.value ? 'PUT' : 'POST'
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form.value)
    })
    
    if (response.ok) {
      router.push('/admin/profiles')
    } else {
      const data = await response.json()
      alert(data.error || 'Error al guardar perfil')
    }
  } catch (error) {
    console.error('Error saving profile:', error)
    alert('Error al guardar perfil')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadPermissions()
  loadProfile()
})
</script>
