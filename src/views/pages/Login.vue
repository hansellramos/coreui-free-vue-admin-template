<template>
  <div class="wrapper min-vh-100 d-flex flex-row align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="8">
          <CCardGroup>
            <CCard class="p-4">
              <CCardBody>
                <form @submit.prevent="handleLogin">
                  <h1>Login</h1>
                  <p class="text-body-secondary">Sign In to your account</p>
                  <div class="mb-3">
                    <CInputGroup class="mb-3">
                      <CInputGroupText>
                        <CIcon icon="cil-envelope-closed" />
                      </CInputGroupText>
                      <CFormInput
                        v-model="email"
                        type="email"
                        placeholder="Email"
                        autocomplete="email"
                      />
                    </CInputGroup>
                  </div>
                  <div class="mb-3">
                    <CInputGroup class="mb-4">
                      <CInputGroupText>
                        <CIcon icon="cil-lock-locked" />
                      </CInputGroupText>
                      <CFormInput
                        v-model="password"
                        type="password"
                        placeholder="Password"
                        autocomplete="current-password"
                      />
                    </CInputGroup>
                  </div>
                  <CRow>
                    <CCol :xs="6">
                      <CButton color="primary" class="px-4" type="submit"> Login </CButton>
                    </CCol>
                    <CCol :xs="6" class="text-right">
                      <CButton color="link" class="px-0">
                        Forgot password?
                      </CButton>
                    </CCol>
                  </CRow>
                  <div v-if="errorMessage" class="alert alert-danger mt-2">{{ errorMessage }}</div>
                </form>
              </CCardBody>
            </CCard>
            <CCard class="text-white bg-primary py-5" style="width: 44%">
              <CCardBody class="text-center">
                <div>
                  <h2>Sign up</h2>
                  <p>
                    Lorem ipsum dolor sit amet, consectetur adipisicing elit,
                    sed do eiusmod tempor incididunt ut labore et dolore magna
                    aliqua.
                  </p>
                  <CButton color="light" variant="outline" class="mt-3">
                    Register Now!
                  </CButton>
                </div>
              </CCardBody>
            </CCard>
          </CCardGroup>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import supabase from "@/lib/supabase";

const email = ref("");
const password = ref("");
const errorMessage = ref("");
const router = useRouter();

const handleLogin = async () => {
  errorMessage.value = "";
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  });
  if (error) {
    errorMessage.value = error.message;
  } else {
    router.push("/home");
  }
};
</script>
