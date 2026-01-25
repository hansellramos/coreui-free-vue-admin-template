# CoreUI Free Vue Admin Template

## Overview
This project is a comprehensive admin dashboard template built with Vue.js 3 and CoreUI components, designed for managing venues (referred to as "Cabañas"), accommodations, payments, and expenses. It includes an Express.js backend with PostgreSQL, authentication via Replit Auth, and advanced AI features for receipt extraction and customer chat. The primary goal is to provide a robust, scalable, and user-friendly platform for hospitality and venue management, fully localized in Spanish. Key capabilities include CRUD operations for various entities, a flexible permissions system, a subscription model, and analytical dashboards for financial oversight.

## User Preferences
I prefer the application to be fully translated into Spanish. "Venues" should be referred to as "Cabañas" throughout the application. Navigation and UI elements should also be in Spanish (e.g., Panel, Calendario, Próximos, Organizaciones, Cabañas, Contactos, Hospedajes, Pagos).

## System Architecture
The application features a Vue.js 3 frontend utilizing CoreUI components for a consistent UI/UX. The design incorporates Claro/Oscuro/Automático theme selection. State management is handled by Pinia, and routing by Vue Router. The backend is an Express.js server, using Prisma 7 with `@prisma/adapter-pg` for ORM and PostgreSQL database interaction. Authentication is integrated with Replit Auth (OpenID Connect).

Key features include:
- **Comprehensive CRUD APIs**: For organizations, venues, contacts, accommodations, payments, expense categories, expenses, deposits, message templates, and LLM provider configurations.
- **File Uploads**: Supports image uploads (JPEG, PNG, GIF, WebP, max 10MB) for payment receipts, stored in Replit Object Storage.
- **AI-Powered Receipt Extraction**: Utilizes Vercel AI SDK with Anthropic Claude Vision to automatically extract payment amount, reference, and date from uploaded receipts.
- **AI Chat System**: A multi-provider LLM chat system (DeepSeek, Groq, OpenAI, Anthropic) for venues, offering configurable API keys, connection testing, context building from venue data, conversation history, and webhook integration for Twilio and Meta/WhatsApp.
- **Dynamic Message Suggestions**: Provides pre-written WhatsApp message templates for accommodations (e.g., event reminders, booking confirmations, arrival instructions) with dynamic data insertion.
- **Permissions System**: A role-based access control (RBAC) system with customizable profiles, organizational access filtering, and a "Super Admin" role for full system control.
- **Subscription System**: Manages user access via subscriptions, including a trial period, restricted access for expired trials or no subscriptions, and management features for subscription owners and super admins.
- **Venue Plans**: Allows venues to define multiple plans (e.g., pasadía/pasanoche/hospedaje) with pricing, courtesies, schedules, capacities, food descriptions, amenities, and photo galleries.
- **Expenses and Deposits Management**: Tracks expenses by category with optional receipt uploads and manages security deposits through a status flow (pending, refunded, claimed) with evidence uploads.
- **Analytics Dashboard**: Provides financial summaries, monthly income/expense trends, and expense breakdowns by category with date and entity filters.

## External Dependencies
- **CoreUI Vue**: UI component library.
- **Vue Router**: Frontend routing.
- **Pinia**: Vue state management.
- **Mapbox GL**: Interactive maps with geocoding.
- **Chart.js**: Data visualization for charts.
- **PostHog**: Analytics with autocapture.
- **Express.js**: Backend web framework.
- **Prisma 7**: ORM for database interaction, specifically `@prisma/adapter-pg` for PostgreSQL.
- **Replit Auth**: OpenID Connect-based authentication.
- **Vercel AI SDK with @ai-sdk/anthropic**: For AI capabilities, specifically Claude Vision for receipt extraction.
- **Twilio**: For webhook integration with the AI chat system.
- **Meta/WhatsApp Business API**: For webhook integration with the AI chat system.
- **PostgreSQL**: Primary database.