<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="userEmail">Email</CFormLabel>
      <CFormInput
        id="userEmail"
        v-model="form.email"
        type="email"
        placeholder="Ingresa el email"
        required
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="userDisplayName">Nombre</CFormLabel>
      <CFormInput
        id="userDisplayName"
        v-model="form.display_name"
        type="text"
        placeholder="Ingresa el nombre"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="userAvatarUrl">URL del Avatar</CFormLabel>
      <CFormInput
        id="userAvatarUrl"
        v-model="form.avatar_url"
        type="url"
        placeholder="https://ejemplo.com/avatar.jpg"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="userRole">Rol</CFormLabel>
      <CFormSelect id="userRole" v-model="form.role">
        <option value="user">Usuario</option>
        <option value="manager">Manager</option>
        <option value="admin">Administrador</option>
      </CFormSelect>
    </div>
    <div class="mb-3">
      <CFormLabel for="userProfile">Perfil de Permisos</CFormLabel>
      <CFormSelect id="userProfile" v-model="form.profile_id">
        <option value="">-- Seleccionar perfil --</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
          {{ profile.name }}
        </option>
      </CFormSelect>
      <div class="form-text">El perfil determina qué acciones puede realizar el usuario</div>
    </div>
    <div class="mb-3">
      <CFormLabel>Organizaciones Asignadas</CFormLabel>
      <div class="border rounded p-3" style="max-height: 200px; overflow-y: auto;">
        <div v-for="org in organizations" :key="org.id" class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            :id="'org-' + org.id"
            :value="org.id"
            v-model="form.organization_ids"
          />
          <label class="form-check-label" :for="'org-' + org.id">
            {{ org.name }}
          </label>
        </div>
        <div v-if="organizations.length === 0" class="text-muted">
          No hay organizaciones disponibles
        </div>
      </div>
      <div class="form-text">El usuario solo podrá ver datos de las organizaciones seleccionadas</div>
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Actualizar' : 'Crear' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancelar</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, onMounted, defineProps, defineEmits } from 'vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  isEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue, profile_id: '', organization_ids: [] })
const profiles = ref([])
const organizations = ref([])

watch(() => props.modelValue, val => {
  if (val) {
    form.value = { 
      ...val, 
      profile_id: val.profile_id || '',
      organization_ids: val.organization_ids || []
    }
  }
}, { deep: true, immediate: true })

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles')
    if (res.ok) {
      profiles.value = await res.json()
    }
  } catch (error) {
    console.error('Error loading profiles:', error)
  }
}

async function loadOrganizations() {
  try {
    const res = await fetch('/api/organizations')
    if (res.ok) {
      organizations.value = await res.json()
    }
  } catch (error) {
    console.error('Error loading organizations:', error)
  }
}

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}

onMounted(() => {
  loadProfiles()
  loadOrganizations()
})
</script>
