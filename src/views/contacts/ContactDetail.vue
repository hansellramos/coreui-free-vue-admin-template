<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Contact Details</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="contact">
            <p><strong>Full Name:</strong> <span class="text-body-secondary">{{ contact.fullname }}</span></p>
            <p><strong>WhatsApp:</strong> <span class="text-body-secondary">{{ contact.whatsapp }}</span></p>
            <p><strong>Country:</strong> <span class="text-body-secondary">{{ contact.country }}</span></p>
            <p><strong>State:</strong> <span class="text-body-secondary">{{ contact.state }}</span></p>
            <p><strong>City:</strong> <span class="text-body-secondary">{{ contact.city }}</span></p>
            <div class="mt-4">
              <RouterLink :to="`/business/contacts/${contact.id}/edit`">
                <CButton color="primary" size="sm">Edit</CButton>
              </RouterLink>
              <RouterLink to="/business/contacts">
                <CButton color="secondary" size="sm" variant="outline" class="ms-2">Back to List</CButton>
              </RouterLink>
            </div>
          </template>
          <template v-else>
            <CSpinner color="primary" /> Loading...
          </template>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getContactById } from '@/services/contactService'

const route = useRoute()
const contact = ref(null)

onMounted(async () => {
  contact.value = await getContactById(route.params.id)
})
</script>
