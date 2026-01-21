export default [
  {
    path: '/business/accommodations',
    name: 'AccommodationsList',
    component: () => import('@/views/accommodations/AccommodationsList.vue'),
  },
  {
    path: '/business/accommodations/create',
    name: 'AccommodationCreate',
    component: () => import('@/views/accommodations/AccommodationFormView.vue'),
  },
  {
    path: '/business/accommodations/:id',
    name: 'AccommodationDetail',
    component: () => import('@/views/accommodations/AccommodationDetailView.vue'),
    props: true,
  },
  {
    path: '/business/accommodations/:id/edit',
    name: 'AccommodationEdit',
    component: () => import('@/views/accommodations/AccommodationFormView.vue'),
    props: true,
  },
]
