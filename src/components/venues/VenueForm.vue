<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="venueName">Venue Name</CFormLabel>
      <CFormInput
        id="venueName"
        v-model="form.name"
        type="text"
        placeholder="Enter venue name"
        required
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueWhatsapp">WhatsApp</CFormLabel>
      <CFormInput
        id="venueWhatsapp"
        v-model="form.whatsapp"
        type="text"
        placeholder="Enter WhatsApp number"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueAddress">Address</CFormLabel>
      <CFormInput
        id="venueAddress"
        v-model="form.address"
        type="text"
        placeholder="Enter address"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueZip">ZIP Code</CFormLabel>
      <CFormInput
        id="venueZip"
        v-model="form.zip_code"
        type="text"
        placeholder="Enter ZIP code"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueLatitude">Latitude</CFormLabel>
      <CFormInput
        id="venueLatitude"
        v-model="form.latitude"
        type="text"
        placeholder="Enter latitude"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueLongitude">Longitude</CFormLabel>
      <CFormInput
        id="venueLongitude"
        v-model="form.longitude"
        type="text"
        placeholder="Enter longitude"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueCity">City</CFormLabel>
      <CFormInput
        id="venueCity"
        v-model="form.city"
        type="text"
        placeholder="Enter city"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueCountry">Country</CFormLabel>
      <CFormInput
        id="venueCountry"
        v-model="form.country"
        type="text"
        placeholder="Enter country"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueDepartment">Department</CFormLabel>
      <CFormInput
        id="venueDepartment"
        v-model="form.department"
        type="text"
        placeholder="Enter department"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueSuburb">Suburb</CFormLabel>
      <CFormInput
        id="venueSuburb"
        v-model="form.suburb"
        type="text"
        placeholder="Enter suburb"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueAddressReference">Address Reference</CFormLabel>
      <CFormInput
        id="venueAddressReference"
        v-model="form.address_reference"
        type="text"
        placeholder="Enter address reference"
      />
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, defineProps, defineEmits } from 'vue'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue })

watch(
  () => props.modelValue,
  (val) => {
    form.value = { ...val }
  }
)

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}
</script>
