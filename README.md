# Clynk API

Backend API for a clinic and medical booking platform built with Node.js, Express, SQL Server, JWT authentication, and Cloudinary uploads.

This project supports:
- User authentication with `patient`, `doctor`, `staff`, and `admin` roles
- Doctor and clinic discovery
- Clinic creation and approval workflows
- Staff creation and verification workflows
- Booking and slot management
- Notifications
- Ratings for doctors and clinics
- Prescription access requests and prescription records
- Audit logging and admin audit-log browsing

## Tech Stack

- Node.js
- Express 5
- Microsoft SQL Server via `mssql`
- JWT authentication with HTTP-only cookies
- Cloudinary for image uploads
- Winston for audit logging
- `express-rate-limit` for request throttling

## Project Structure

```text
.
|-- config/
|   |-- cloudinary.js
|   `-- db.Config.js
|-- controllers/
|-- middlewares/
|-- migrations/
|-- routes/
|-- utilts/
|-- logs/
|-- server.js
`-- package.json
```

### Key folders

- `config/`: database and Cloudinary configuration
- `controllers/`: business logic for every API area
- `middlewares/`: auth, validation, CORS, rate limiting, uploads, audit logging, and error handling
- `routes/`: route definitions grouped by feature
- `migrations/`: SQL scripts for schema creation and later additions
- `utilts/`: shared helpers, custom errors, notifications, slot generation, API helpers, and audit utilities
- `logs/`: generated audit logs

## How the API Is Organized

`server.js` boots the Express app, connects to SQL Server, applies CORS, cookie parsing, request-body parsing, rate limiters, and audit logging, then mounts these route groups:

- `/api/auth`
- `/api/user`
- `/api/clinic`
- `/api/staff`
- `/api/doctors`
- `/api/book`
- `/api/notifications`
- `/api/admin`
- `/api/ratings`
- `/api/prescriptions`

## Features

### Authentication and roles

- Signup supports `patient`, `doctor`, and `staff`
- Login returns role-specific profile data
- Access and refresh tokens are signed with JWT
- Tokens are stored in HTTP-only cookies: `jwt` and `refresh_token`
- Protected routes use role-based authorization through `protect` and `restrictTo`
- Password reset uses a one-time emailed token that is stored hashed and expires automatically
- Doctor accounts receive an email telling them to wait for admin verification before verified features are available

### Clinics and staff

- Verified doctors can create clinics
- Clinics start with `pending` status and must be approved or rejected by an admin
- Clinic owners can create staff accounts for their clinic
- Staff can be `doctor`, `nurse`, or `receptionist`
- Clinic owners can verify pending staff accounts

### Doctor discovery and booking

- Public doctor listing supports specialist filtering
- Public clinic listing includes rating and doctor-count summaries
- Patients can book either:
  - an independent verified doctor
  - a verified clinic staff doctor
- Booking slots are 30 minutes
- Bookings are validated against working days, working hours, and overlap rules

### Ratings

- Patients can rate doctors and clinics
- Ratings are limited to users with confirmed bookings
- Existing ratings are updated instead of duplicated

### Prescriptions

- Doctors and staff doctors can request access to a patient prescription flow for a booking
- Patients can accept or reject access requests
- Prescription permissions can be reused for future bookings
- Doctors and staff doctors can create one prescription per booking
- Doctors, staff, and patients can view their prescription records

### Notifications and audit logs

- Important workflow events create notifications
- Request/response activity is written to audit logs
- Admins can query audit logs with filters such as level, actor, method, status code, and path

## Database

This project uses Microsoft SQL Server.

Main tables created by the migration scripts:

- `Users`
- `Admins`
- `Clinics`
- `Doctors`
- `Patients`
- `Staff`
- `Bookings`
- `Notifications`
- `Ratings`
- `Prescriptions`
- `PrescriptionPermissions`

### Migration files

- `migrations/create_users.sql`: base schema for users, clinics, doctors, patients, staff, bookings, notifications, and prescription-related tables
- `migrations/create_ratings.sql`: ratings table and indexes
- `migrations/add_prescription_access_flow.sql`: additive migration for prescription access workflow and related indexes
- `migrations/add_password_reset_fields.sql`: additive migration for password reset token storage

## Environment Variables

Create a `.env` file in the project root.

```env
PORT=3001
NODE_ENV=development

DB_HOST=localhost
DB_NAME=CLYNK
DB_USER=your_sql_user
DB_PASSWORD=your_sql_password

JWT_SECRET=your_access_token_secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_REFRESH_EXPIRES_IN=30d

ALLOWED_ORIGINS=http://localhost:3000

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX_REQUESTS=10
WRITE_RATE_LIMIT_WINDOW_MS=600000
WRITE_RATE_LIMIT_MAX_REQUESTS=20
ADMIN_RATE_LIMIT_WINDOW_MS=900000
ADMIN_RATE_LIMIT_MAX=50

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USERNAME=your_email_username
EMAIL_PASSWORD=your_email_password
EMAIL_FROM=no-reply@example.com
FRONTEND_URL=http://localhost:3000
PASSWORD_RESET_URL=http://localhost:3000/reset-password/:token
PASSWORD_RESET_TOKEN_EXPIRES_MINUTES=10
```

## Installation

```bash
npm install
```

## Running the Project

Development:

```bash
npm run dev
```

Production-style start:

```bash
npm start
```

Default port is `3001` unless `PORT` is provided.

## Database Setup

1. Create a SQL Server database.
2. Run `migrations/create_users.sql`.
3. Run `migrations/create_ratings.sql`.
4. Run `migrations/add_prescription_access_flow.sql` if your database was created before the prescription access flow was added.
5. Run `migrations/add_password_reset_fields.sql` if your database was created before password reset support was added.

If you are starting from scratch and `create_users.sql` already includes the latest prescription schema, review whether the final migration is still needed in your environment before applying it.

## API Overview

### Auth

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/forget-password`
- `PATCH /api/auth/reset-password/:token`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

### User

- `GET /api/user/me`
- `PATCH /api/user/me`

`PATCH /api/user/me` supports profile updates and image upload via Cloudinary using the `photo` field.

### Clinics

- `POST /api/clinic`
- `GET /api/clinic`
- `GET /api/clinic/:clinicId/staff`
- `GET /api/clinic/:id/profile`
- `GET /api/clinic/my-stats`

### Doctors

- `GET /api/doctors`
- `GET /api/doctors/best`
- `GET /api/doctors/:id/profile`
- `GET /api/doctors/dashboard`

### Staff

- `GET /api/staff/:id/profile`
- `POST /api/staff/create`
- `GET /api/staff/pending`
- `GET /api/staff/my-clinic`
- `PATCH /api/staff/:staffId/verify`

### Bookings

- `POST /api/book`
- `GET /api/book/my-bookings`
- `GET /api/book/clinic-bookings`
- `GET /api/book/slots`
- `PATCH /api/book/clinic-bookings/:id/cancel`
- `PATCH /api/book/:id/cancel`

### Notifications

- `GET /api/notifications/me`
- `PATCH /api/notifications/:id/read`

### Ratings

- `POST /api/ratings/doctor/:doctorId`
- `POST /api/ratings/clinic/:clinicId`
- `GET /api/ratings/doctor/:doctorId`
- `GET /api/ratings/clinic/:clinicId`

Note: the ratings router is currently protected for patients only, so even the `GET` rating endpoints require a patient-authenticated request.

### Prescriptions

- `POST /api/prescriptions/bookings/:bookingId/request-access`
- `PATCH /api/prescriptions/bookings/:bookingId/access`
- `POST /api/prescriptions/bookings/:bookingId`
- `GET /api/prescriptions/my-prescriptions`
- `GET /api/prescriptions/:id`

### Admin

- `POST /api/admin/create-admin`
- `GET /api/admin/clinics`
- `PATCH /api/admin/clinics/:id/approve`
- `PATCH /api/admin/clinics/:id/reject`
- `PATCH /api/admin/:id/verify`
- `PATCH /api/admin/:id/unverify`
- `GET /api/admin/doctors`
- `GET /api/admin/staff`
- `GET /api/admin/audit-logs`

All admin routes require an authenticated user with the `admin` role.

## Middleware Summary

- `middlewares/auth.js`: JWT authentication and role restrictions
- `middlewares/auth.Validation.js`: signup, login, and refresh validation
- `middlewares/cors.Handler.js`: allowlist-based CORS using `ALLOWED_ORIGINS`
- `middlewares/rateLimiters.js`: global, auth, write, and admin rate limiting
- `middlewares/upload.Cloudinary.js`: memory uploads plus Cloudinary transfer
- `middlewares/audit.Logger.js`: request audit logging
- `middlewares/error.Handler.js`: centralized error responses
- `middlewares/isClinicOwner.js`: ensures the current doctor owns a clinic
- `middlewares/isVerifiedDoctor.js`: ensures the doctor is verified before clinic creation

## Logging

Audit logs are written under `logs/`:

- `logs/audit.log`
- `logs/audit.info.log`
- `logs/audit.error.log`

Sensitive fields such as passwords, tokens, cookies, and authorization headers are redacted before logging.

## Important Notes

- CORS is strict. Frontend origins must be listed in `ALLOWED_ORIGINS`.
- Cookies use `secure` and `sameSite=none` in production mode.
- Profile photo uploads are limited to image files up to 5 MB.
- The repository contains `node_modules/`; normally this folder should not be committed.
- Some strings in responses and notifications are Arabic text that appear mis-encoded in the current source files.
- There appears to be at least one malformed SQL insert in the signup flow for patients inside `controllers/auth.Controller.js`; review and test this path before using it in production.
- The main helper directory is named `utilts/` rather than `utils/`. Keep that spelling when importing existing modules.

## Suggested Next Steps

- Add API request examples for each role
- Add automated tests
- Add Swagger or OpenAPI documentation
- Add a proper migration runner
- Move secrets out of any shared `.env` files before publishing the repository
