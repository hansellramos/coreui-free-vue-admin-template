<template>
  <CRow>
    <CCol :xs="12" :lg="8" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>{{ isNew ? 'Nueva Cotización' : 'Editar Cotización' }}</strong>
          <CBadge v-if="!isNew && form.status" :color="getStatusColor(form.status)">
            {{ getStatusLabel(form.status) }}
          </CBadge>
        </CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="saveEstimate">
            <CRow>
              <CCol :md="6">
                <div class="mb-3">
                  <CFormLabel>Cliente</CFormLabel>
                  <CFormInput v-model="form.customer_name" placeholder="Nombre del cliente" />
                </div>
              </CCol>
              <CCol :md="3">
                <div class="mb-3">
                  <CFormLabel>Tipo de contacto</CFormLabel>
                  <CFormSelect v-model="form.contact_type">
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                  </CFormSelect>
                </div>
              </CCol>
              <CCol :md="3">
                <div class="mb-3">
                  <CFormLabel>Contacto</CFormLabel>
                  <CFormInput v-model="form.contact_value" :placeholder="form.contact_type === 'whatsapp' ? '3101234567' : '@usuario'" />
                </div>
              </CCol>
            </CRow>
            
            <CRow>
              <CCol :md="6">
                <div class="mb-3">
                  <CFormLabel>Cabaña</CFormLabel>
                  <CFormSelect v-model="form.venue_id" @change="loadPlans" :disabled="!isNew">
                    <option value="">Seleccionar cabaña</option>
                    <option v-for="venue in venues" :key="venue.id" :value="venue.id">
                      {{ venue.name }}
                    </option>
                  </CFormSelect>
                </div>
              </CCol>
              <CCol :md="6">
                <div class="mb-3">
                  <CFormLabel>Plan</CFormLabel>
                  <CFormSelect v-model="form.plan_id">
                    <option value="">Seleccionar plan</option>
                    <option v-for="plan in plans" :key="plan.id" :value="plan.id">
                      {{ plan.name }} - {{ formatCurrency(plan.adult_price) }}/adulto
                    </option>
                  </CFormSelect>
                </div>
              </CCol>
            </CRow>
            
            <CRow>
              <CCol :md="3">
                <div class="mb-3">
                  <CFormLabel>Check-in</CFormLabel>
                  <CFormInput type="date" v-model="form.check_in" />
                </div>
              </CCol>
              <CCol :md="3">
                <div class="mb-3">
                  <CFormLabel>Check-out</CFormLabel>
                  <CFormInput type="date" v-model="form.check_out" />
                </div>
              </CCol>
              <CCol :md="3">
                <div class="mb-3">
                  <CFormLabel>Adultos</CFormLabel>
                  <CFormInput type="number" v-model.number="form.adults" min="0" />
                </div>
              </CCol>
              <CCol :md="3">
                <div class="mb-3">
                  <CFormLabel>Niños</CFormLabel>
                  <CFormInput type="number" v-model.number="form.children" min="0" />
                </div>
              </CCol>
            </CRow>
            
            <CRow>
              <CCol :md="4">
                <div class="mb-3">
                  <CFormLabel>Precio calculado</CFormLabel>
                  <CFormInput type="number" v-model.number="form.calculated_price" />
                </div>
              </CCol>
              <CCol :md="4">
                <div class="mb-3">
                  <CFormLabel>Estado</CFormLabel>
                  <CFormSelect v-model="form.status">
                    <option value="pending">Pendiente</option>
                    <option value="confirmed">Confirmada</option>
                    <option value="converted">Convertida</option>
                    <option value="cancelled">Cancelada</option>
                  </CFormSelect>
                </div>
              </CCol>
            </CRow>
            
            <div class="mb-3">
              <CFormLabel>Notas</CFormLabel>
              <CFormTextarea v-model="form.notes" rows="3" />
            </div>
            
            <div class="d-flex justify-content-between">
              <CButton color="secondary" variant="outline" @click="$router.push('/business/estimates')">
                Volver
              </CButton>
              <div class="d-flex gap-2">
                <CButton 
                  v-if="!isNew && (form.status === 'pending' || form.status === 'confirmed')"
                  color="success" 
                  @click="convertToAccommodation"
                >
                  <CIcon :icon="cilCheckCircle" class="me-1" /> Convertir a Hospedaje
                </CButton>
                <CButton color="primary" type="submit" :disabled="saving">
                  <CSpinner v-if="saving" size="sm" class="me-1" />
                  Guardar
                </CButton>
              </div>
            </div>
          </CForm>
        </CCardBody>
      </CCard>
      
      <CCard v-if="!isNew && form.conversation_id" class="mb-4">
        <CCardHeader>
          <strong>Conversación Relacionada</strong>
        </CCardHeader>
        <CCardBody>
          <p class="text-muted mb-0">
            Esta cotización fue creada desde una conversación de chat.
            <RouterLink :to="`/business/venues/${form.venue_id}/chat`">Ver conversación</RouterLink>
          </p>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
  
  <CToaster placement="top-end">
    <CToast v-if="toast.visible" :color="toast.color" class="text-white" :autohide="true" :delay="3000" @close="toast.visible = false">
      <CToastBody>{{ toast.message }}</CToastBody>
    </CToast>
  </CToaster>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CIcon } from '@coreui/icons-vue'
import { cilCheckCircle } from '@coreui/icons'
import { getEstimateById, updateEstimate, createEstimate, convertEstimate } from '@/services/estimateService'
import { useBreadcrumbStore } from '@/stores/breadcrumb.js'

const route = useRoute()
const router = useRouter()
const breadcrumbStore = useBreadcrumbStore()

const isNew = computed(() => !route.params.id)
const saving = ref(false)
const venues = ref([])
const plans = ref([])

const form = ref({
  venue_id: '',
  plan_id: '',
  customer_name: '',
  contact_type: 'whatsapp',
  contact_value: '',
  check_in: '',
  check_out: '',
  adults: 0,
  children: 0,
  calculated_price: null,
  notes: '',
  status: 'pending',
  conversation_id: null
})

const toast = ref({
  visible: false,
  message: '',
  color: 'success'
})

const showToast = (message, color = 'success') => {
  toast.value = { visible: true, message, color }
}

const loadVenues = async () => {
  try {
    const response = await fetch('/api/venues', { credentials: 'include' })
    if (response.ok) {
      venues.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venues:', error)
  }
}

const loadPlans = async () => {
  if (!form.value.venue_id) {
    plans.value = []
    return
  }
  try {
    const response = await fetch(`/api/venues/${form.value.venue_id}/plans`, { credentials: 'include' })
    if (response.ok) {
      plans.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading plans:', error)
  }
}

const loadEstimate = async () => {
  if (isNew.value) return
  try {
    const data = await getEstimateById(route.params.id)
    form.value = {
      venue_id: data.venue_id || '',
      plan_id: data.plan_id || '',
      customer_name: data.customer_name || '',
      contact_type: data.contact_type || 'whatsapp',
      contact_value: data.contact_value || '',
      check_in: data.check_in ? data.check_in.split('T')[0] : '',
      check_out: data.check_out ? data.check_out.split('T')[0] : '',
      adults: data.adults || 0,
      children: data.children || 0,
      calculated_price: data.calculated_price,
      notes: data.notes || '',
      status: data.status || 'pending',
      conversation_id: data.conversation_id
    }
    if (form.value.venue_id) {
      await loadPlans()
    }
    if (data.customer_name) {
      breadcrumbStore.setTitle(`Editar ${data.customer_name}`)
    }
  } catch (error) {
    console.error('Error loading estimate:', error)
    showToast('Error al cargar cotización', 'danger')
  }
}

const saveEstimate = async () => {
  saving.value = true
  try {
    if (isNew.value) {
      await createEstimate(form.value)
      showToast('Cotización creada exitosamente')
      router.push('/business/estimates')
    } else {
      await updateEstimate(route.params.id, form.value)
      showToast('Cotización actualizada exitosamente')
    }
  } catch (error) {
    showToast(error.message, 'danger')
  } finally {
    saving.value = false
  }
}

const convertToAccommodation = async () => {
  if (!confirm('¿Convertir esta cotización en un hospedaje?')) return
  try {
    const result = await convertEstimate(route.params.id)
    showToast('Cotización convertida a hospedaje exitosamente')
    router.push(`/business/accommodations/${result.accommodation_id}`)
  } catch (error) {
    showToast(error.message, 'danger')
  }
}

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)
}

const getStatusColor = (status) => {
  switch (status) {
    case 'pending': return 'warning'
    case 'confirmed': return 'info'
    case 'converted': return 'success'
    case 'cancelled': return 'danger'
    default: return 'secondary'
  }
}

const getStatusLabel = (status) => {
  switch (status) {
    case 'pending': return 'Pendiente'
    case 'confirmed': return 'Confirmada'
    case 'converted': return 'Convertida'
    case 'cancelled': return 'Cancelada'
    default: return status
  }
}

watch(() => [form.value.plan_id, form.value.adults, form.value.children], () => {
  if (form.value.plan_id && plans.value.length > 0) {
    const selectedPlan = plans.value.find(p => p.id === form.value.plan_id)
    if (selectedPlan) {
      const adultPrice = parseFloat(selectedPlan.adult_price) || 0
      const childPrice = parseFloat(selectedPlan.child_price) || 0
      form.value.calculated_price = (adultPrice * (form.value.adults || 0)) + (childPrice * (form.value.children || 0))
    }
  }
})

onMounted(async () => {
  await loadVenues()
  await loadEstimate()
})
</script>
