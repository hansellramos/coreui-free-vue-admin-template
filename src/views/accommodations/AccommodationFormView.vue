<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Accommodation</strong>
        </CCardHeader>
        <CCardBody>
          <AccommodationForm
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
import AccommodationForm from '@/components/accommodations/AccommodationForm.vue'
import { getAccommodationById, createAccommodation, updateAccommodation } from '@/services/accommodationService'

const route = useRoute()
const router = useRouter()
let form = ref({ venue: '', date: '', time: '', duration: '', customer: '' })
const isEdit = computed(() => !!route.params.id)

onMounted(async () => {
  if (isEdit.value) {
    const accommodation = await getAccommodationById(route.params.id)
    if (accommodation) form.value = { ...accommodation }
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
