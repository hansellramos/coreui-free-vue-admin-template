<template>
  <div>
    <h3>Formulario de Organización</h3>
    <CForm @submit.prevent="handleSubmit">
      <div class="mb-3">
        <CFormLabel for="orgName">Organization Name</CFormLabel>
        <CFormInput
          id="orgName"
          v-model="form.name"
          type="text"
          placeholder="Enter organization name"
          required
        />
      </div>
      <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
      <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
    </CForm>
  </div>
</template>

<script setup>
import { ref, watch, defineProps, defineEmits } from 'vue'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue })

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      form.value = { ...val }
    }
  },
  { deep: true, immediate: true }
)

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}
</script>
