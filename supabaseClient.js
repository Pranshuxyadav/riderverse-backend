require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Use service role key ONLY on the backend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

module.exports = { supabase };
