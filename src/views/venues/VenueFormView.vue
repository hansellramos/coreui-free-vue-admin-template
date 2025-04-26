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
let form = ref({ name: '' })
const isEdit = computed(() => !!route.params.id)

onMounted(async () => {
  if (isEdit.value) {
    const venue = await getVenueById(route.params.id)
    if (venue) form.value = { name: venue.name }
  }
})

async function handleSubmit(data) {
  if (isEdit.value) {
    await updateVenue(route.params.id, data)
  } else {
    await createVenue(data)
  }
  router.push('/business/venues')
}

function handleCancel() {
  router.push('/business/venues')
}
</script>
