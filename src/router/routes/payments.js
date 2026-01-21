export default [
  {
    path: '/business/payments',
    name: 'Payments',
    component: () => import('@/views/payments/PaymentListView.vue'),
    meta: { breadcrumb: 'Lista' }
  },
  {
    path: '/business/payments/new',
    name: 'PaymentCreate',
    component: () => import('@/views/payments/PaymentFormView.vue'),
    meta: { breadcrumb: 'Registrar' }
  },
  {
    path: '/business/payments/:id/edit',
    name: 'PaymentEdit',
    component: () => import('@/views/payments/PaymentFormView.vue'),
    props: true,
    meta: { breadcrumb: 'Editar' }
  },
]
