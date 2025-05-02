<template>
  <div style="position:relative">
    <CFormInput
      v-model="query"
      @input="onInput"
      @blur="hideDropdownWithDelay"
      placeholder="Type customer name or email"
      required
    />
    <ul v-if="showDropdown && filteredContacts.length" class="list-group position-absolute w-100 mt-1" style="z-index:10;max-height:180px;overflow-y:auto;">
      <li v-for="contact in filteredContacts" :key="contact.id" class="list-group-item list-group-item-action" style="cursor:pointer;" @mousedown.prevent="selectContact(contact)">
        {{ contact.fullname }} <span class="text-muted">{{ contact.user?.email }}</span>
      </li>
    </ul>
    <div v-else-if="showDropdown && query && !filteredContacts.length" class="text-muted mt-1">No contacts found</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { fetchContacts } from '@/services/contactService'
const props = defineProps({
  modelValue: String,
})
const emit = defineEmits(['update:modelValue'])
const query = ref('')
const showDropdown = ref(false)
const contacts = ref([])
const filteredContacts = computed(() => {
  if (!query.value) return contacts.value
  const q = query.value.toLowerCase()
  return contacts.value.filter(c =>
    (c.fullname && c.fullname.toLowerCase().includes(q)) ||
    (c.user && c.user.email && c.user.email.toLowerCase().includes(q))
  )
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
onMounted(async () => {
  contacts.value = await fetchContacts()
  // If editing, show the name
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
