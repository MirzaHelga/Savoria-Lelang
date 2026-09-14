# Savoria Lelang — Balai Lelang Online (HTML + Supabase)

Tampilan didesain ulang mengikuti pola portal **lelang.go.id** (DJKN): siapa
saja bisa menjelajahi lot lelang tanpa login — cari, filter kategori, lihat
harga dan hitung mundur — dan baru diminta masuk/daftar saat benar-benar mau
memasang tawaran. Backend (Supabase) dan logika bidding-nya **tidak diubah**
dari versi sebelumnya.

## Struktur folder

```
Savoria Lelang/
├── index.html          ← beranda publik (SATU-SATUNYA file yang boleh
│                          tetap di root — GitHub Pages & hosting statis
│                          lain butuh index.html di root sebagai halaman awal)
├── html/
│   ├── dashboard.html  ← panel admin, halaman terpisah sendiri
│   └── dashboard.js    ← semua logika panel admin (khusus dashboard.html)
├── js/
│   ├── config.js       ← URL & anon key Supabase, bikin client `sb`
│   ├── shared.js        ← state & fungsi bantu yang dipakai bersama
│   │                       (index.html maupun dashboard.html)
│   ├── auth.js            ← modal masuk/daftar/keluar (khusus index.html)
│   ├── categories.js       ← muat kategori + pill filter (khusus index.html)
│   ├── auctions.js          ← daftar lelang, pencarian, modal bid, realtime
│   │                          (khusus index.html)
│   └── app.js                ← bootstrap kecil yang menjalankan semuanya
│                                saat index.html dibuka
├── css/
│   └── style.css        ← semua tampilan, dipakai index.html & dashboard.html
├── sql/
│   └── schema.sql         ← skema database, RLS, dan fungsi bid (tidak berubah)
└── README.md
```

**Kenapa dipisah begini:**
- `index.html` = halaman publik yang dilihat semua orang.
- `html/dashboard.html` = halaman admin **sungguhan** (bukan lagi bagian
  tersembunyi di dalam index.html). Hanya bisa dibuka kalau sedang login
  sebagai admin — kalau tidak, otomatis dilempar balik ke `index.html`
  (lihat `dashboard.js`).
- `js/config.js` dan `js/shared.js` dipakai **kedua** halaman, makanya
  dimuat duluan di keduanya.
- File js lain khusus untuk satu halaman saja, supaya index.html tidak perlu
  memuat kode admin yang tidak dipakainya (dan sebaliknya).

## Database dipakai bareng aplikasi lain?

Semua tabel aplikasi lelang ini sudah diberi prefix **`lelang_`**
(`lelang_profiles`, `lelang_categories`, `lelang_auctions`, `lelang_bids`),
begitu juga bucket foto (`lelang-photos`) dan fungsi bid
(`place_lelang_bid`). Ini supaya sama sekali tidak menyentuh tabel
`profiles`/`categories`/dll milik aplikasi lain yang mungkin sudah ada
duluan di project Supabase yang sama.

`auth.users` (akun login) tetap satu untuk semua aplikasi dalam satu
project — jadi user yang daftar di aplikasi lelang ini otomatis juga punya
akun untuk aplikasi lain di project yang sama (dan sebaliknya). Kalau kamu
tidak mau user-nya tercampur, gunakan project Supabase yang terpisah.

## Cara setup (±10 menit)

1. **Buat project di [supabase.com](https://supabase.com)** (gratis).
2. Buka **SQL Editor** di dashboard Supabase → tempel seluruh isi
   `sql/schema.sql` → klik **Run**. Ini akan membuat:
   - tabel `lelang_profiles`, `lelang_categories`, `lelang_auctions`, `lelang_bids`
   - fungsi `place_lelang_bid()` yang memproses bid secara aman (anti race
     condition saat dua orang bid bersamaan)
   - Row Level Security: semua orang bisa lihat lelang (login maupun tamu),
     tapi hanya **admin** yang bisa membuat kategori/lelang
   - bucket storage `lelang-photos` untuk foto barang
3. Buka **Project Settings → API**, salin `Project URL` dan `anon public key`.
4. Di `js/config.js`, ganti dua baris:
   ```js
   const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
   ```
5. Upload seluruh folder ke hosting statis apa saja (Netlify, Vercel, GitHub
   Pages, dll — tidak butuh server backend), atau buka `index.html`
   langsung di browser untuk uji coba lokal.
6. **Daftar akun pertama** lewat tombol "Daftar" di pojok kanan atas.
   Akun ini otomatis jadi role `user` biasa.
7. Jadikan akun itu admin: buka **SQL Editor** lagi, jalankan (ganti email):
   ```sql
   update lelang_profiles set role = 'admin'
   where id = (select id from auth.users where email = 'emailmu@contoh.com');
   ```
8. Logout & login lagi di aplikasi → tombol **Panel Admin** akan muncul di
   header, mengarah ke `html/dashboard.html`.

## Verifikasi email saat daftar — status saat ini: NONAKTIF

Supaya proses daftar tidak terblokir oleh rate limit email Supabase saat
development, "Confirm email" saat ini **dimatikan** di Supabase Dashboard,
dan `js/auth.js` langsung meloloskan user begitu `signUp()` sukses — tanpa
minta kode OTP.

**Mau diaktifkan lagi (disarankan sebelum benar-benar publik):**
1. Pasang custom SMTP (Resend/SendGrid/Postmark) di **Authentication →
   Emails → SMTP Settings**, supaya pengiriman email tidak kena rate limit
   ketat bawaan Supabase. Sender email harus pakai domain yang sudah
   diverifikasi di provider SMTP tersebut (`onboarding@resend.dev` cuma
   bisa kirim ke email akun kamu sendiri).
2. Nyalakan lagi toggle **"Confirm email"** di **Authentication → Providers
   → Email**.
3. Di `js/auth.js`, cari komentar "OTP email verification (currently
   unused)" dan kembalikan pemanggilan `switchAuthTab('verify')` setelah
   `signUp()` sukses (kode form & handler-nya sudah lengkap, tinggal
   disambungkan lagi).

## Cara kerja fitur utama

- **Menjelajah tanpa login**: siapa saja bisa melihat daftar lot, cari,
  filter kategori, dan buka detail lot. Form "Pasang Bid" baru muncul kalau
  sudah login; kalau belum, ada ajakan masuk/daftar di dalam jendela lot itu.
- **Role**: kolom `role` di tabel `lelang_profiles` (`admin` / `user`). Hanya
  bisa diubah lewat SQL Editor — tidak ada tombol "jadi admin" di UI, supaya
  aman. `html/dashboard.js` memeriksa role ini setiap halaman dibuka dan
  melempar balik ke beranda kalau bukan admin.
- **Kelipatan bidding**: bid minimal berikutnya = harga saat ini + kelipatan.
  Divalidasi di server lewat fungsi `place_lelang_bid()`, bukan cuma di JS,
  jadi tidak bisa dicurangi lewat console browser.
- **Posisi bidding (#1, #2, #3)**: dihitung dari bid tertinggi tiap peserta
  di satu lot, diurutkan dari terbesar. Diperbarui otomatis lewat Supabase
  Realtime setiap ada bid baru — tanpa perlu refresh halaman.
- **Status & hitung mundur**: badge AKTIF/SEGERA BERAKHIR/SELESAI dan teks
  hitung mundur dihitung dari `end_time`, diperbarui setiap detik di browser.
- **Foto opsional, bisa lebih dari satu**: admin bisa memilih beberapa foto
  sekaligus saat membuat lelang. Kartu lot menampilkan foto pertama dengan
  penanda "+N foto" kalau lebih dari satu, dan jendela detail lot punya
  galeri dengan thumbnail yang bisa diklik. Kalau tidak ada foto yang
  diunggah, kartu lot menampilkan placeholder.

## Troubleshooting

- **"Email rate limit exceeded"** — email bawaan Supabase dibatasi ketat
  (2-4 email/jam). Pasang custom SMTP untuk pemakaian nyata, atau tunggu
  limit reset saat testing.
- **"You can only send testing emails to your own email address"** — kamu
  masih pakai `onboarding@resend.dev` sebagai sender di Resend. Verifikasi
  domain sendiri di Resend, lalu ganti sender email di SMTP Settings
  Supabase memakai domain itu.
- **"JWT issued at future"** — jam di perangkatmu tidak sinkron dengan waktu
  sebenarnya. Sinkronkan jam sistem (Windows: `w32tm /resync` lewat
  Command Prompt as Administrator), lalu login ulang.
- **Panel Admin tidak muncul / kelempar balik ke beranda** — pastikan role
  akun kamu sudah `admin` di tabel `lelang_profiles` (lihat langkah 7 di
  atas), lalu logout & login ulang.

## Update: Kelola User (admin) & Kelola Akun (admin + peserta)

- **Panel Admin → tab "Kelola User"**: lihat semua akun (nama, email,
  perusahaan, telepon, role, status aktif), cari/filter, dan tombol **Edit**
  di tiap baris membuka form lengkap: ubah nama/perusahaan/telepon/alamat/
  jenis usaha, ubah role admin ⇄ peserta, ubah status aktif/nonaktif, dan
  **ganti kata sandi user itu langsung**. Ada juga tombol cepat "Jadikan
  Admin/Peserta" dan "Aktifkan/Nonaktifkan" di baris tanpa perlu buka modal.
  Admin **tidak bisa mengubah role/status akunnya sendiri** (sengaja
  dinonaktifkan di form) supaya tidak ada admin yang tidak sengaja
  mengunci diri sendiri.
- **Panel Admin → tab "Kelola Akun"**: admin mengedit nama & ganti kata
  sandinya sendiri.
- **index.html → tombol "Akun Saya"** (muncul di header setelah login,
  khusus peserta): edit nama, perusahaan, telepon, alamat, jenis usaha,
  dan ganti kata sandi.
- **Nonaktifkan, bukan hapus**: karena aplikasi ini tanpa server sendiri
  (client cuma pakai *anon key*, bukan *service role key*), akun tidak
  bisa benar-benar dihapus dari `auth.users` lewat Panel Admin. Sebagai
  gantinya ada kolom `is_active` — akun yang dinonaktifkan langsung
  di-*sign out* saat mencoba login lagi, dan diblok di server (fungsi
  `place_lelang_bid`) kalau tetap mencoba memasang bid.
- **Perbaikan keamanan**: kebijakan RLS lama untuk `lelang_profiles`
  mengizinkan seorang user meng-update SEMUA kolom di baris miliknya
  sendiri — termasuk kolom `role`. Artinya siapa pun yang login bisa
  menjadikan dirinya admin sendiri lewat console browser. Sudah ditambal
  dengan trigger yang menolak perubahan `role`/`is_active` kecuali
  pelakunya sudah admin.

**Wajib jalankan ulang `sql/schema.sql` di SQL Editor Supabase** setelah
update ini (aman dijalankan berkali-kali/idempotent) — ini yang menambah
kolom `email` & `is_active`, kebijakan RLS baru, dan trigger penambal
celah keamanan di atas. Tanpa menjalankan ulang schema ini, tab "Kelola
User"/"Kelola Akun" akan gagal memuat karena kolomnya belum ada.

### Ganti kata sandi user lain — perlu deploy Edge Function (sekali saja)

Mengganti kata sandi **akun orang lain** (bukan akun sendiri) secara
teknis cuma bisa lewat Supabase Admin API, yang butuh *service role key*.
Key itu **tidak boleh pernah** ditaruh di kode client (index.html/js/*) —
siapa saja bisa membukanya lewat DevTools browser dan mengambil alih akun
siapa pun di project Supabase-mu. Karena itu logikanya dipisah ke sebuah
**Supabase Edge Function** (`supabase/functions/admin-reset-password/`)
yang jalan di server Supabase, bukan di browser — key-nya otomatis
tersedia sebagai secret di sana dan tidak pernah dikirim ke browser.
Fungsi ini juga memverifikasi dulu bahwa pemanggilnya benar admin sebelum
mengganti kata sandi siapa pun.

Cara deploy (butuh [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
# 1. Login & hubungkan ke project-mu (sekali saja)
supabase login
supabase link --project-ref YOUR-PROJECT-REF   # lihat di URL dashboard project-mu

# 2. Deploy Edge Function-nya
supabase functions deploy admin-reset-password
```

Tidak perlu men-set secret apa pun secara manual — `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` sudah otomatis
tersedia di semua Edge Function Supabase.

Selama fungsi ini belum di-deploy, semua fitur Panel Admin yang lain
(termasuk edit profil, ubah role, nonaktifkan akun) tetap berfungsi
normal — hanya kolom "ganti kata sandi" di modal Edit User yang akan
menampilkan pesan error kalau diisi.

## Yang bisa dikembangkan lagi
- Hapus/edit lelang yang sudah dibuat
- Notifikasi saat posisi seseorang tergeser
- Penentuan pemenang otomatis saat `end_time` lewat (bisa pakai Supabase
  Edge Function + cron)
- Riwayat lelang yang sudah selesai per pengguna
- Halaman detail lot dengan URL sendiri (saat ini masih berupa modal), agar
  bisa dibagikan sebagai tautan langsung ke satu lot
- Hapus akun sungguhan dari `auth.users` — bisa dibuat dengan pola yang
  sama seperti `admin-reset-password`: Edge Function baru yang memanggil
  `auth.admin.deleteUser()` pakai service role key
