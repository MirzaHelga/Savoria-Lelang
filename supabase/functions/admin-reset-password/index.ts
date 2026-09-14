// ============================================================
// EDGE FUNCTION: admin-reset-password
//
// Dipanggil dari Panel Admin (html/dashboard.js, modal "Edit User") untuk
// mengganti kata sandi AKUN ORANG LAIN.
//
// KENAPA HARUS LEWAT EDGE FUNCTION (bukan langsung dari browser):
// Mengganti kata sandi akun orang lain cuma bisa lewat Supabase Admin API
// (`auth.admin.updateUserById`), yang butuh SERVICE ROLE KEY. Key itu
// adalah kunci penuh ke seluruh database (melewati semua RLS) — kalau
// ditaruh di kode client (index.html/dashboard.js dsb.), siapa pun tinggal
// buka DevTools untuk mengambilnya dan mengambil alih akun manapun. Jadi
// logika ini dipindah ke sini: jalan di server Supabase, key-nya disimpan
// sebagai secret di server, tidak pernah dikirim ke browser.
//
// ALUR KEAMANAN:
// 1. Verifikasi token pemanggil (harus sedang login).
// 2. Cek di tabel lelang_profiles bahwa pemanggil ber-role 'admin' — lookup
//    ini pakai client dengan token SI PEMANGGIL (kena RLS biasa), BUKAN
//    service role, supaya langkah verifikasi ini sendiri tidak bisa dipakai
//    untuk membaca data yang seharusnya tidak boleh diakses pemanggil.
// 3. BARU SETELAH lolos langkah 2, service role key dipakai untuk aksi
//    spesifik yang diminta (ganti password satu user).
//
// CARA DEPLOY (lihat juga README.md):
//   supabase functions deploy admin-reset-password
// Env var SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY sudah
// otomatis tersedia di semua Edge Function Supabase — tidak perlu di-set
// manual.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      throw new Error('Method tidak didukung.');
    }

    // ---- 1. Ambil & verifikasi token pemanggil ----
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!callerToken) throw new Error('Tidak ada token otorisasi — Anda harus login.');

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData, error: callerErr } = await callerClient.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) throw new Error('Sesi tidak valid, silakan login ulang.');
    const caller = callerData.user;

    // ---- 2. Pastikan pemanggil adalah admin (lookup pakai token pemanggil,
    //         jadi tetap tunduk pada RLS biasa — bukan service role) ----
    const { data: callerProfile, error: profileErr } = await callerClient
      .from('lelang_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();
    if (profileErr || callerProfile?.role !== 'admin') {
      throw new Error('Hanya admin yang boleh mengganti kata sandi user lain.');
    }

    // ---- 3. Validasi input ----
    const body = await req.json().catch(() => ({}));
    const user_id = body?.user_id;
    const new_password = body?.new_password;
    if (!user_id || typeof user_id !== 'string') throw new Error('user_id wajib diisi.');
    if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
      throw new Error('new_password wajib diisi, minimal 6 karakter.');
    }
    if (user_id === caller.id) {
      throw new Error('Untuk ganti kata sandi akun sendiri, pakai tab "Kelola Akun" (tidak butuh service role key).');
    }

    // ---- 4. Baru di sini service role key dipakai, untuk aksi spesifik
    //         yang sudah diverifikasi di langkah 2-3 di atas ----
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
