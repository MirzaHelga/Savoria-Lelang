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

-- lelang_bids: semua bisa lihat (untuk peringkat), tulis HANYA lewat fungsi place_lelang_bid()
drop policy if exists "lelang_bids_select_all" on lelang_bids;
create policy "lelang_bids_select_all" on lelang_bids for select using (true);

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
-- MENJADIKAN AKUN PERTAMA SEBAGAI ADMIN
-- Daftar dulu lewat aplikasi, lalu jalankan baris di bawah ini
-- (ganti email-nya) untuk menjadikan akun tsb admin:
--
-- update lelang_profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'admin@contoh.com');
-- ============================================================
