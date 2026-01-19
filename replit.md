# CoreUI Free Vue Admin Template

## Overview
This is a Vue.js 3 admin dashboard template built with CoreUI components. It provides a comprehensive set of UI components, layouts, and views for building admin panels and dashboards.

## Project Structure
- `src/` - Main source directory
  - `assets/` - Static assets and icons
  - `components/` - Reusable Vue components
  - `layouts/` - Layout templates (DefaultLayout)
  - `lib/` - Library configurations (Supabase client)
  - `router/` - Vue Router configuration
  - `services/` - API service modules
  - `stores/` - Pinia state management stores
  - `styles/` - SCSS stylesheets
  - `views/` - Page components organized by feature
- `public/` - Static public files
- `supabase/` - Supabase configuration

## Technologies
- Vue 3
- Vite (build tool)
- CoreUI Vue components
- Vue Router
- Pinia (state management)
- Supabase (authentication & database)
- Mapbox GL (maps)
- Chart.js (charts)
- SCSS for styling

## Environment Variables
The app uses the following environment variables (set in Secrets):
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key
- `VITE_MAPBOX_ACCESS_TOKEN` - Mapbox API token

Note: The app will run without Supabase credentials configured, but authentication features will be disabled.

## Development
- Run `npm run dev` to start the development server on port 5000
- Run `npm run build` to build for production
- Run `npm run lint` to lint the code

## Deployment
Configured as a static site deployment. The build output goes to the `dist` directory.
