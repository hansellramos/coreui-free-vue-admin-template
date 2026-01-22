<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-4">
      <CFormLabel for="contactOrganization">Organización *</CFormLabel>
      <CFormSelect 
        id="contactOrganization" 
        v-model="form.organizationId" 
        required
        :disabled="isEdit"
      >
        <option value="">Selecciona una organización</option>
        <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
      </CFormSelect>
      <div v-if="!form.organizationId && !isEdit" class="form-text text-warning">
        Debes seleccionar una organización para continuar
      </div>
    </div>
    
    <fieldset :disabled="!form.organizationId && !isEdit">
      <div class="mb-3">
        <CFormLabel for="contactFullname">Nombre Completo *</CFormLabel>
        <CFormInput id="contactFullname" v-model="form.fullname" type="text" placeholder="Ingresa el nombre completo" required />
      </div>
      <div class="mb-3">
        <CFormLabel for="contactWhatsapp">WhatsApp</CFormLabel>
        <CFormInput id="contactWhatsapp" v-model="form.whatsapp" type="text" placeholder="Ingresa el número de WhatsApp" />
      </div>
      <div class="mb-3">
        <CFormLabel for="contactCountry">País</CFormLabel>
        <CFormSelect id="contactCountry" v-model="form.country">
          <option value="">Selecciona un país</option>
          <option v-for="country in countries" :key="country.iso" :value="country.iso">{{ country.name }}</option>
        </CFormSelect>
      </div>
      <div class="mb-3">
        <CFormLabel for="contactState">Departamento</CFormLabel>
        <CFormSelect id="contactState" v-model="form.state" :disabled="!form.country">
          <option value="">Selecciona un departamento</option>
          <option v-if="form.country && states.length === 0" disabled>No hay departamentos</option>
          <option v-for="state in states" :key="state.iso" :value="state.name">{{ state.name }}</option>
        </CFormSelect>
      </div>
      <div class="mb-3">
        <CFormLabel for="contactCity">Ciudad</CFormLabel>
        <CFormInput id="contactCity" v-model="form.city" type="text" placeholder="Ingresa la ciudad" />
      </div>
      <CButton type="submit" color="primary" class="me-2" :disabled="!form.organizationId && !isEdit">{{ isEdit ? 'Actualizar' : 'Crear' }}</CButton>
      <CButton color="secondary" variant="outline" @click="onCancel">Cancelar</CButton>
    </fieldset>
  </CForm>
</template>

<script setup>
import { ref, watch, defineProps, defineEmits, onMounted } from 'vue'
import { fetchCountries, fetchStatesByCountry } from '@/services/contactService'
import { fetchOrganizations } from '@/services/organizationService'

const props = defineProps({
  modelValue: { type: Object, required: true },
  isEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue })
watch(() => props.modelValue, val => {
  if (val) form.value = { ...val }
}, { deep: true, immediate: true })

const organizations = ref([])
const countries = ref([])
const states = ref([])

onMounted(async () => {
  organizations.value = await fetchOrganizations()
  countries.value = await fetchCountries()
  if (form.value.country) {
    states.value = await fetchStatesByCountry(form.value.country)
  }
})

watch(() => form.value.country, async (newCountry) => {
  form.value.state = ''
  try {
    const iso = newCountry?.trim().toUpperCase()
    states.value = iso ? await fetchStatesByCountry(iso) : []
  } catch (e) {
    console.error('Error loading states:', e)
    states.value = []
  }
})

function handleSubmit() { emit('submit', { ...form.value }) }
function onCancel() { emit('cancel') }
</script>
