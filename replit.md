# CoreUI Free Vue Admin Template

## Overview
This is a Vue.js 3 admin dashboard template built with CoreUI components. It provides a comprehensive set of UI components, layouts, and views for building admin panels and dashboards.

## Project Structure
- `src/` - Main source directory
  - `assets/` - Static assets and icons
  - `components/` - Reusable Vue components
  - `composables/` - Vue composables (useAuth for authentication)
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
- Mapbox GL (maps)
- Chart.js (charts)
- SCSS for styling
- Express.js (backend)
- Prisma 7 with @prisma/adapter-pg (ORM)
- Replit Auth (authentication via OpenID Connect)

## Backend API
The Express backend runs on port 3000 and provides:
- `/api/login` - Initiate Replit Auth login
- `/api/logout` - Logout and end session
- `/api/callback` - OAuth callback handler
- `/api/auth/user` - Get current authenticated user
- `/api/organizations` - CRUD for organizations (filtered by user permissions)
- `/api/venues` - CRUD for venues (filtered by user permissions)
- `/api/contacts` - CRUD for contacts (filtered by user permissions)
- `/api/accommodations` - CRUD for accommodations (filtered by user permissions)
- `/api/payments` - CRUD for payments with verification workflow (filtered by user permissions)
- `/api/payments/:id/verify` - Verify/unverify a payment (protected)
- `/api/countries` - List countries
- `/api/states` - List states (filter by country)
- `/api/users` - List users (protected)
- `/api/users/:id/organizations` - GET/PUT user's assigned organizations
- `/api/users/:id/profile` - PUT to assign profile to user
- `/api/profiles` - CRUD for permission profiles
- `/api/permissions` - List available permissions
- `/api/uploads/request-url` - Get presigned URL for file upload (protected)
- `/objects/:type/:id` - Serve uploaded objects (protected)

Protected routes (POST, PUT, DELETE) require authentication.

## File Uploads
Receipt images for payments can be uploaded via:
- Copy/paste directly in the payment form
- Drag and drop
- File selection

Files are stored in Replit Object Storage and served via `/objects/:type/:id`.
Restrictions: Images only (JPEG, PNG, GIF, WebP), max 10MB.

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

The database connection is available via the `DATABASE_URL` environment variable.

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

## Authentication
Replit Auth is integrated using OpenID Connect:
- Users authenticate via `/api/login`
- Sessions are stored in PostgreSQL
- Protected API endpoints use `isAuthenticated` middleware
- Vue composable `useAuth()` provides authentication state

## Environment Variables
- `VITE_MAPBOX_ACCESS_TOKEN` - Mapbox API token (optional)
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `SESSION_SECRET` - Session encryption secret (auto-configured)
- `REPL_ID` - Replit application ID (auto-configured)

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
