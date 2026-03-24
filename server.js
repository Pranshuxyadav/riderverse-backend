require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { supabase } = require('./supabaseClient');

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

const app = express();

// allow frontend to send cookies
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());

// session_id (cookie) -> user.id (uuid in Supabase)
const sessions = new Map();

// ---------- Helpers ----------

// read current user from session cookie
async function getUserFromRequest(req) {
  const sid = req.cookies.session_id;
  if (!sid) return null;
  const userId = sessions.get(sid);
  if (!userId) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

// ensure we have a fresh access token for this user
async function getAccessTokenForUser(user) {
  const now = Math.floor(Date.now() / 1000);

  // token still valid?
  if (user.expires_at > now + 60) {
    return user.access_token;
  }

  // refresh token with Strava
  const resp = await axios.post(
    'https://www.strava.com/oauth/token',
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: user.refresh_token,
    }
  );

  const { access_token, refresh_token, expires_at } = resp.data;

  // update user in Supabase
  const { error } = await supabase
    .from('users')
    .update({
      access_token,
      refresh_token,
      expires_at,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id);

  if (error) {
    console.error('Failed updating tokens in DB', error);
  }

  return access_token;
}

// ---------- Routes ----------

// 1) Start OAuth with Strava
app.get('/auth/strava', (req, res) => {
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI); // must match callback token request
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all');

  res.redirect(url.toString());
});

// 2) Callback from Strava
app.get('/auth/strava/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send('Strava error: ' + error);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code from Strava');
  }

  try {
    // Exchange code for tokens
    const response = await axios.post(
      'https://www.strava.com/oauth/token',
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI // MUST be identical to /auth/strava
      }
    );

    const { access_token, refresh_token, expires_at, athlete } = response.data;

    // Upsert user by athlete_id in Supabase
    const { data, error: dbError } = await supabase
      .from('users')
      .upsert(
        {
          athlete_id: athlete.id,
          access_token,
          refresh_token,
          expires_at,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'athlete_id' }
      )
      .select()
      .single();

    if (dbError) {
      console.error(dbError);
      return res.status(500).send('DB error while saving user');
    }

    // Create in‑memory session
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, data.id);

    // Set httpOnly cookie so frontend can call /api/my-activities
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      sameSite: 'lax'
      // secure: true   // add this once you are fully on HTTPS frontend as well
    });

    res.send(
      `<h1>Strava connected!</h1><p>You can close this tab and go back to RiderVerse.</p>`
    );
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('Error exchanging token with Strava');
  }
});
// optional: who am I
app.get('/api/me', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ athlete_id: user.athlete_id });
});

// 3) get recent activities for current user
app.get('/api/my-activities', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Not logged in via Strava' });
    }

    const accessToken = await getAccessTokenForUser(user);

    const response = await axios.get(
      'https://www.strava.com/api/v3/athlete/activities',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { per_page: 10, page: 1 },
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// root page
app.get('/', (req, res) => {
  res.send('<h1>RiderVerse Backend</h1><p>Use /auth/strava to connect, /api/my-activities to test.</p>');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
