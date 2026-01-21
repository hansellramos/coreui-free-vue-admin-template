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
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Actualizar' : 'Crear' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancelar</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, defineProps, defineEmits } from 'vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  isEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue })

watch(() => props.modelValue, val => {
  if (val) form.value = { ...val }
}, { deep: true, immediate: true })

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}
</script>
