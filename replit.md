# CoreUI Free Vue Admin Template

## Overview
This is a Vue.js 3 admin dashboard template built with CoreUI components. It provides a comprehensive set of UI components, layouts, and views for building admin panels and dashboards.

## Project Structure
- `src/` - Main source directory
  - `assets/` - Static assets and icons
  - `components/` - Reusable Vue components
  - `layouts/` - Layout templates (DefaultLayout)
  - `router/` - Vue Router configuration
  - `services/` - API service modules (placeholder stubs)
  - `stores/` - Pinia state management stores
  - `styles/` - SCSS stylesheets
  - `views/` - Page components organized by feature
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

## Database
A PostgreSQL database is available with the following tables:
- `users` - User accounts
- `organizations` - Organizations
- `venues` - Venues/locations
- `contacts` - Contact information
- `accommodations` - Accommodation bookings
- `countries` - Country reference data
- `states` - State/province reference data
- `contact_organization` - Many-to-many relationship table
- `contact_venue` - Many-to-many relationship table
- `venue_packages` - Venue package options
- `package_prices` - Package pricing

The database connection is available via the `DATABASE_URL` environment variable.

## Environment Variables
- `VITE_MAPBOX_ACCESS_TOKEN` - Mapbox API token (optional)
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)

## Development
- Run `npm run dev` to start the development server on port 5000
- Run `npm run build` to build for production
- Run `npm run lint` to lint the code

## Deployment
Configured as a static site deployment. The build output goes to the `dist` directory.

## Notes
- The services in `src/services/` are currently placeholder stubs that return empty data
- To connect the frontend to the database, you'll need to implement a backend API
