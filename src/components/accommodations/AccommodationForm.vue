<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="venue">Cabaña</CFormLabel>
      <VenueAutocomplete v-model="form.venue" @venue-selected="onVenueSelected" />
    </div>
    
    <template v-if="form.venue">
      <div class="mb-3">
        <CFormLabel for="plan">Plan</CFormLabel>
        <CFormSelect id="plan" v-model="form.plan_id" @change="onPlanChange">
          <option value="">-- Seleccionar plan --</option>
          <option v-for="plan in availablePlans" :key="plan.id" :value="plan.id">
            {{ plan.name }} ({{ planTypeLabel(plan.plan_type) }})
          </option>
        </CFormSelect>
        <div v-if="selectedPlan" class="small text-muted mt-1">
          Precio adulto: ${{ formatCurrency(selectedPlan.adult_price) }} | 
          Precio niño: ${{ formatCurrency(selectedPlan.child_price) }}
          <template v-if="selectedPlan.free_children_qty > 0">
            | {{ selectedPlan.free_children_qty }} niños gratis (hasta {{ selectedPlan.free_children_max_age }} años)
          </template>
        </div>
      </div>
      <div class="mb-3">
        <CFormLabel for="date">Fecha</CFormLabel>
        <CFormInput id="date" v-model="form.date" type="date" required />
      </div>
      <div class="mb-3 position-relative">
        <CFormLabel for="time">Hora</CFormLabel>
        <CFormInput id="time" v-model="form.time" type="time" required @focus="showTimeOptions = true" @blur="hideTimeOptionsWithDelay" />
        <div v-if="showTimeOptions" class="d-flex gap-2 flex-wrap mt-2">
          <CButton v-for="t in timeOptions" :key="t" size="sm" color="secondary" variant="outline" @mousedown.prevent="selectTime(t)">{{ t }}</CButton>
        </div>
      </div>
      <div class="mb-3 position-relative">
        <CFormLabel for="duration">Duración</CFormLabel>
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
        <CFormLabel for="customer">Cliente</CFormLabel>
        <CustomerAutocomplete v-model="form.customer" :organizationId="selectedVenueOrganization" />
      </div>
      <div class="row mb-3">
        <div class="col-4">
          <CFormLabel for="adults">Adultos</CFormLabel>
          <CFormInput id="adults" v-model.number="form.adults" type="number" min="0" @input="calculatePrice" />
        </div>
        <div class="col-4">
          <CFormLabel for="children">Niños</CFormLabel>
          <CFormInput id="children" v-model.number="form.children" type="number" min="0" @input="calculatePrice" />
        </div>
        <div class="col-4">
          <CFormLabel>Total asistentes</CFormLabel>
          <div class="form-control-plaintext fw-bold">{{ totalAttendees }}</div>
        </div>
      </div>
      
      <div class="row mb-3" v-if="selectedPlan">
        <div class="col-6">
          <CFormLabel>Precio calculado</CFormLabel>
          <div class="form-control-plaintext">
            <span class="fw-bold text-primary">${{ formatCurrency(form.calculated_price || 0) }}</span>
            <div v-if="priceBreakdown" class="small text-muted">{{ priceBreakdown }}</div>
          </div>
        </div>
        <div class="col-6">
          <CFormLabel for="agreed_price">Precio acordado</CFormLabel>
          <CFormInput 
            id="agreed_price" 
            v-model.number="form.agreed_price" 
            type="number" 
            min="0" 
            step="1000"
            placeholder="Igual al calculado si está vacío"
          />
          <div v-if="discountPercentage !== 0" class="small mt-1">
            <span v-if="discountPercentage > 0" class="text-success">
              <s class="text-muted">${{ formatCurrency(form.calculated_price) }}</s>
              → ${{ formatCurrency(form.agreed_price) }}
              <strong>(-{{ discountPercentage }}%)</strong>
            </span>
            <span v-else class="text-warning">
              +{{ Math.abs(discountPercentage) }}% sobre el precio calculado
            </span>
          </div>
        </div>
      </div>

      <CButton type="submit" color="primary">{{ isEdit ? 'Actualizar' : 'Crear' }}</CButton>
      <CButton color="secondary" variant="outline" class="ms-2" @click="onCancel">Cancelar</CButton>
    </template>
    
    <div v-else class="text-muted">
      Selecciona una cabaña para continuar
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
const availablePlans = ref([])
const selectedVenueOrganization = computed(() => selectedVenue.value?.organization || null)
const totalAttendees = computed(() => (form.value.adults || 0) + (form.value.children || 0))
const priceBreakdown = ref('')

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

const selectedPlan = computed(() => {
  if (!form.value.plan_id) return null
  return availablePlans.value.find(p => p.id === form.value.plan_id)
})

const discountPercentage = computed(() => {
  if (form.value.calculated_price === null || form.value.calculated_price === undefined) return 0
  if (form.value.agreed_price === null || form.value.agreed_price === undefined) return 0
  if (Number(form.value.calculated_price) === Number(form.value.agreed_price)) return 0
  const diff = Number(form.value.calculated_price) - Number(form.value.agreed_price)
  return Math.round((diff / Number(form.value.calculated_price)) * 100)
})

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

async function fetchPlansForVenue(venueId) {
  try {
    const res = await fetch(`/api/venue-plans?venue_id=${venueId}`)
    if (res.ok) {
      availablePlans.value = await res.json()
    }
  } catch (e) {
    console.error('Error fetching plans:', e)
  }
}

function onVenueSelected(venue) {
  selectedVenue.value = venue
  if (venue?.id) {
    fetchPlansForVenue(venue.id)
  } else {
    availablePlans.value = []
  }
  form.value.plan_id = ''
  form.value.calculated_price = null
  form.value.agreed_price = null
}

function onPlanChange() {
  calculatePrice()
}

function calculatePrice() {
  const plan = selectedPlan.value
  if (!plan) {
    form.value.calculated_price = null
    priceBreakdown.value = ''
    return
  }

  const adults = form.value.adults || 0
  const children = form.value.children || 0
  const adultPrice = parseFloat(plan.adult_price) || 0
  const childPrice = parseFloat(plan.child_price) || 0
  const freeChildrenQty = plan.free_children_qty || 0
  const minGuests = plan.min_guests || 1

  let chargeableChildren = children
  if (freeChildrenQty > 0 && children > 0) {
    chargeableChildren = Math.max(0, children - freeChildrenQty)
  }

  let effectiveAdults = adults
  if (adults < minGuests) {
    effectiveAdults = minGuests
  }

  const adultTotal = effectiveAdults * adultPrice
  const childTotal = chargeableChildren * childPrice
  const total = adultTotal + childTotal

  form.value.calculated_price = total

  let breakdown = `${effectiveAdults} adultos × $${formatCurrency(adultPrice)}`
  if (adults < minGuests) {
    breakdown += ` (mín. ${minGuests})`
  }
  if (chargeableChildren > 0) {
    breakdown += ` + ${chargeableChildren} niños × $${formatCurrency(childPrice)}`
  }
  if (freeChildrenQty > 0 && children > 0 && children <= freeChildrenQty) {
    breakdown += ` (${children} niños gratis)`
  } else if (freeChildrenQty > 0 && children > freeChildrenQty) {
    breakdown += ` (${freeChildrenQty} gratis)`
  }
  priceBreakdown.value = breakdown
}

function planTypeLabel(type) {
  const labels = {
    pasadia: 'Pasadía',
    pasanoche: 'Pasanoche',
    hospedaje: 'Hospedaje'
  }
  return labels[type] || type
}

function formatCurrency(value) {
  if (value == null) return '0'
  return Number(value).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function handleSubmit() {
  const data = { ...form.value }
  if (data.agreed_price === null || data.agreed_price === undefined || data.agreed_price === '') {
    data.agreed_price = data.calculated_price
  }
  emit('submit', data)
}
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

watch(() => form.value.venue, async (newVenueId) => {
  if (newVenueId && !selectedVenue.value) {
    await fetchPlansForVenue(newVenueId)
    if (form.value.plan_id && availablePlans.value.length > 0) {
      calculatePrice()
    }
  }
}, { immediate: true })
</script>
