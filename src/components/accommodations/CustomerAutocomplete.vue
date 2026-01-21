<template>
  <div style="position:relative">
    <CFormInput
      v-model="query"
      @input="onInput"
      @focus="showDropdown = true"
      @blur="hideDropdownWithDelay"
      placeholder="Type customer name or phone"
    />
    <ul v-if="showDropdown && (filteredContacts.length || query)" class="list-group position-absolute w-100 mt-1" style="z-index:10;max-height:220px;overflow-y:auto;">
      <li v-for="contact in filteredContacts" :key="contact.id" class="list-group-item list-group-item-action" style="cursor:pointer;" @mousedown.prevent="selectContact(contact)">
        {{ contact.fullname }} <span class="text-muted">{{ contact.whatsapp || contact.user?.email }}</span>
      </li>
      <li v-if="query && !filteredContacts.length && !showCreateForm" class="list-group-item list-group-item-action text-primary" style="cursor:pointer;" @mousedown.prevent="startCreateCustomer">
        + Crear nuevo cliente "{{ query }}"
      </li>
    </ul>
    
    <CModal :visible="showCreateForm" @close="cancelCreate" alignment="center">
      <CModalHeader>
        <CModalTitle>Crear Nuevo Cliente</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div class="mb-3">
          <CFormLabel>Nombre completo</CFormLabel>
          <CFormInput v-model="newCustomer.fullname" placeholder="Nombre del cliente" required />
        </div>
        <div class="mb-3">
          <CFormLabel>WhatsApp</CFormLabel>
          <CFormInput v-model="newCustomer.whatsapp" placeholder="Número de WhatsApp" type="number" required />
        </div>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" @click="cancelCreate">Cancelar</CButton>
        <CButton color="primary" @click="createCustomer" :disabled="!newCustomer.fullname || !newCustomer.whatsapp">Crear</CButton>
      </CModalFooter>
    </CModal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter, CButton, CFormInput, CFormLabel } from '@coreui/vue'
import { fetchContacts, createContact } from '@/services/contactService'

const props = defineProps({
  modelValue: String,
})
const emit = defineEmits(['update:modelValue'])

const query = ref('')
const showDropdown = ref(false)
const contacts = ref([])
const showCreateForm = ref(false)
const newCustomer = ref({ fullname: '', whatsapp: '' })

const filteredContacts = computed(() => {
  if (!query.value) return contacts.value.slice(0, 10)
  const q = query.value.toLowerCase()
  return contacts.value.filter(c =>
    (c.fullname && c.fullname.toLowerCase().includes(q)) ||
    (c.whatsapp && String(c.whatsapp).includes(q)) ||
    (c.user && c.user.email && c.user.email.toLowerCase().includes(q))
  ).slice(0, 10)
})

function onInput() {
  showDropdown.value = true
}

function selectContact(contact) {
  query.value = contact.fullname
  showDropdown.value = false
  emit('update:modelValue', contact.id)
}

function hideDropdownWithDelay() {
  setTimeout(() => { showDropdown.value = false }, 150)
}

function startCreateCustomer() {
  newCustomer.value = { fullname: query.value, whatsapp: '' }
  showCreateForm.value = true
  showDropdown.value = false
}

function cancelCreate() {
  showCreateForm.value = false
  newCustomer.value = { fullname: '', whatsapp: '' }
}

async function createCustomer() {
  try {
    const created = await createContact({
      fullname: newCustomer.value.fullname,
      whatsapp: newCustomer.value.whatsapp ? Number(newCustomer.value.whatsapp) : null
    })
    if (created && created.id) {
      contacts.value.push(created)
      query.value = created.fullname
      emit('update:modelValue', created.id)
    }
    showCreateForm.value = false
    newCustomer.value = { fullname: '', whatsapp: '' }
  } catch (error) {
    console.error('Error creating customer:', error)
  }
}

onMounted(async () => {
  contacts.value = await fetchContacts()
  if (props.modelValue) {
    const c = contacts.value.find(c => c.id === props.modelValue)
    if (c) query.value = c.fullname
  }
})

watch(() => props.modelValue, val => {
  const c = contacts.value.find(c => c.id === val)
  if (c) query.value = c.fullname
})
</script>
