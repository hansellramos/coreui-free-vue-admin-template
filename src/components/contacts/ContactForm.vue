<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="contactFullname">Full Name</CFormLabel>
      <CFormInput id="contactFullname" v-model="form.fullname" type="text" placeholder="Enter full name" required />
    </div>
    <div class="mb-3">
      <CFormLabel for="contactWhatsapp">WhatsApp</CFormLabel>
      <CFormInput id="contactWhatsapp" v-model="form.whatsapp" type="text" placeholder="Enter WhatsApp number" />
    </div>
    <div class="mb-3">
      <CFormLabel for="contactCity">City</CFormLabel>
      <CFormInput id="contactCity" v-model="form.city" type="text" placeholder="Enter city" />
    </div>
    <div class="mb-3">
      <CFormLabel for="contactState">State</CFormLabel>
      <CFormInput id="contactState" v-model="form.state" type="text" placeholder="Enter state" />
    </div>
    <div class="mb-3">
      <CFormLabel for="contactCountry">Country</CFormLabel>
      <CFormInput id="contactCountry" v-model="form.country" type="text" placeholder="Enter country" />
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
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
watch(() => props.modelValue, val => form.value = { ...val })

function handleSubmit() { emit('submit', { ...form.value }) }
function onCancel() { emit('cancel') }
</script>
