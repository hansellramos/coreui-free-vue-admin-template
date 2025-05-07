<script setup>
import { RouterLink } from 'vue-router'

import { logo } from '@/assets/brand/logo'
import { sygnet } from '@/assets/brand/sygnet'
import { AppSidebarNav } from '@/components/AppSidebarNav.js'
import { useSidebarStore } from '@/stores/sidebar.js'

const sidebar = useSidebarStore()
</script>

<template>
  <CSidebar
    class="border-end"
    colorScheme="dark"
    position="fixed"
    :unfoldable="sidebar.unfoldable"
    :visible="sidebar.visible"
    @visible-change="(value) => sidebar.toggleVisible(value)"
  >
    <CSidebarHeader class="border-bottom">
      <RouterLink custom to="/" v-slot="{ href, navigate }">
        <CSidebarBrand v-bind="$attrs" as="a" :href="href" @click="navigate">
          <!--Old  Logo
          <CIcon custom-class-name="sidebar-brand-full" :icon="logo" :height="32" />
          <CIcon custom-class-name="sidebar-brand-narrow" :icon="sygnet" :height="32" />
          -->
          <!--New Logo-->
          <svg width="180" height="32" viewBox="0 0 180 32" style="display:block">
            <g>
              <g data-name="Layer 2" id="Layer_2" transform="scale(1.75) translate(0, -2)">
                <path fill="#ffffff" d="M6.25,14.09A8.78,8.78,0,0,1,8.72,8.71,8,8,0,0,0,16,20h6V18H16A6,6,0,0,1,12.88,6.88,6,6,0,0,0,18,16h4V14H18a4,4,0,0,1-1.64-7.64A4,4,0,0,0,16,8a4,4,0,0,0,4,4h2V10H20a2,2,0,0,1,0-4h2V4H15A10.89,10.89,0,0,0,4.25,13.93,2.27,2.27,0,0,1,2,16v2A4.28,4.28,0,0,0,6.25,14.09Z"/>
              </g>
              <text fill="#ffffff" x="40" y="30" font-family="Arial" font-size="22" alignment-baseline="middle">abanero</text>
            </g>
          </svg>
        </CSidebarBrand>
      </RouterLink>
      <CCloseButton class="d-lg-none" dark @click="sidebar.toggleVisible()" />
    </CSidebarHeader>
    <AppSidebarNav />
    <CSidebarFooter class="border-top d-none d-lg-flex">
      <CSidebarToggler @click="sidebar.toggleUnfoldable()" />
    </CSidebarFooter>
  </CSidebar>
</template>
