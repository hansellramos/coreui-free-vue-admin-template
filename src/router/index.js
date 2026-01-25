import { h, resolveComponent } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { usePostHog } from '@/composables/usePostHog'

import DefaultLayout from '@/layouts/DefaultLayout'
import accommodationsRoutes from './routes/accommodations'
import paymentsRoutes from './routes/payments'
import profilesRoutes from './routes/profiles'

let authChecked = false
let isAuthenticated = false
let hasSubscription = false
let cachedUser = null

const routes = [
  {
    path: '/',
    name: 'Root',
    component: DefaultLayout,
    redirect: '/dashboard',
    children: [
      {
        path: '/dashboard',
        name: 'Dashboard',
        // route level code-splitting
        // this generates a separate chunk (about.[hash].js) for this route
        // which is lazy-loaded when the route is visited.
        component: () =>
          import(
            /* webpackChunkName: "dashboard" */ '@/views/dashboard/Dashboard.vue'
          ),
      },
      {
        path: '/users',
        name: 'UsersList',
        component: () => import('@/views/users/UsersList.vue'),
      },
      {
        path: '/users/create',
        name: 'UserCreate',
        component: () => import('@/views/users/UserFormView.vue'),
      },
      {
        path: '/users/:id/edit',
        name: 'UserEdit',
        component: () => import('@/views/users/UserFormView.vue'),
        props: true,
      },
      {
        path: '/profile',
        name: 'Profile',
        component: () => import('@/views/profile/ProfileView.vue'),
      },
      {
        path: '/home',
        name: 'Home',
        component: () => import('@/views/pages/Home.vue'),
      },
      {
        path: '/settings',
        name: 'Settings',
        component: () => import('@/views/pages/Settings.vue'),
      },
      {
        path: '/next',
        name: 'Próximos',
        component: () => import('@/views/pages/Next.vue'),
      },
      {
        path: '/availability',
        name: 'Availability',
        component: () => import('@/views/availability/AvailabilityView.vue'),
      },
      {
        path: '/no-subscription',
        name: 'NoSubscription',
        component: () => import('@/views/subscription/NoSubscriptionView.vue'),
      },
      {
        path: '/theme',
        name: 'Theme',
        redirect: '/theme/typography',
      },
      {
        path: '/theme/colors',
        name: 'Colors',
        component: () => import('@/views/theme/Colors.vue'),
      },
      {
        path: '/theme/typography',
        name: 'Typography',
        component: () => import('@/views/theme/Typography.vue'),
      },
      {
        path: '/base',
        name: 'Base',
        component: {
          render() {
            return h(resolveComponent('router-view'))
          },
        },
        redirect: '/base/breadcrumbs',
        children: [
          {
            path: '/base/accordion',
            name: 'Accordion',
            component: () => import('@/views/base/Accordion.vue'),
          },
          {
            path: '/base/breadcrumbs',
            name: 'Breadcrumbs',
            component: () => import('@/views/base/Breadcrumbs.vue'),
          },
          {
            path: '/base/cards',
            name: 'Cards',
            component: () => import('@/views/base/Cards.vue'),
          },
          {
            path: '/base/carousels',
            name: 'Carousels',
            component: () => import('@/views/base/Carousels.vue'),
          },
          {
            path: '/base/collapses',
            name: 'Collapses',
            component: () => import('@/views/base/Collapses.vue'),
          },
          {
            path: '/base/list-groups',
            name: 'List Groups',
            component: () => import('@/views/base/ListGroups.vue'),
          },
          {
            path: '/base/navs',
            name: 'Navs',
            component: () => import('@/views/base/Navs.vue'),
          },
          {
            path: '/base/paginations',
            name: 'Paginations',
            component: () => import('@/views/base/Paginations.vue'),
          },
          {
            path: '/base/placeholders',
            name: 'Placeholders',
            component: () => import('@/views/base/Placeholders.vue'),
          },
          {
            path: '/base/popovers',
            name: 'Popovers',
            component: () => import('@/views/base/Popovers.vue'),
          },
          {
            path: '/base/progress',
            name: 'Progress',
            component: () => import('@/views/base/Progress.vue'),
          },
          {
            path: '/base/spinners',
            name: 'Spinners',
            component: () => import('@/views/base/Spinners.vue'),
          },
          {
            path: '/base/tables',
            name: 'Tables',
            component: () => import('@/views/base/Tables.vue'),
          },
          {
            path: '/base/tabs',
            name: 'Tabs',
            component: () => import('@/views/base/Tabs.vue'),
          },
          {
            path: '/base/tooltips',
            name: 'Tooltips',
            component: () => import('@/views/base/Tooltips.vue'),
          },
        ],
      },
      {
        path: '/buttons',
        name: 'Buttons',
        component: {
          render() {
            return h(resolveComponent('router-view'))
          },
        },
        redirect: '/buttons/standard-buttons',
        children: [
          {
            path: '/buttons/standard-buttons',
            name: 'Button Component',
            component: () => import('@/views/buttons/Buttons.vue'),
          },
          {
            path: '/buttons/dropdowns',
            name: 'Dropdowns',
            component: () => import('@/views/buttons/Dropdowns.vue'),
          },
          {
            path: '/buttons/button-groups',
            name: 'Button Groups',
            component: () => import('@/views/buttons/ButtonGroups.vue'),
          },
        ],
      },
      {
        path: '/forms',
        name: 'Forms',
        component: {
          render() {
            return h(resolveComponent('router-view'))
          },
        },
        redirect: '/forms/form-control',
        children: [
          {
            path: '/forms/form-control',
            name: 'Form Control',
            component: () => import('@/views/forms/FormControl.vue'),
          },
          {
            path: '/forms/select',
            name: 'Select',
            component: () => import('@/views/forms/Select.vue'),
          },
          {
            path: '/forms/checks-radios',
            name: 'Checks & Radios',
            component: () => import('@/views/forms/ChecksRadios.vue'),
          },
          {
            path: '/forms/range',
            name: 'Range',
            component: () => import('@/views/forms/Range.vue'),
          },
          {
            path: '/forms/input-group',
            name: 'Input Group',
            component: () => import('@/views/forms/InputGroup.vue'),
          },
          {
            path: '/forms/floating-labels',
            name: 'Floating Labels',
            component: () => import('@/views/forms/FloatingLabels.vue'),
          },
          {
            path: '/forms/layout',
            name: 'Layout',
            component: () => import('@/views/forms/Layout.vue'),
          },
          {
            path: '/forms/validation',
            name: 'Validation',
            component: () => import('@/views/forms/Validation.vue'),
          },
        ],
      },
      {
        path: '/charts',
        name: 'Charts',
        component: () => import('@/views/charts/Charts.vue'),
      },
      {
        path: '/icons',
        name: 'Icons',
        component: {
          render() {
            return h(resolveComponent('router-view'))
          },
        },
        redirect: '/icons/coreui-icons',
        children: [
          {
            path: '/icons/coreui-icons',
            name: 'CoreUI Icons',
            component: () => import('@/views/icons/CoreUIIcons.vue'),
          },
          {
            path: '/icons/brands',
            name: 'Brands',
            component: () => import('@/views/icons/Brands.vue'),
          },
          {
            path: '/icons/flags',
            name: 'Flags',
            component: () => import('@/views/icons/Flags.vue'),
          },
        ],
      },
      {
        path: '/notifications',
        name: 'Notifications',
        component: {
          render() {
            return h(resolveComponent('router-view'))
          },
        },
        redirect: '/notifications/alerts',
        children: [
          {
            path: '/notifications/alerts',
            name: 'Alerts',
            component: () => import('@/views/notifications/Alerts.vue'),
          },
          {
            path: '/notifications/badges',
            name: 'Badges',
            component: () => import('@/views/notifications/Badges.vue'),
          },
          {
            path: '/notifications/modals',
            name: 'Modals',
            component: () => import('@/views/notifications/Modals.vue'),
          },
          {
            path: '/notifications/toasts',
            name: 'Toasts',
            component: () => import('@/views/notifications/Toasts.vue'),
          },
        ],
      },
      {
        path: '/widgets',
        name: 'Widgets',
        component: () => import('@/views/widgets/Widgets.vue'),
      },
      // Business logic routes
      {
        path: '/business',
        name: 'Business',
        children: [
          {
            path: 'organizations',
            name: 'Organizations',
            component: () => import('@/views/organizations/OrganizationsList.vue'),
          },
          {
            path: 'organizations/create',
            name: 'OrganizationCreate',
            component: () => import('@/views/organizations/OrganizationFormView.vue'),
          },
          {
            path: 'organizations/:id',
            name: 'OrganizationDetail',
            component: () => import('@/views/organizations/OrganizationDetail.vue'),
            props: true,
          },
          {
            path: 'organizations/:id/read',
            name: 'OrganizationRead',
            component: () => import('@/views/organizations/OrganizationDetail.vue'),
            props: true,
          },
          {
            path: 'organizations/:id/edit',
            name: 'OrganizationEdit',
            component: () => import('@/views/organizations/OrganizationFormView.vue'),
            props: true,
          },
          {
            path: 'venues',
            name: 'Venues',
            component: () => import('@/views/venues/VenuesList.vue'),
          },
          {
            path: 'venues/create',
            name: 'VenueCreate',
            component: () => import('@/views/venues/VenueFormView.vue'),
          },
          {
            path: 'venues/:id',
            name: 'VenueDetail',
            component: () => import('@/views/venues/VenueDetail.vue'),
            props: true,
          },
          {
            path: 'venues/:id/read',
            name: 'VenueRead',
            component: () => import('@/views/venues/VenueDetail.vue'),
            props: true,
          },
          {
            path: 'venues/:id/edit',
            name: 'VenueEdit',
            component: () => import('@/views/venues/VenueFormView.vue'),
            props: true,
          },
          {
            path: 'contacts',
            name: 'Contacts',
            component: () => import('@/views/contacts/ContactsList.vue'),
          },
          {
            path: 'contacts/create',
            name: 'ContactCreate',
            component: () => import('@/views/contacts/ContactFormView.vue'),
          },
          {
            path: 'contacts/:id',
            name: 'ContactDetail',
            component: () => import('@/views/contacts/ContactDetail.vue'),
            props: true,
          },
          {
            path: 'contacts/:id/read',
            name: 'ContactRead',
            component: () => import('@/views/contacts/ContactDetail.vue'),
            props: true,
          },
          {
            path: 'contacts/:id/edit',
            name: 'ContactEdit',
            component: () => import('@/views/contacts/ContactFormView.vue'),
            props: true,
          },
        ],
      },
      ...accommodationsRoutes,
      ...paymentsRoutes,
      ...profilesRoutes,
      {
        path: '/admin/amenities',
        name: 'AmenityList',
        component: () => import('@/views/amenities/AmenityListView.vue'),
      },
      {
        path: '/admin/expense-categories',
        name: 'ExpenseCategoryList',
        component: () => import('@/views/expense-categories/ExpenseCategoryListView.vue'),
      },
      {
        path: '/business/venues/:id/plans',
        name: 'VenuePlans',
        component: () => import('@/views/venues/VenuePlansView.vue'),
        props: true,
      },
      {
        path: '/business/expenses',
        name: 'ExpensesList',
        component: () => import('@/views/expenses/ExpensesListView.vue'),
      },
      {
        path: '/business/expenses/create',
        name: 'ExpenseCreate',
        component: () => import('@/views/expenses/ExpenseFormView.vue'),
      },
      {
        path: '/business/expenses/:id/edit',
        name: 'ExpenseEdit',
        component: () => import('@/views/expenses/ExpenseFormView.vue'),
        props: true,
      },
      {
        path: '/business/deposits',
        name: 'DepositsList',
        component: () => import('@/views/deposits/DepositsListView.vue'),
      },
      {
        path: '/business/deposits/:id',
        name: 'DepositDetail',
        component: () => import('@/views/deposits/DepositDetailView.vue'),
        props: true,
      },
      {
        path: '/analytics',
        name: 'Analytics',
        component: () => import('@/views/analytics/AnalyticsView.vue'),
      },
    ],
  },
  {
    path: '/pages',
    redirect: '/pages/404',
    name: 'Pages',
    component: {
      render() {
        return h(resolveComponent('router-view'))
      },
    },
    children: [
      {
        path: '404',
        name: 'Page404',
        component: () => import('@/views/pages/Page404'),
      },
      {
        path: '500',
        name: 'Page500',
        component: () => import('@/views/pages/Page500'),
      },
      {
        path: 'login',
        name: 'Login',
        component: () => import('@/views/pages/Login'),
      },
      {
        path: 'register',
        name: 'Register',
        component: () => import('@/views/pages/Register'),
      },
    ],
  },
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    // always scroll to top
    return { top: 0 }
  },
})

// Initialize PostHog for analytics
const { posthog } = usePostHog()

// Public routes that don't require authentication
const publicRoutes = ['/availability', '/pages/login', '/pages/register', '/pages/404', '/pages/500']

// Routes that don't require subscription
const noSubscriptionRoutes = ['/no-subscription', '/profile']

// Check if route is public
const isPublicRoute = (path) => {
  return publicRoutes.some(route => path.startsWith(route))
}

// Check if route allows no subscription
const allowsNoSubscription = (path) => {
  return noSubscriptionRoutes.some(route => path.startsWith(route))
}

// Check authentication and subscription status
async function checkAuth() {
  if (authChecked) return { authenticated: isAuthenticated, hasSubscription, user: cachedUser }
  
  try {
    const response = await fetch('/api/auth/user', { credentials: 'include' })
    if (response.ok) {
      const userData = await response.json()
      isAuthenticated = true
      hasSubscription = !!(userData.subscription && userData.subscription.is_active)
      cachedUser = userData
    } else {
      isAuthenticated = false
      hasSubscription = false
      cachedUser = null
    }
    authChecked = true
    return { authenticated: isAuthenticated, hasSubscription, user: cachedUser }
  } catch (error) {
    isAuthenticated = false
    hasSubscription = false
    cachedUser = null
    authChecked = true
    return { authenticated: false, hasSubscription: false, user: null }
  }
}

// Reset auth state (call after logout or to force revalidation)
export function resetAuthState() {
  authChecked = false
  isAuthenticated = false
  hasSubscription = false
  cachedUser = null
}

// Force revalidation of auth state
export async function revalidateAuth() {
  authChecked = false
  return await checkAuth()
}

// Navigation guard to protect routes
router.beforeEach(async (to, from) => {
  // Allow public routes
  if (isPublicRoute(to.path)) {
    return true
  }
  
  // Check authentication and subscription
  const authStatus = await checkAuth()
  
  if (!authStatus.authenticated) {
    // Redirect to login
    window.location.href = '/api/login'
    return false
  }
  
  // Super admins bypass subscription check
  if (authStatus.user?.is_super_admin) {
    return true
  }
  
  // Check subscription for protected routes
  if (!authStatus.hasSubscription && !allowsNoSubscription(to.path)) {
    return { path: '/no-subscription' }
  }
  
  return true
})

export default router
