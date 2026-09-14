// ============================================================
// KONFIGURASI SUPABASE — ganti dengan nilai proyekmu sendiri
// (Supabase Dashboard > Project Settings > API)
// ============================================================
const SUPABASE_URL = 'https://pcnrkvxaujutsfytbtrf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbnJrdnhhdWp1dHNmeXRidHJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNjg2MjAsImV4cCI6MjA5OTc0NDYyMH0.xiGmUxRph5qVTjJxRRpGXbJte36XMh2NMgP-qJgBPy8 ';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
