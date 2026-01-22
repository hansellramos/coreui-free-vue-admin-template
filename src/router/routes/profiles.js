export default [
  {
    path: '/admin/profiles',
    name: 'Profiles',
    component: () => import('@/views/profiles/ProfileListView.vue'),
    meta: { breadcrumb: 'Lista' }
  },
  {
    path: '/admin/profiles/new',
    name: 'ProfileCreate',
    component: () => import('@/views/profiles/ProfileFormView.vue'),
    meta: { breadcrumb: 'Crear' }
  },
  {
    path: '/admin/profiles/:id',
    name: 'ProfileDetail',
    component: () => import('@/views/profiles/ProfileFormView.vue'),
    props: true,
    meta: { breadcrumb: 'Detalle' }
  },
  {
    path: '/admin/profiles/:id/edit',
    name: 'ProfileEdit',
    component: () => import('@/views/profiles/ProfileFormView.vue'),
    props: true,
    meta: { breadcrumb: 'Editar' }
  },
]
