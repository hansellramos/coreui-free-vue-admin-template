<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="venueName">Venue Name</CFormLabel>
      <CFormInput
        id="venueName"
        v-model="form.name"
        type="text"
        placeholder="Enter venue name"
        required
      />
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
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
    form.value = { ...val }
  }
)

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}
</script>
