<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="venue">Venue</CFormLabel>
      <VenueAutocomplete v-model="form.venue" @venue-selected="onVenueSelected" />
    </div>
    
    <template v-if="form.venue">
      <div class="mb-3">
        <CFormLabel for="date">Date</CFormLabel>
        <CFormInput id="date" v-model="form.date" type="date" required />
      </div>
      <div class="mb-3 position-relative">
        <CFormLabel for="time">Time</CFormLabel>
        <CFormInput id="time" v-model="form.time" type="time" required @focus="showTimeOptions = true" @blur="hideTimeOptionsWithDelay" />
        <div v-if="showTimeOptions" class="d-flex gap-2 flex-wrap mt-2">
          <CButton v-for="t in timeOptions" :key="t" size="sm" color="secondary" variant="outline" @mousedown.prevent="selectTime(t)">{{ t }}</CButton>
        </div>
      </div>
      <div class="mb-3 position-relative">
        <CFormLabel for="duration">Duration</CFormLabel>
        <div class="d-flex align-items-center gap-2">
          <CFormInput id="duration" v-model.number="durationHuman" type="text" required @focus="showDurationOptions = true" @blur="hideDurationOptionsWithDelay" readonly />
          <CButton size="sm" color="secondary" variant="outline" @mousedown.prevent="addDay">+1D</CButton>
          <CButton size="sm" color="secondary" variant="outline" @mousedown.prevent="removeDay">-1D</CButton>
        </div>
        <div v-if="showDurationOptions" class="d-flex gap-2 flex-wrap mt-2">
          <CButton v-for="d in durationOptions" :key="d.label" size="sm" color="secondary" variant="outline" @mousedown.prevent="selectDuration(d.seconds)">{{ d.label }}</CButton>
        </div>
      </div>
      <div class="mb-3">
        <CFormLabel for="customer">Customer</CFormLabel>
        <CustomerAutocomplete v-model="form.customer" :organizationId="selectedVenueOrganization" />
      </div>
      <div class="row mb-3">
        <div class="col-4">
          <CFormLabel for="adults">Adultos</CFormLabel>
          <CFormInput id="adults" v-model.number="form.adults" type="number" min="0" />
        </div>
        <div class="col-4">
          <CFormLabel for="children">Niños</CFormLabel>
          <CFormInput id="children" v-model.number="form.children" type="number" min="0" />
        </div>
        <div class="col-4">
          <CFormLabel>Total asistentes</CFormLabel>
          <div class="form-control-plaintext fw-bold">{{ totalAttendees }}</div>
        </div>
      </div>
      <CButton type="submit" color="primary">{{ isEdit ? 'Update' : 'Create' }}</CButton>
      <CButton color="secondary" variant="outline" class="ms-2" @click="onCancel">Cancel</CButton>
    </template>
    
    <div v-else class="text-muted">
      Selecciona un venue para continuar
    </div>
  </CForm>
</template>

<script setup>
import { ref, watch, computed, defineProps, defineEmits } from 'vue'
import VenueAutocomplete from './VenueAutocomplete.vue'
import CustomerAutocomplete from './CustomerAutocomplete.vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  isEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue })
const selectedVenue = ref(null)
const selectedVenueOrganization = computed(() => selectedVenue.value?.organization || null)
const totalAttendees = computed(() => (form.value.adults || 0) + (form.value.children || 0))

const showTimeOptions = ref(false)
const timeOptions = ref(['08:00', '09:00', '15:00', '17:00', '18:00'])
const timeOptionsTimeout = ref(null)
const showDurationOptions = ref(false)
const durationOptions = ref([
  { label: '11H', seconds: 39600 },
  { label: '12H', seconds: 43200 },
  { label: '1D', seconds: 86400 },
  { label: '2D', seconds: 172800 },
  { label: '3D', seconds: 259200 }
])
const durationOptionsTimeout = ref(null)

watch(() => props.modelValue, val => {
  if (val) form.value = { ...val }
}, { deep: true, immediate: true })

const durationHuman = computed({
  get: () => {
    const hours = Math.floor(form.value.duration / 3600)
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    if (days > 0) {
      return `${days}D${remainingHours > 0 ? ` ${remainingHours}H` : ''}`
    } else {
      return `${hours}H`
    }
  },
  set: (val) => {}
})

function onVenueSelected(venue) {
  selectedVenue.value = venue
}

function handleSubmit() { emit('submit', { ...form.value }) }
function onCancel() { emit('cancel') }

function hideTimeOptionsWithDelay() {
  timeOptionsTimeout.value = setTimeout(() => {
    showTimeOptions.value = false
  }, 200)
}
function selectTime(t) {
  form.value.time = t
  showTimeOptions.value = false
  clearTimeout(timeOptionsTimeout.value)
}
function hideDurationOptionsWithDelay() {
  durationOptionsTimeout.value = setTimeout(() => {
    showDurationOptions.value = false
  }, 200)
}
function selectDuration(d) {
  form.value.duration = d
  showDurationOptions.value = false
  clearTimeout(durationOptionsTimeout.value)
}
function addDay() {
  form.value.duration += 86400
}
function removeDay() {
  form.value.duration -= 86400
  if (form.value.duration < 0) {
    form.value.duration = 0
  }
}
</script>
