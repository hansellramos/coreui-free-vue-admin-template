export default [
  {
    path: '/business/accommodations',
    name: 'Accommodations',
    component: () => import('@/views/accommodations/AccommodationsList.vue'),
    meta: { breadcrumb: 'Lista' }
  },
  {
    path: '/business/accommodations/create',
    name: 'AccommodationCreate',
    component: () => import('@/views/accommodations/AccommodationFormView.vue'),
    meta: { breadcrumb: 'Crear' }
  },
  {
    path: '/business/accommodations/:id',
    name: 'AccommodationDetail',
    component: () => import('@/views/accommodations/AccommodationDetailView.vue'),
    props: true,
    meta: { breadcrumb: 'Detalle' }
  },
  {
    path: '/business/accommodations/:id/edit',
    name: 'AccommodationEdit',
    component: () => import('@/views/accommodations/AccommodationFormView.vue'),
    props: true,
    meta: { breadcrumb: 'Editar' }
  },
]
