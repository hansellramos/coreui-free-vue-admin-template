<template>
  <div class="wrapper min-vh-100 d-flex flex-row align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="6">
          <CCard class="p-4">
            <CCardBody class="text-center">
              <h1>Bienvenido</h1>
              <p class="text-body-secondary mb-4">
                Inicia sesión con tu cuenta de Replit para acceder al panel de administración.
              </p>
              <div v-if="isLoading" class="mb-4">
                <CSpinner color="primary" />
                <p class="mt-2">Verificando sesión...</p>
              </div>
              <div v-else-if="isAuthenticated">
                <p class="text-success mb-3">
                  ¡Bienvenido, {{ user?.display_name || user?.email }}!
                </p>
                <CButton color="primary" size="lg" @click="goToDashboard">
                  Ir al Dashboard
                </CButton>
              </div>
              <div v-else>
                <CButton color="primary" size="lg" @click="login" class="mb-3">
                  <CIcon icon="cil-user" class="me-2" />
                  Iniciar sesión con Replit
                </CButton>
                <p class="text-body-secondary small mt-3">
                  Puedes usar tu cuenta de Google, GitHub, Apple o email.
                </p>
              </div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const { user, isAuthenticated, isLoading, login } = useAuth();

const goToDashboard = () => {
  router.push("/");
};
</script>
