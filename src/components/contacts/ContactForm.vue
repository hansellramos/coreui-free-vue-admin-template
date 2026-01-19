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
    <div class="mb-3">
      <CFormLabel for="contactUser">Linked User</CFormLabel>
      <div v-if="selectedUser" class="alert alert-info mt-2 d-flex align-items-center justify-content-between">
        <span>
          Selected: <strong>{{ selectedUser.display_name || selectedUser.email }}</strong>
          <span v-if="selectedUser.display_name && selectedUser.email"> ({{ selectedUser.email }})</span>
        </span>
        <CButton color="danger" size="sm" variant="outline" @click="clearSelectedUser">Remove</CButton>
      </div>
      <template v-else>
        <CFormInput
          id="contactUser"
          v-model="userQuery"
          type="text"
          placeholder="Type name or email"
          autocomplete="off"
          @input="onUserInput"
        />
        <ul v-if="userQuery && filteredUsers.length" class="list-group mt-1" style="max-height:180px;overflow-y:auto;">
          <li v-for="user in filteredUsers" :key="user.id" class="list-group-item list-group-item-action"
              style="cursor:pointer;"
              @mousedown.prevent="selectUser(user)">
            {{ user.display_name || user.email }} <span class="text-muted">{{ user.email }}</span>
          </li>
        </ul>
        <div v-else-if="userQuery && !filteredUsers.length" class="text-muted mt-1">No users found</div>
      </template>
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, defineProps, defineEmits, onMounted, computed } from 'vue'
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
const users = ref([])
const userQuery = ref('')
const selectedUser = computed(() => users.value.find(u => u.id === form.value.user) || null)
const filteredUsers = computed(() => {
  if (!userQuery.value) return users.value
  const q = userQuery.value.toLowerCase()
  return users.value.filter(u =>
    (u.display_name && u.display_name.toLowerCase().includes(q)) ||
    (u.email && u.email.toLowerCase().includes(q))
  )
})

onMounted(async () => {
  countries.value = await fetchCountries()
  if (form.value.country) {
    states.value = await fetchStatesByCountry(form.value.country)
  }
  // Load users
  users.value = []
  // Set initial query if editing
  if (form.value.user && typeof form.value.user === 'object' && form.value.user.id) {
    // If form.value.user is an object (from getContactById join)
    userQuery.value = form.value.user.display_name || form.value.user.email
    form.value.user = form.value.user.id
  } else if (form.value.user) {
    // If it's just the id, try to find and set the display name/email
    const u = users.value.find(u => u.id === form.value.user)
    if (u) userQuery.value = u.display_name || u.email
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

function onUserInput() {
  // showUserDropdown.value = true
}
function selectUser(user) {
  form.value.user = user.id
  userQuery.value = ''
  // showUserDropdown.value = false
  emit('update:modelValue', { ...form.value, user: user.id })
}
function clearSelectedUser() {
  form.value.user = ''
  userQuery.value = ''
  emit('update:modelValue', { ...form.value, user: '' })
}
function handleSubmit() { emit('submit', { ...form.value }) }
function onCancel() { emit('cancel') }
</script>
