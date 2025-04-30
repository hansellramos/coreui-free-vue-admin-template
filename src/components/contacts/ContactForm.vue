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
      <CFormLabel for="contactCountry">Country</CFormLabel>
      <CFormSelect id="contactCountry" v-model="form.country">
        <option value="">Select country</option>
        <option v-for="country in countries" :key="country.iso" :value="country.iso">{{ country.name }}</option>
      </CFormSelect>
    </div>
    <div class="mb-3">
      <CFormLabel for="contactState">State</CFormLabel>
      <CFormSelect id="contactState" v-model="form.state" :disabled="!form.country">
        <option value="">Select state</option>
        <option v-if="form.country && states.length === 0" disabled>No states found</option>
        <option v-for="state in states" :key="state.iso" :value="state.name">{{ state.name }}</option>
      </CFormSelect>
    </div>
    <div class="mb-3">
      <CFormLabel for="contactCity">City</CFormLabel>
      <CFormInput id="contactCity" v-model="form.city" type="text" placeholder="Enter city" />
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, defineProps, defineEmits, onMounted } from 'vue'
import { fetchCountries, fetchStatesByCountry } from '@/services/contactService'

const props = defineProps({
  modelValue: { type: Object, required: true },
  isEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue })
watch(() => props.modelValue, val => form.value = { ...val })

const countries = ref([])
const states = ref([])

onMounted(async () => {
  countries.value = await fetchCountries()
  if (form.value.country) {
    states.value = await fetchStatesByCountry(form.value.country)
  }
})

watch(() => form.value.country, async (newCountry) => {
  console.log('Country changed:', newCountry)
  form.value.state = ''
  try {
    const iso = newCountry?.trim().toUpperCase()
    states.value = iso ? await fetchStatesByCountry(iso) : []
  } catch (e) {
    console.error('Error loading states:', e)
    states.value = []
  }
  console.log('Loaded states:', states.value)
})

function handleSubmit() { emit('submit', { ...form.value }) }
function onCancel() { emit('cancel') }
</script>
