<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Accommodation</strong>
        </CCardHeader>
        <CCardBody>
          <AccommodationForm
            v-model="form"
            :isEdit="isEdit"
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
import AccommodationForm from '@/components/accommodations/AccommodationForm.vue'
import { getAccommodationById, createAccommodation, updateAccommodation } from '@/services/accommodationService'

const route = useRoute()
const router = useRouter()
let form = ref({ venue: '', date: '', time: '', duration: '', customer: '', adults: 0, children: 0, plan_id: '', calculated_price: null, agreed_price: null })
const isEdit = computed(() => !!route.params.id)

function formatDateForInput(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeForInput(timeStr) {
  if (!timeStr) return ''
  if (timeStr.includes('T')) {
    const d = new Date(timeStr)
    const hours = String(d.getUTCHours()).padStart(2, '0')
    const mins = String(d.getUTCMinutes()).padStart(2, '0')
    return `${hours}:${mins}`
  }
  return timeStr.slice(0, 5)
}

onMounted(async () => {
  if (isEdit.value) {
    const accommodation = await getAccommodationById(route.params.id)
    if (accommodation) {
      form.value = {
        ...accommodation,
        date: formatDateForInput(accommodation.date),
        time: formatTimeForInput(accommodation.time),
        duration: Number(accommodation.duration) || 0
      }
    }
  }
})

async function handleSubmit(data) {
  if (isEdit.value) await updateAccommodation(route.params.id, data)
  else await createAccommodation(data)
  router.push('/business/accommodations')
}

function handleCancel() {
  router.push('/business/accommodations')
}
</script>
