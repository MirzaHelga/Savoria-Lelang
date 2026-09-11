# Savoria Lelang — Balai Lelang Online (HTML + Supabase)

Tampilan didesain ulang mengikuti pola portal **lelang.go.id** (DJKN): siapa
saja bisa menjelajahi lot lelang tanpa login — cari, filter kategori, lihat
harga dan hitung mundur — dan baru diminta masuk/daftar saat benar-benar mau
memasang tawaran. Backend (Supabase) dan logika bidding-nya **tidak diubah**
dari versi sebelumnya, jadi kalau kamu sudah punya project Supabase yang
jalan, tinggal ganti file `index.html`, `style.css`, `app.js` — `schema.sql`
tetap sama persis.

## Apa yang berubah dari versi sebelumnya

- **Beranda publik**: lot lelang, pencarian, filter kategori, dan hitung
  mundur tampil ke siapa saja, tanpa perlu login. Ini aman karena kebijakan
  RLS di `schema.sql` memang sudah mengizinkan siapa saja membaca data lot
  (hanya menulis yang dibatasi).
- **Masuk/Daftar lewat modal**, bukan halaman penuh, supaya orang tidak
  "terkunci" di layar login sebelum sempat melihat barang apa saja yang
  dilelang.
- **Hitung mundur per lot** dan **badge status** (AKTIF / SEGERA BERAKHIR /
  SELESAI) yang diperbarui setiap detik.
- **Pencarian judul/deskripsi** dan **urutan tampilan** (terbaru, paling
  cepat berakhir, harga terendah/tertinggi).
- Statistik di hero (jumlah lelang aktif, kategori, total lot) dihitung dari
  data asli — bukan angka contoh.
- Saat tamu (belum login) membuka sebuah lot dan mencoba bid, ia diarahkan
  masuk/daftar dari dalam jendela detail lot itu sendiri, tanpa kehilangan
  konteks lot yang sedang dilihat.

## Isi folder
- `index.html` — struktur halaman
- `style.css` — tampilan
- `app.js` — semua logika (auth, kategori, lelang, bidding, realtime, pencarian)
- `schema.sql` — skema database, RLS, dan fungsi bid untuk Supabase (tidak berubah)

## Database dipakai bareng aplikasi lain?

Kalau project Supabase ini juga dipakai aplikasi lain, semua tabel aplikasi
lelang ini sudah diberi prefix **`lelang_`** (`lelang_profiles`,
`lelang_categories`, `lelang_auctions`, `lelang_bids`), begitu juga bucket
foto (`lelang-photos`) dan fungsi bid (`place_lelang_bid`). Ini supaya sama
sekali tidak menyentuh tabel `profiles`/`categories`/dll milik aplikasi lain
yang mungkin sudah ada duluan di project yang sama.

`auth.users` (akun login) tetap satu untuk semua aplikasi dalam satu
project — jadi user yang daftar di aplikasi lelang ini otomatis juga punya
akun untuk aplikasi lain di project yang sama (dan sebaliknya). Kalau kamu
tidak mau user-nya tercampur, gunakan project Supabase yang terpisah.

## Cara setup (±10 menit)

1. **Buat project di [supabase.com](https://supabase.com)** (gratis).
2. Buka **SQL Editor** di dashboard Supabase → tempel seluruh isi
   `schema.sql` → klik **Run**. Ini akan membuat:
   - tabel `profiles`, `categories`, `auctions`, `bids`
   - fungsi `place_bid()` yang memproses bid secara aman (anti race condition
     saat dua orang bid bersamaan)
   - Row Level Security: semua orang bisa lihat lelang (login maupun tamu),
     tapi hanya **admin** yang bisa membuat kategori/lelang
   - bucket storage `auction-photos` untuk foto barang
3. Buka **Project Settings → API**, salin `Project URL` dan `anon public key`.
4. Di `app.js`, ganti dua baris di paling atas:
   ```js
   const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
   ```
5. Buka `index.html` di browser (atau upload ke hosting statis apa saja:
   Netlify, Vercel, GitHub Pages, dll — tidak butuh server backend).
6. **Daftar akun pertama** lewat tombol "Daftar" di pojok kanan atas.
   Akun ini otomatis jadi role `user` biasa.
7. Jadikan akun itu admin: buka **SQL Editor** lagi, jalankan (ganti email):
   ```sql
   update lelang_profiles set role = 'admin'
   where id = (select id from auth.users where email = 'emailmu@contoh.com');
   ```
8. Logout & login lagi di aplikasi → tombol **Panel Admin** akan muncul di
   header.

## Aktifkan verifikasi kode (OTP) lewat email

Saat daftar, aplikasi mengirim **kode 6 digit** ke email (bukan link), dan
user harus memasukkan kode itu sebelum bisa masuk. Ini butuh dua pengaturan
di Supabase Dashboard:

1. **Authentication → Sign In / Providers → Email** → pastikan toggle
   **"Confirm email" AKTIF (ON)**.
2. **Authentication → Emails → Templates → pilih "Confirm signup"** →
   pastikan isi template memakai `{{ .Token }}` (kode 6 digit), bukan
   `{{ .ConfirmationURL }}` (link). Kalau masih pakai link, ganti isi body
   template jadi sesuatu seperti:
   ```
   <h2>Kode verifikasi Anda</h2>
   <p>Masukkan kode berikut di aplikasi: <strong>{{ .Token }}</strong></p>
   <p>Kode berlaku beberapa menit.</p>
   ```
3. Karena email bawaan Supabase punya rate limit ketat, untuk pemakaian
   nyata (banyak user daftar) tetap disarankan pasang **custom SMTP**
   (Resend/SendGrid/Postmark), supaya pengiriman kode OTP tidak gampang kena
   limit.

## Cara kerja fitur utama

- **Menjelajah tanpa login**: siapa saja bisa melihat daftar lot, cari,
  filter kategori, dan buka detail lot. Form "Pasang Bid" baru muncul kalau
  sudah login; kalau belum, ada ajakan masuk/daftar di dalam jendela lot itu.
- **Role**: kolom `role` di tabel `lelang_profiles` (`admin` / `user`). Hanya
  bisa diubah lewat SQL Editor — tidak ada tombol "jadi admin" di UI, supaya
  aman.
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

- **"Email rate limit exceeded"** — email bawaan Supabase dibatasi ketat.
  Pasang custom SMTP untuk pemakaian nyata, atau tunggu limit reset saat
  testing.
- **"JWT issued at future"** — jam di perangkatmu tidak sinkron dengan waktu
  sebenarnya. Sinkronkan jam sistem (Windows: `w32tm /resync` lewat
  Command Prompt as Administrator), lalu login ulang.

## Yang bisa dikembangkan lagi
- Hapus/edit lelang yang sudah dibuat
- Notifikasi saat posisi seseorang tergeser
- Penentuan pemenang otomatis saat `end_time` lewat (bisa pakai Supabase
  Edge Function + cron)
- Riwayat lelang yang sudah selesai per pengguna
- Halaman detail lot dengan URL sendiri (saat ini masih berupa modal), agar
  bisa dibagikan sebagai tautan langsung ke satu lot
