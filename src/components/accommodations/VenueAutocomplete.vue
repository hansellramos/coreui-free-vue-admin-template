<template>
  <div style="position:relative">
    <CFormInput
      v-model="query"
      @input="onInput"
      @blur="hideDropdownWithDelay"
      placeholder="Type venue name"
      required
    />
    <ul v-if="showDropdown && filteredVenues.length" class="list-group position-absolute w-100 mt-1" style="z-index:10;max-height:180px;overflow-y:auto;">
      <li v-for="venue in filteredVenues" :key="venue.id" class="list-group-item list-group-item-action" style="cursor:pointer;" @mousedown.prevent="selectVenue(venue)">
        {{ venue.name }}
      </li>
    </ul>
    <div v-else-if="showDropdown && query && !filteredVenues.length" class="text-muted mt-1">No venues found</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { fetchVenues } from '@/services/venueService'
const props = defineProps({
  modelValue: String,
})
const emit = defineEmits(['update:modelValue'])
const query = ref('')
const showDropdown = ref(false)
const venues = ref([])
const filteredVenues = computed(() => {
  if (!query.value) return venues.value
  const q = query.value.toLowerCase()
  return venues.value.filter(v => v.name && v.name.toLowerCase().includes(q))
})
function onInput() {
  showDropdown.value = true
}
function selectVenue(venue) {
  query.value = venue.name
  showDropdown.value = false
  emit('update:modelValue', venue.id)
}
function hideDropdownWithDelay() {
  setTimeout(() => { showDropdown.value = false }, 150)
}
onMounted(async () => {
  venues.value = await fetchVenues()
  // If editing, show the name
  if (props.modelValue) {
    const v = venues.value.find(v => v.id === props.modelValue)
    if (v) query.value = v.name
  }
})
watch(() => props.modelValue, val => {
  const v = venues.value.find(v => v.id === val)
  if (v) query.value = v.name
})
</script>
