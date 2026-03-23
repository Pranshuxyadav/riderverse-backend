# RiderVerse Backend

Node.js backend for RiderVerse – handles Strava OAuth, fetches activities from Strava, and stores ride data in Supabase.

## Tech Stack

- Node.js + Express
- Strava API (OAuth)
- Supabase (PostgreSQL)
- Axios, CORS, cookie-parser, dotenv

## Project Structure

- `server.js` – main Express server, routes for auth + API
- `supabaseClient.js` – Supabase client configuration
- `package.json` – dependencies and scripts
- `.env` – local environment variables (not committed)

## Setup (Local)

1. Install dependencies:

   ```bash
   npm install
