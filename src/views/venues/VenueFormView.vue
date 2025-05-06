<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Venue</strong>
        </CCardHeader>
        <CCardBody>
          <VenueForm
            :modelValue="form"
            :isEdit="isEdit"
            @update:modelValue="val => form = val"
            @submit="handleSubmit"
            @cancel="handleCancel"
          />
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VenueForm from '@/components/venues/VenueForm.vue'
import { getVenueById, createVenue, updateVenue } from '@/services/venueService'

const route = useRoute()
const router = useRouter()
let form = ref({
  name: '',
  whatsapp: '',
  address: '',
  zip_code: '',
  latitude: '',
  longitude: '',
  city: '',
  country: '',
  department: '',
  suburb: '',
  address_reference: ''
})
const isEdit = computed(() => !!route.params.id)

onMounted(async () => {
  if (isEdit.value) {
    const venue = await getVenueById(route.params.id)
    if (venue) form.value = { ...venue }
  }
})

async function handleSubmit(data) {
  // Preparar datos, convertir campos numéricos vacíos a null
  const venueData = { ...data };
  
  // Latitude y longitude deben ser valores numéricos o null
  if (venueData.latitude === '') venueData.latitude = null;
  if (venueData.longitude === '') venueData.longitude = null;
  
  if (isEdit.value) {
    await updateVenue(route.params.id, venueData)
  } else {
    await createVenue(venueData)
  }
  router.push('/business/venues')
}

function handleCancel() {
  router.push('/business/venues')
}
</script>
