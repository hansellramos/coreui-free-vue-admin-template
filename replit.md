# CoreUI Free Vue Admin Template

## Overview
This is a Vue.js 3 admin dashboard template built with CoreUI components. It provides a comprehensive set of UI components, layouts, and views for building admin panels and dashboards.

## Project Structure
- `src/` - Main source directory
  - `assets/` - Static assets and icons
  - `components/` - Reusable Vue components
  - `composables/` - Vue composables (useAuth for authentication, usePostHog for analytics)
  - `layouts/` - Layout templates (DefaultLayout)
  - `router/` - Vue Router configuration
  - `services/` - API service modules (placeholder stubs)
  - `stores/` - Pinia state management stores
  - `styles/` - SCSS stylesheets
  - `views/` - Page components organized by feature
- `server/` - Express.js backend
  - `auth/` - Replit Auth integration (OIDC-based)
  - `prisma/` - Prisma schema and migrations
  - `db.js` - Prisma client with PostgreSQL adapter
  - `index.js` - Express server with API routes
- `public/` - Static public files

## Technologies
- Vue 3
- Vite (build tool)
- CoreUI Vue components
- Vue Router
- Pinia (state management)
- Mapbox GL (maps with geocoding and reverse geocoding)
- Chart.js (charts)
- PostHog (analytics with autocapture)
- SCSS for styling
- Express.js (backend)
- Prisma 7 with @prisma/adapter-pg (ORM)
- Replit Auth (authentication via OpenID Connect)
- Vercel AI SDK with @ai-sdk/anthropic (Claude Vision for receipt extraction)

## Backend API
The Express backend runs on port 3000 and provides:
- `/api/login` - Initiate Replit Auth login
- `/api/logout` - Logout and end session
- `/api/callback` - OAuth callback handler
- `/api/auth/user` - Get current authenticated user
- `/api/organizations` - CRUD for organizations (filtered by user permissions)
- `/api/venues` - CRUD for venues with waze_link field (filtered by user permissions)
- `/api/contacts` - CRUD for contacts (filtered by user permissions)
- `/api/accommodations` - CRUD for accommodations (filtered by user permissions)
- `/api/payments` - CRUD for payments with verification workflow (filtered by user permissions)
- `/api/payments/:id/verify` - Verify/unverify a payment (protected)
- `/api/payments/extract-receipt` - AI-powered receipt data extraction using Claude Vision
- `/api/countries` - List countries
- `/api/states` - List states (filter by country)
- `/api/users` - List users (protected)
- `/api/users/:id/organizations` - GET/PUT user's assigned organizations
- `/api/users/:id/profile` - PUT to assign profile to user
- `/api/profiles` - CRUD for permission profiles
- `/api/permissions` - List available permissions
- `/api/uploads/request-url` - Get presigned URL for file upload (protected)
- `/objects/:type/:id` - Serve uploaded objects (protected)
- `/api/expense-categories` - CRUD for expense categories (system categories are protected)
- `/api/expenses` - CRUD for expenses with filters (venue_id, organization_id, category_id, from_date, to_date)
- `/api/deposits` - CRUD for security deposits with evidence (accommodation_id, venue_id, status filters)
- `/api/deposits/:id/status` - Update deposit status (refund/claim)
- `/api/analytics/summary` - Get income/expense/deposit summary with period filters
- `/api/analytics/expenses-by-category` - Get expenses grouped by category
- `/api/analytics/monthly-trend` - Get monthly income/expense trend

Protected routes (POST, PUT, DELETE) require authentication.

## File Uploads
Receipt images for payments can be uploaded via:
- Copy/paste directly in the payment form
- Drag and drop
- File selection

Files are stored in Replit Object Storage and served via `/objects/:type/:id`.
Restrictions: Images only (JPEG, PNG, GIF, WebP), max 10MB.

## AI Features

### Receipt Data Extraction
When a payment receipt image is uploaded, users can click "Leer con IA" to automatically extract:
- Payment amount
- Reference/transaction number
- Payment date

Uses Vercel AI SDK with Anthropic Claude Vision. Requires `ANTHROPIC_API_KEY` secret.

### Message Suggestions for Accommodations
When viewing an accommodation detail, the system shows pre-written WhatsApp message templates:
- **Recordatorio previo al evento** - Reminder with date, time, attendees, Waze link, and venue contact
- **Confirmación de reserva** - Booking confirmation message
- **Instrucciones de llegada** - Arrival instructions with maps links

Messages include dynamic data from the accommodation and open WhatsApp with pre-filled text.

## Database
A PostgreSQL database is available with the following tables:
- `users` - User accounts (synced with Replit Auth, includes profile_id and is_super_admin)
- `organizations` - Organizations
- `venues` - Venues/locations
- `contacts` - Contact information
- `accommodations` - Accommodation bookings
- `payments` - Payment records with verification and audit trails
- `countries` - Country reference data
- `states` - State/province reference data
- `contact_organization` - Many-to-many relationship table
- `contact_venue` - Many-to-many relationship table
- `venue_packages` - Venue package options
- `package_prices` - Package pricing
- `sessions` - Session storage for authentication
- `permissions` - Available permission codes and descriptions
- `profiles` - Permission profiles with JSON permissions array
- `user_organizations` - Many-to-many relationship for user-to-organization access
- `subscriptions` - Subscription plans with limits and Stripe integration fields
- `subscription_users` - Many-to-many relationship for user-to-subscription membership
- `expense_categories` - Expense category templates with icons and colors (system categories protected)
- `expenses` - Expense records linked to venues/organizations with categories
- `deposits` - Security deposits for accommodations with status tracking (pending/refunded/claimed)
- `deposit_evidence` - Evidence photos for deposits (damage/invoice types)

The database connection is available via the `DATABASE_URL` environment variable.

## Subscription System
Users must belong to an active subscription to access the application.

### How it works
1. New users are automatically assigned a 30-day trial subscription (configurable via `DEFAULT_SUBSCRIPTION_ID`)
2. New users are automatically assigned the default profile (configurable via `DEFAULT_PROFILE_CODE`)
3. A trial banner shows remaining days at the top of the application
4. When trial expires, users see "Prueba Expirada" screen
5. Users without any subscription see "Acceso Restringido" screen
6. Subscription owners can add/remove users from their subscription
7. Super admins bypass subscription checks and can manage all subscriptions

### Trial System
- Each user gets their own `trial_expires_at` in `subscription_users` table
- Banner colors: info (>7 days), warning (3-7 days), danger (1-3 days)
- Trial expiration is per-user, not per-subscription

### Subscription API
- `/api/subscriptions` - List/Create subscriptions (admin only)
- `/api/subscriptions/:id` - Get/Update/Delete subscription
- `/api/subscriptions/:id/users` - Add user to subscription
- `/api/subscriptions/:id/users/:userId` - Remove user from subscription

### Permissions
- `subscription:manage` - Allows viewing and managing subscriptions

## Permissions System
The application implements a role-based access control system:

### Profiles
- `organization:view` (default) - Can only view data from assigned organizations
- `organization:admin` - Full CRUD within assigned organizations
- Super Admin - Full access (set via `npm run make-admin`)

### How it works
1. Users are assigned a profile that defines their permissions
2. Users are assigned to one or more organizations
3. API endpoints automatically filter data based on user's accessible organizations
4. Users with `organizations:view:all` permission can see all organizations

### Creating a Super Admin
```bash
# Set the APP_ADMIN_SECRET environment variable first
npm run make-admin <secret> <user-email>
```

### Managing Profiles
- Navigate to System > Perfiles in the sidebar
- Create custom profiles with specific permission combinations
- System profiles (organization:view, organization:admin) cannot be modified

### God Mode (Super Admin Settings)
Super admins can access the "God Mode" section in Settings to:
- View all current super admins
- Grant super admin permission to any user
- Revoke super admin permission from others (cannot revoke from yourself)

This section is only visible to users with `is_super_admin = true`.

## Authentication
Replit Auth is integrated using OpenID Connect:
- Users authenticate via `/api/login`
- Sessions are stored in PostgreSQL
- Protected API endpoints use `isAuthenticated` middleware
- Vue composable `useAuth()` provides authentication state

## Venue Plans System
Venues can have multiple plans (pasadía/pasanoche/hospedaje) with:
- Adult/child/infant pricing with configurable max ages
- Courtesies (free children, food-only pricing conditions)
- Schedule (check-in/out times)
- Capacity (min guests, max capacity)
- Food descriptions (almuerzo, cena, medianoche)
- Amenities selection from system-level amenities
- Photo galleries with cover photo selection
- Terms and conditions
- Active/inactive status

Access venue plans via the "Planes" button in the Cabañas list.

## Expenses and Deposits System

### Expense Categories
System comes with pre-configured expense categories:
- Servicios (utilities), Nómina (payroll), Insumos (supplies), Arreglos (repairs)
- Mantenimiento (maintenance), Jardinería (gardening), Limpieza (cleaning)
- Seguridad (security), Impuestos (taxes), Otros (other)

Each category has a CoreUI icon and Bootstrap color. Custom categories can be added.
System categories cannot be modified or deleted.

### Expenses
Track all venue/organization expenses with:
- Category, amount, date, description
- Optional receipt upload
- Filter by venue, organization, category, date range

### Security Deposits
Manage security deposits for accommodations:
- **Status flow**: pending → refunded (no damage) OR claimed (damage found)
- **Refund**: Record refund amount, date, and reference
- **Claim**: Record damage amount and add evidence photos
- **Evidence types**: damage (photos of damage), invoice (repair receipts)

### Analytics Dashboard
View financial analytics with:
- Period selector: Este Mes, Este Trimestre, Este Año, or custom date range
- Summary cards: Ingresos, Egresos, Depósitos Retenidos, Utilidad
- Monthly trend chart (income vs expenses)
- Expenses by category chart
- Filter by venue and organization

## Environment Variables
- `VITE_MAPBOX_ACCESS_TOKEN` - Mapbox API token (optional)
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `SESSION_SECRET` - Session encryption secret (auto-configured)
- `REPL_ID` - Replit application ID (auto-configured)
- `DEFAULT_PROFILE_CODE` - Profile code to assign to new users (default: `organization:admin`)
- `DEFAULT_SUBSCRIPTION_ID` - Trial subscription ID to assign to new users

## Development
- Vue frontend runs on port 5000 (proxies /api to backend)
- Express backend runs on port 3000
- Run `cd server && npx prisma generate` to regenerate Prisma client
- Run `cd server && npx prisma db push` to sync schema changes

## Workflows
- **Vue Dev Server** - Frontend development server on port 5000
- **Express Backend** - API server on port 3000

## Notes
- Prisma 7 requires driver adapters; using @prisma/adapter-pg for PostgreSQL
- Frontend services in `src/services/` are placeholder stubs that need updating to call backend API
- Authentication composable available at `src/composables/useAuth.js`

## Language
- The application is fully translated to Spanish
- "Venues" are referred to as "Cabañas" throughout the application
- Navigation and UI elements are in Spanish (Panel, Calendario, Próximos, Organizaciones, Cabañas, Contactos, Hospedajes, Pagos, etc.)
- Theme selector: Claro/Oscuro/Automático
