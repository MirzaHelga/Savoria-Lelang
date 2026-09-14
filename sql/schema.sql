-- ============================================================
-- SKEMA DATABASE APLIKASI LELANG
-- Semua tabel diberi prefix "lelang_" supaya TIDAK bentrok
-- dengan tabel aplikasi lain di project Supabase yang sama.
-- Jalankan seluruh file ini di Supabase Dashboard > SQL Editor
-- ============================================================

-- 0. BERSIHKAN PERCOBAAN SEBELUMNYA (aman dijalankan berkali-kali) ----
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();
drop function if exists place_bid(uuid, numeric);
drop table if exists bids cascade;
drop table if exists auctions cascade;
drop table if exists categories cascade;
-- Catatan: kita SENGAJA tidak menyentuh tabel "profiles" yang mungkin
-- sudah dipakai aplikasi lain di project ini.

-- 1. PROFIL PENGGUNA KHUSUS APLIKASI LELANG (role: admin / user) ------
create table if not exists lelang_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

-- Data tambahan yang wajib diisi peserta (bukan admin) sesaat setelah
-- daftar, lewat form onboarding di index.html/js/auth.js.
alter table lelang_profiles add column if not exists company_name text;
alter table lelang_profiles add column if not exists phone text;
alter table lelang_profiles add column if not exists address text;
alter table lelang_profiles add column if not exists business_type text;
alter table lelang_profiles add column if not exists onboarding_completed boolean not null default false;

-- Otomatis buat baris profil setiap ada user baru daftar
create or replace function handle_new_lelang_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lelang_profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_lelang_user_created on auth.users;
create trigger on_lelang_user_created
  after insert on auth.users
  for each row execute function handle_new_lelang_user();

-- 2. KATEGORI ---------------------------------------------------
create table if not exists lelang_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- 3. LELANG (LOT) -------------------------------------------------
create table if not exists lelang_auctions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  category_id uuid references lelang_categories(id) on delete set null,
  photo_url text,                      -- foto utama (kompatibilitas lama)
  photo_urls text[] not null default '{}',  -- semua foto, urutan sesuai upload
  starting_price numeric not null check (starting_price >= 0),
  bid_increment numeric not null check (bid_increment > 0),
  current_price numeric,               -- null = belum ada bid
  status text not null default 'active' check (status in ('active','closed')),
  end_time timestamptz,
  created_by uuid references lelang_profiles(id),
  created_at timestamptz not null default now()
);

-- Migrasi aman untuk project yang sudah pernah menjalankan schema versi lama
-- (kolom lama "photo_url" dipertahankan, foto yang sudah ada dipindah ke array)
alter table lelang_auctions add column if not exists photo_urls text[] not null default '{}';
update lelang_auctions
  set photo_urls = array[photo_url]
  where photo_url is not null and coalesce(array_length(photo_urls, 1), 0) = 0;

-- 4. RIWAYAT BID --------------------------------------------------
create table if not exists lelang_bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references lelang_auctions(id) on delete cascade,
  user_id uuid not null references lelang_profiles(id),
  amount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists lelang_bids_auction_amount_idx on lelang_bids (auction_id, amount desc);

-- ============================================================
-- FUNGSI BID ATOMIK
-- Memasang bid dengan row-lock supaya dua orang yang bid
-- bersamaan tidak saling menimpa (mencegah race condition).
-- ============================================================
create or replace function place_lelang_bid(p_auction_id uuid, p_amount numeric)
returns lelang_bids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction lelang_auctions%rowtype;
  v_min_next numeric;
  v_bid lelang_bids%rowtype;
begin
  select * into v_auction from lelang_auctions where id = p_auction_id for update;

  if not found then
    raise exception 'Lelang tidak ditemukan';
  end if;
  if v_auction.status <> 'active' then
    raise exception 'Lelang sudah ditutup';
  end if;
  if v_auction.end_time is not null and v_auction.end_time < now() then
    raise exception 'Waktu lelang sudah berakhir';
  end if;

  if v_auction.current_price is null then
    v_min_next := v_auction.starting_price;
  else
    v_min_next := v_auction.current_price + v_auction.bid_increment;
  end if;

  if p_amount < v_min_next then
    raise exception 'Bid minimal adalah %', v_min_next;
  end if;

  insert into lelang_bids (auction_id, user_id, amount)
  values (p_auction_id, auth.uid(), p_amount)
  returning * into v_bid;

  update lelang_auctions set current_price = p_amount where id = p_auction_id;

  return v_bid;
end;
$$;

grant execute on function place_lelang_bid(uuid, numeric) to authenticated;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table lelang_profiles enable row level security;
alter table lelang_categories enable row level security;
alter table lelang_auctions enable row level security;
alter table lelang_bids enable row level security;

-- lelang_profiles: semua orang login bisa lihat (untuk tampilkan nama penawar)
drop policy if exists "lelang_profiles_select_all" on lelang_profiles;
create policy "lelang_profiles_select_all" on lelang_profiles for select using (true);
drop policy if exists "lelang_profiles_update_own_name" on lelang_profiles;
create policy "lelang_profiles_update_own_name" on lelang_profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- lelang_categories: semua bisa lihat, hanya admin yang kelola
drop policy if exists "lelang_categories_select_all" on lelang_categories;
create policy "lelang_categories_select_all" on lelang_categories for select using (true);
drop policy if exists "lelang_categories_admin_write" on lelang_categories;
create policy "lelang_categories_admin_write" on lelang_categories for all
  using (exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin'));

-- lelang_auctions: semua bisa lihat, hanya admin yang kelola
drop policy if exists "lelang_auctions_select_all" on lelang_auctions;
create policy "lelang_auctions_select_all" on lelang_auctions for select using (true);
drop policy if exists "lelang_auctions_admin_write" on lelang_auctions;
create policy "lelang_auctions_admin_write" on lelang_auctions for all
  using (exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin'));

-- lelang_bids: peserta HANYA boleh lihat bid MEREKA SENDIRI (privasi antar
-- peserta), admin boleh lihat semua (untuk kelola). Tulis HANYA lewat fungsi
-- place_lelang_bid(). Peringkat & jumlah peserta dihitung lewat fungsi
-- security-definer di bawah, supaya peserta tetap bisa tahu posisinya tanpa
-- perlu izin melihat baris bid milik orang lain.
drop policy if exists "lelang_bids_select_all" on lelang_bids;
drop policy if exists "lelang_bids_select_own_or_admin" on lelang_bids;
create policy "lelang_bids_select_own_or_admin" on lelang_bids
for select using (
  auth.uid() = user_id
  or exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Rank pengguna yang sedang login di sebuah lelang, tanpa membuka data
-- bid milik peserta lain ke client.
create or replace function get_my_lelang_rank(p_auction_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select user_id, max(amount) as best,
           row_number() over (order by max(amount) desc) as rnk
    from lelang_bids
    where auction_id = p_auction_id
    group by user_id
  )
  select rnk::int from ranked where user_id = auth.uid();
$$;

-- Jumlah peserta unik yang sudah bid di sebuah lelang (untuk ditampilkan
-- ke peserta biasa sebagai konteks, tanpa membuka identitas/jumlah bid mereka).
create or replace function count_lelang_bidders(p_auction_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  select count(distinct user_id)::int from lelang_bids where auction_id = p_auction_id;
$$;

grant execute on function get_my_lelang_rank(uuid) to authenticated;
grant execute on function count_lelang_bidders(uuid) to authenticated, anon;

-- ============================================================
-- STORAGE: bucket foto lelang (nama khusus, tidak bentrok)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('lelang-photos', 'lelang-photos', true)
on conflict (id) do nothing;

drop policy if exists "lelang_photos_public_read" on storage.objects;
create policy "lelang_photos_public_read" on storage.objects for select
  using (bucket_id = 'lelang-photos');
drop policy if exists "lelang_photos_admin_upload" on storage.objects;
create policy "lelang_photos_admin_upload" on storage.objects for insert
  with check (
    bucket_id = 'lelang-photos'
    and exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ============================================================
-- 5. PEMENANG & ANTI-SNIPING — kolom tambahan di lelang_auctions
-- ============================================================
alter table lelang_auctions add column if not exists winner_id uuid references lelang_profiles(id);
alter table lelang_auctions add column if not exists winner_amount numeric;
alter table lelang_auctions add column if not exists closed_at timestamptz;
alter table lelang_auctions add column if not exists extended_count int not null default 0;

-- ============================================================
-- 6. NOTIFIKASI (in-app, per peserta)
-- ============================================================
create table if not exists lelang_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references lelang_profiles(id) on delete cascade,
  auction_id uuid references lelang_auctions(id) on delete cascade,
  type text not null check (type in ('win','lose')),
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists lelang_notifications_user_idx on lelang_notifications (user_id, created_at desc);

alter table lelang_notifications enable row level security;

-- Peserta hanya boleh lihat & tandai-baca notifikasi miliknya sendiri.
-- Insert HANYA lewat fungsi close_lelang_auction() (security definer di
-- bawah), jadi sengaja tidak ada policy insert untuk role authenticated.
drop policy if exists "lelang_notifications_select_own" on lelang_notifications;
create policy "lelang_notifications_select_own" on lelang_notifications
  for select using (auth.uid() = user_id);
drop policy if exists "lelang_notifications_update_own" on lelang_notifications;
create policy "lelang_notifications_update_own" on lelang_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Catatan: aktifkan Realtime untuk tabel "lelang_notifications" di
-- Supabase Dashboard > Database > Replication, supaya notif baru (mis.
-- "Anda menang") langsung muncul di browser peserta tanpa refresh.

-- ============================================================
-- FUNGSI: TUTUP SATU LELANG, TENTUKAN PEMENANG, KIRIM NOTIFIKASI
-- Dipakai baik oleh admin (tutup manual) maupun oleh penutupan otomatis
-- di bawah. Aman dipanggil berkali-kali pada lelang yang sama — begitu
-- statusnya bukan 'active' lagi, fungsi langsung berhenti tanpa efek.
-- ============================================================
create or replace function close_lelang_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction lelang_auctions%rowtype;
  v_winner record;
  v_bidder record;
begin
  select * into v_auction from lelang_auctions where id = p_auction_id for update;

  if not found or v_auction.status <> 'active' then
    return;
  end if;

  -- Pemenang = bid tertinggi; kalau seri, yang lebih dulu memasang bid itu.
  select user_id, amount into v_winner
  from lelang_bids
  where auction_id = p_auction_id
  order by amount desc, created_at asc
  limit 1;

  update lelang_auctions
  set status = 'closed',
      closed_at = now(),
      winner_id = v_winner.user_id,
      winner_amount = v_winner.amount
  where id = p_auction_id;

  if v_winner.user_id is not null then
    insert into lelang_notifications (user_id, auction_id, type, message)
    values (
      v_winner.user_id, p_auction_id, 'win',
      'Selamat! Anda memenangkan lelang "' || v_auction.title || '" dengan tawaran Rp' || to_char(v_winner.amount, 'FM999,999,999,999')
    );
  end if;

  for v_bidder in
    select distinct user_id from lelang_bids
    where auction_id = p_auction_id
      and (v_winner.user_id is null or user_id <> v_winner.user_id)
  loop
    insert into lelang_notifications (user_id, auction_id, type, message)
    values (
      v_bidder.user_id, p_auction_id, 'lose',
      'Lelang "' || v_auction.title || '" telah berakhir. Tawaran Anda kali ini belum menang.'
    );
  end loop;
end;
$$;

grant execute on function close_lelang_auction(uuid) to authenticated;

-- ============================================================
-- FUNGSI: TUTUP OTOMATIS SEMUA LELANG YANG WAKTUNYA SUDAH LEWAT
-- Tidak ada scheduler bawaan di sini (pg_cron perlu diaktifkan terpisah
-- di Supabase Dashboard > Database > Extensions kalau mau dijadwalkan
-- di server). Sebagai gantinya, fungsi ini dipanggil dari client secara
-- berkala (lihat js/app.js) — siapa pun yang sedang membuka halaman akan
-- memicu penutupan lelang yang sudah lewat waktu.
-- ============================================================
create or replace function close_expired_lelang_auctions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id from lelang_auctions
    where status = 'active' and end_time is not null and end_time < now()
  loop
    perform close_lelang_auction(r.id);
  end loop;
end;
$$;

grant execute on function close_expired_lelang_auctions() to authenticated, anon;

-- ============================================================
-- ANTI-SNIPING: bid yang masuk dalam 2 menit terakhir memperpanjang
-- waktu lelang 2 menit lagi, supaya peserta lain masih sempat menanggapi.
-- Mengganti fungsi place_lelang_bid() versi awal di bagian 4 di atas.
-- ============================================================
create or replace function place_lelang_bid(p_auction_id uuid, p_amount numeric)
returns lelang_bids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction lelang_auctions%rowtype;
  v_min_next numeric;
  v_bid lelang_bids%rowtype;
  v_snipe_window interval := interval '2 minutes';
  v_snipe_extend interval := interval '2 minutes';
begin
  select * into v_auction from lelang_auctions where id = p_auction_id for update;

  if not found then
    raise exception 'Lelang tidak ditemukan';
  end if;
  if v_auction.status <> 'active' then
    raise exception 'Lelang sudah ditutup';
  end if;
  if v_auction.end_time is not null and v_auction.end_time < now() then
    raise exception 'Waktu lelang sudah berakhir';
  end if;

  if v_auction.current_price is null then
    v_min_next := v_auction.starting_price;
  else
    v_min_next := v_auction.current_price + v_auction.bid_increment;
  end if;

  if p_amount < v_min_next then
    raise exception 'Bid minimal adalah %', v_min_next;
  end if;

  insert into lelang_bids (auction_id, user_id, amount)
  values (p_auction_id, auth.uid(), p_amount)
  returning * into v_bid;

  if v_auction.end_time is not null and v_auction.end_time - now() < v_snipe_window then
    update lelang_auctions
    set current_price = p_amount,
        end_time = now() + v_snipe_extend,
        extended_count = extended_count + 1
    where id = p_auction_id;
  else
    update lelang_auctions set current_price = p_amount where id = p_auction_id;
  end if;

  return v_bid;
end;
$$;

grant execute on function place_lelang_bid(uuid, numeric) to authenticated;

-- ============================================================
-- 7. KELOLA USER (Panel Admin) & KELOLA AKUN (admin + peserta)
-- ============================================================

-- Email disimpan juga di lelang_profiles (bukan cuma di auth.users) supaya
-- admin bisa melihat/mencari berdasarkan email di menu "Kelola User" lewat
-- anon key biasa — client tidak punya akses baca ke auth.users.
alter table lelang_profiles add column if not exists email text;

-- Status aktif/nonaktif, pengganti "hapus akun". Menghapus baris di
-- lelang_profiles tidak ikut menghapus baris di auth.users (butuh service
-- role key yang tidak boleh dipakai di client), jadi admin menonaktifkan
-- akun peserta bermasalah alih-alih menghapusnya.
alter table lelang_profiles add column if not exists is_active boolean not null default true;

-- Isi kolom email untuk akun yang sudah lebih dulu terdaftar sebelum kolom
-- ini ada (akun baru otomatis terisi lewat trigger yang diperbarui di bawah).
update lelang_profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- Trigger pembuatan profil baru, diperbarui supaya ikut menyimpan email.
create or replace function handle_new_lelang_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lelang_profiles (id, full_name, role, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'user', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Izinkan admin meng-update baris profil SIAPA SAJA (dipakai fitur "Kelola
-- User": ubah role & nonaktifkan akun). Kebijakan "update milik sendiri"
-- yang sudah ada (di bagian 1) tetap dipertahankan, supaya peserta bisa
-- mengedit datanya sendiri lewat "Kelola Akun".
drop policy if exists "lelang_profiles_admin_update_any" on lelang_profiles;
create policy "lelang_profiles_admin_update_any" on lelang_profiles for update
  using (exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from lelang_profiles p where p.id = auth.uid() and p.role = 'admin'));

-- PENTING — CELAH KEAMANAN YANG DITUTUP DI SINI:
-- Kebijakan "update milik sendiri" mengizinkan seorang user meng-update
-- SEMUA kolom di baris miliknya sendiri, termasuk kolom "role". Row Level
-- Security Postgres tidak bisa membatasi per-kolom, jadi tanpa trigger ini
-- siapa pun yang login bisa menjadikan dirinya admin sendiri lewat console
-- browser (`sb.from('lelang_profiles').update({role:'admin'})...`). Trigger
-- ini menolak perubahan role/is_active kecuali pelakunya sudah admin.
create or replace function guard_lelang_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    select (role = 'admin') into v_is_admin from lelang_profiles where id = auth.uid();
    if not coalesce(v_is_admin, false) then
      new.role := old.role;
      new.is_active := old.is_active;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_lelang_profile_privileged on lelang_profiles;
create trigger trg_guard_lelang_profile_privileged
  before update on lelang_profiles
  for each row execute function guard_lelang_profile_privileged_fields();

-- Akun yang dinonaktifkan admin tidak boleh memasang bid lagi — dicek di
-- server (fungsi ini), bukan cuma disembunyikan di tampilan.
create or replace function place_lelang_bid(p_auction_id uuid, p_amount numeric)
returns lelang_bids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction lelang_auctions%rowtype;
  v_min_next numeric;
  v_bid lelang_bids%rowtype;
  v_snipe_window interval := interval '2 minutes';
  v_snipe_extend interval := interval '2 minutes';
  v_is_active boolean;
begin
  select is_active into v_is_active from lelang_profiles where id = auth.uid();
  if not coalesce(v_is_active, true) then
    raise exception 'Akun Anda telah dinonaktifkan admin. Hubungi admin untuk info lebih lanjut.';
  end if;

  select * into v_auction from lelang_auctions where id = p_auction_id for update;

  if not found then
    raise exception 'Lelang tidak ditemukan';
  end if;
  if v_auction.status <> 'active' then
    raise exception 'Lelang sudah ditutup';
  end if;
  if v_auction.end_time is not null and v_auction.end_time < now() then
    raise exception 'Waktu lelang sudah berakhir';
  end if;

  if v_auction.current_price is null then
    v_min_next := v_auction.starting_price;
  else
    v_min_next := v_auction.current_price + v_auction.bid_increment;
  end if;

  if p_amount < v_min_next then
    raise exception 'Bid minimal adalah %', v_min_next;
  end if;

  insert into lelang_bids (auction_id, user_id, amount)
  values (p_auction_id, auth.uid(), p_amount)
  returning * into v_bid;

  if v_auction.end_time is not null and v_auction.end_time - now() < v_snipe_window then
    update lelang_auctions
    set current_price = p_amount,
        end_time = now() + v_snipe_extend,
        extended_count = extended_count + 1
    where id = p_auction_id;
  else
    update lelang_auctions set current_price = p_amount where id = p_auction_id;
  end if;

  return v_bid;
end;
$$;

grant execute on function place_lelang_bid(uuid, numeric) to authenticated;

-- ============================================================
-- 8. AKTIFKAN REALTIME UNTUK lelang_bids
-- Ini kemungkinan besar penyebab peringkat penawar di modal bid tidak
-- ter-update otomatis: kode di js/auctions.js berlangganan perubahan
-- (postgres_changes) pada tabel lelang_bids, tapi Supabase hanya mengirim
-- event untuk tabel yang SUDAH didaftarkan ke publication
-- "supabase_realtime" — kalau lelang_bids belum terdaftar (misalnya cuma
-- lelang_auctions & lelang_categories yang diaktifkan dari Dashboard >
-- Database > Replication), event bid baru tidak pernah terkirim ke
-- browser, dan tampilan cuma ikut update setelah tab di-refresh manual.
-- Blok ini idempotent — aman dijalankan berkali-kali.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lelang_bids'
  ) then
    alter publication supabase_realtime add table lelang_bids;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lelang_auctions'
  ) then
    alter publication supabase_realtime add table lelang_auctions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lelang_categories'
  ) then
    alter publication supabase_realtime add table lelang_categories;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lelang_profiles'
  ) then
    alter publication supabase_realtime add table lelang_profiles;
  end if;
end $$;

-- ============================================================
-- MENJADIKAN AKUN PERTAMA SEBAGAI ADMIN
-- Daftar dulu lewat aplikasi, lalu jalankan baris di bawah ini
-- (ganti email-nya) untuk menjadikan akun tsb admin:
--
-- update lelang_profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'admin@contoh.com');
-- ============================================================
