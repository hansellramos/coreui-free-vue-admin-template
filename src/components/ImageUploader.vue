<template>
  <div>
    <div v-if="images.length > 0" class="image-gallery mb-3">
      <div
        v-for="(image, index) in images"
        :key="image.id || index"
        class="image-item"
        :class="{ 'is-cover': image.is_cover }"
      >
        <img
          :src="image.image_url"
          class="img-thumbnail"
          @click="previewImage = image"
        />
        <div class="image-actions">
          <CButton
            v-if="showCoverButton && !image.is_cover"
            color="primary"
            size="sm"
            variant="ghost"
            title="Establecer como portada"
            @click.stop="$emit('set-cover', image)"
          >
            <CIcon name="cil-star" />
          </CButton>
          <CButton
            color="danger"
            size="sm"
            variant="ghost"
            title="Eliminar imagen"
            @click.stop="$emit('delete', image)"
          >
            <CIcon name="cil-trash" />
          </CButton>
        </div>
        <CBadge v-if="image.is_cover" color="primary" class="cover-badge">
          Portada
        </CBadge>
      </div>
    </div>

    <div
      v-if="images.length < maxImages"
      class="image-upload-area"
      :class="{ 'is-dragging': isDragging, 'is-uploading': uploading }"
      @paste="handlePaste"
      @drop.prevent="handleDrop"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      tabindex="0"
    >
      <div v-if="uploading" class="text-center">
        <CSpinner size="sm" class="me-2" />
        Subiendo imagen...
      </div>
      <div v-else class="text-center">
        <CIcon name="cil-cloud-upload" size="xl" class="mb-2 text-secondary" />
        <div class="mb-2">{{ placeholder }}</div>
        <div class="d-flex justify-content-center gap-2">
          <CButton color="primary" size="sm" @click.stop="triggerFileInput">
            <CIcon name="cil-folder-open" class="me-1" /> Seleccionar archivo
          </CButton>
          <CButton color="secondary" size="sm" @click.stop="pasteFromClipboard">
            <CIcon name="cil-clipboard" class="me-1" /> Pegar
          </CButton>
        </div>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="d-none"
        :multiple="multiple"
        @change="handleFileSelect"
      />
    </div>
    <div v-if="uploadError" class="text-danger small mt-2">
      {{ uploadError }}
    </div>

    <CModal
      :visible="!!previewImage"
      @close="previewImage = null"
      size="xl"
      :keyboard="true"
      backdrop="true"
    >
      <CModalHeader close-button>
        <CModalTitle>Vista previa</CModalTitle>
      </CModalHeader>
      <CModalBody class="text-center p-4">
        <img v-if="previewImage" :src="previewImage.image_url" class="img-fluid rounded" style="max-height: 70vh;" />
      </CModalBody>
      <CModalFooter class="justify-content-center">
        <CButton color="danger" @click="$emit('delete', previewImage); previewImage = null">
          <CIcon name="cil-trash" class="me-2" />
          Eliminar
        </CButton>
        <CButton color="secondary" variant="outline" @click="previewImage = null">
          Cerrar
        </CButton>
      </CModalFooter>
    </CModal>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { CButton, CSpinner, CBadge, CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter } from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const props = defineProps({
  images: {
    type: Array,
    default: () => []
  },
  uploadType: {
    type: String,
    default: 'plan'
  },
  maxImages: {
    type: Number,
    default: 10
  },
  multiple: {
    type: Boolean,
    default: true
  },
  showCoverButton: {
    type: Boolean,
    default: true
  },
  placeholder: {
    type: String,
    default: 'Pegar imagen (Ctrl+V), arrastrar, o hacer clic para seleccionar'
  }
})

const emit = defineEmits(['upload', 'delete', 'set-cover', 'preview', 'error'])

const fileInput = ref(null)
const isDragging = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const previewImage = ref(null)

const triggerFileInput = () => {
  fileInput.value?.click()
}

const handlePaste = (event) => {
  const items = event.clipboardData?.items
  if (!items) return
  
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) uploadFile(file)
      break
    }
  }
}

const pasteFromClipboard = async () => {
  try {
    const clipboardItems = await navigator.clipboard.read()
    for (const item of clipboardItems) {
      const imageType = item.types.find(type => type.startsWith('image/'))
      if (imageType) {
        const blob = await item.getType(imageType)
        const file = new File([blob], 'pasted-image.png', { type: imageType })
        uploadFile(file)
        return
      }
    }
    uploadError.value = 'No hay imagen en el portapapeles'
  } catch (error) {
    console.error('Clipboard error:', error)
    uploadError.value = 'No se pudo acceder al portapapeles. Usa Ctrl+V en el área de carga.'
  }
}

const handleDrop = (event) => {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files?.length) {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        uploadFile(file)
        if (!props.multiple) break
      }
    }
  }
}

const handleFileSelect = (event) => {
  const files = event.target.files
  if (files?.length) {
    for (const file of files) {
      uploadFile(file)
      if (!props.multiple) break
    }
    event.target.value = ''
  }
}

const uploadFile = async (file) => {
  if (!file.type.startsWith('image/')) {
    uploadError.value = 'Solo se permiten archivos de imagen'
    return
  }
  
  uploading.value = true
  uploadError.value = ''
  
  try {
    const urlResponse = await fetch('/api/uploads/image-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        contentType: file.type,
        size: file.size,
        type: props.uploadType
      })
    })
    
    if (!urlResponse.ok) {
      const error = await urlResponse.json()
      throw new Error(error.error || 'Error al obtener URL de subida')
    }
    
    const { uploadURL, objectPath } = await urlResponse.json()
    
    const uploadResponse = await fetch(uploadURL, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    })
    
    if (!uploadResponse.ok) {
      throw new Error('Error al subir archivo')
    }
    
    emit('upload', objectPath)
  } catch (error) {
    uploadError.value = error.message || 'Error al subir imagen'
    emit('error', error)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.image-upload-area {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 30px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #f8f9fa;
}

.image-upload-area:hover,
.image-upload-area:focus {
  border-color: #6c757d;
  background: #f0f0f0;
  outline: none;
}

.image-upload-area.is-dragging {
  border-color: #321fdb;
  background: rgba(50, 31, 219, 0.05);
}

.image-upload-area.is-uploading {
  pointer-events: none;
  opacity: 0.7;
}

.image-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-item {
  position: relative;
  width: 120px;
}

.image-item img {
  width: 120px;
  height: 120px;
  object-fit: cover;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.image-item img:hover {
  transform: scale(1.05);
}

.image-item.is-cover {
  border: 3px solid #321fdb;
  border-radius: 6px;
}

.image-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.image-item:hover .image-actions {
  opacity: 1;
}

.cover-badge {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-size: 0.65rem;
}
</style>
