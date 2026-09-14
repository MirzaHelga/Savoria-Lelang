// ------------------------------------------------------------
// GUARD: halaman ini hanya untuk user dengan role 'admin'.
// Tamu atau peserta biasa dilempar balik ke beranda.
// ------------------------------------------------------------
let dashboardInitialized = false;

async function guardAdminAccess(session) {
  currentUser = session ? session.user : null;
  if (!currentUser) { window.location.href = '../index.html'; return; }

  const { data: profile, error } = await sb.from('lelang_profiles').select('*').eq('id', currentUser.id).single();
  if (error) { window.location.href = '../index.html'; return; }
  currentProfile = profile;

  if (profile.role !== 'admin') { window.location.href = '../index.html'; return; }

  if (profile.is_active === false) {
    await sb.auth.signOut();
    window.location.href = '../index.html';
    return;
  }

  $('userBadge').textContent = `${profile.full_name || 'Pengguna'} · Admin`;
  await initDashboard();
}

// Cek dulu sesi yang SUDAH TERSIMPAN (bukan nunggu event auth). Ini penting
// karena begitu pindah dari index.html ke halaman ini, client Supabase yang
// baru butuh waktu memulihkan sesi dari local storage — dan onAuthStateChange
// bisa sempat nembak duluan dengan session kosong sebelum sesi kamu selesai
// dipulihkan, yang kalau dipakai sebagai guard bakal salah lempar admin
// balik ke beranda.
sb.auth.getSession().then(({ data }) => guardAdminAccess(data.session));

// onAuthStateChange tetap dipakai, tapi cuma untuk kasus sesi berubah SETELAH
// halaman ini terbuka (mis. logout dari tab lain) — bukan sebagai guard awal.
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { window.location.href = '../index.html'; return; }
  if (session && !dashboardInitialized) guardAdminAccess(session);
});

$('btnLogout').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = '../index.html';
});

async function initDashboard() {
  if (dashboardInitialized) return; // jangan muat ulang tiap event auth berubah
  dashboardInitialized = true;
  await loadCategories();
  renderCategorySelects();
  renderCategoryList();
  await sb.rpc('close_expired_lelang_auctions'); // tutup lelang yang lewat waktu + tentukan pemenang
  await loadAuctionsForAdmin();
  renderManageList();
  await loadUsers();
  renderUserList();
  fillAdminAccountForm();
  subscribeRealtimeAdmin();
  setInterval(async () => {
    await sb.rpc('close_expired_lelang_auctions');
  }, 20000);
}

// ------------------------------------------------------------
// REALTIME: pastikan tab "Kelola Lelang" (dan dropdown kategori di
// "Buat Lelang") selalu ikut ter-update kalau ada lelang/kategori baru
// yang masuk dari sesi/tab lain SETELAH Panel Admin ini dibuka — tanpa
// realtime ini, data yang dimuat di awal saja bisa jadi basi.
function subscribeRealtimeAdmin() {
  sb.channel('admin-auctions-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lelang_auctions' }, async () => {
      await loadAuctionsForAdmin();
      renderManageList();
    })
    .subscribe();

  sb.channel('admin-categories-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lelang_categories' }, async () => {
      await loadCategories();
      renderCategorySelects();
      renderCategoryList();
    })
    .subscribe();

  sb.channel('admin-profiles-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lelang_profiles' }, async () => {
      await loadUsers();
      renderUserList();
    })
    .subscribe();
}

// ------------------------------------------------------------
// TAB ADMIN: Kategori / Buat Lelang / Kelola Lelang
// ------------------------------------------------------------
// Selain langganan realtime di atas, setiap kali sebuah tab dibuka kita
// paksa muat ulang datanya dari Supabase. Ini jaring pengaman kalau
// realtime telat konek atau lelang dibuat lewat sesi lain sebelum
// Panel Admin ini pertama kali dibuka — jadi tab "Kelola Lelang" tidak
// akan pernah nyangkut kosong padahal lelangnya sudah aktif.
document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('admin' + capitalize(btn.dataset.tab)).classList.add('active');

    if (btn.dataset.tab === 'kelola') {
      await loadAuctionsForAdmin();
      renderManageList();
    } else if (btn.dataset.tab === 'kategori') {
      await loadCategories();
      renderCategorySelects();
      renderCategoryList();
    } else if (btn.dataset.tab === 'buat') {
      await loadCategories();
      renderCategorySelects();
    } else if (btn.dataset.tab === 'user') {
      await loadUsers();
      renderUserList();
    } else if (btn.dataset.tab === 'akun') {
      fillAdminAccountForm();
    }
  });
});

// ------------------------------------------------------------
// KATEGORI (kelola: tambah, hapus, isi dropdown form lelang)
// ------------------------------------------------------------
function renderCategorySelects() {
  const formSel = $('auctionCategory');
  if (formSel) formSel.innerHTML = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderCategoryList() {
  $('categoryList').innerHTML = categories.map(c => `
    <li>
      <span>${escapeHtml(c.name)}</span>
      <button data-id="${c.id}" class="btn-del-cat">Hapus</button>
    </li>`).join('') || '<li>Belum ada kategori.</li>';

  document.querySelectorAll('.btn-del-cat').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Hapus kategori ini?')) return;
      const { error } = await sb.from('lelang_categories').delete().eq('id', b.dataset.id);
      if (error) { showToast('Gagal hapus: ' + error.message, true); return; }
      await loadCategories();
      renderCategorySelects();
      renderCategoryList();
    });
  });
}

$('categoryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('categoryName').value.trim();
  if (!name) return;
  const { error } = await sb.from('lelang_categories').insert({ name });
  if (error) { showToast('Gagal menambah kategori: ' + error.message, true); return; }
  $('categoryName').value = '';
  await loadCategories();
  renderCategorySelects();
  renderCategoryList();
});

// ------------------------------------------------------------
// BUAT LELANG
// ------------------------------------------------------------
$('auctionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auctionFormError').textContent = '';
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const photo_urls = [];
    const files = Array.from($('auctionPhoto').files || []);
    for (const file of files) {
      const path = `${currentUser.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await sb.storage.from('lelang-photos').upload(path, file);
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from('lelang-photos').getPublicUrl(path);
      photo_urls.push(pub.publicUrl);
    }

    const payload = {
      title: $('auctionTitle').value.trim(),
      description: $('auctionDesc').value.trim(),
      category_id: $('auctionCategory').value,
      photo_url: photo_urls[0] || null,
      photo_urls,
      starting_price: Number($('auctionStart').value),
      bid_increment: Number($('auctionIncrement').value),
      end_time: $('auctionEnd').value ? new Date($('auctionEnd').value).toISOString() : null,
      created_by: currentUser.id,
    };
    const { error } = await sb.from('lelang_auctions').insert(payload);
    if (error) throw error;

    e.target.reset();
    showToast('Lelang berhasil dipublikasikan.');
    await loadAuctionsForAdmin();
    renderManageList();
    document.querySelector('.admin-tab[data-tab="kelola"]').click();
  } catch (err) {
    $('auctionFormError').textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ------------------------------------------------------------
// KELOLA LELANG
// ------------------------------------------------------------
async function loadAuctionsForAdmin() {
  // "winner:lelang_profiles(...)" pakai alias supaya tidak bentrok dengan
  // relasi lelang_categories pada select yang sama.
  const { data, error } = await sb
    .from('lelang_auctions')
    .select('*, lelang_categories(name), winner:lelang_profiles!lelang_auctions_winner_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (error) { showToast('Gagal memuat lelang: ' + error.message, true); return; }
  auctions = data || [];
}

function renderManageList() {
  $('manageList').innerHTML = auctions.map(a => {
    const closed = a.status !== 'active';
    const winnerLine = closed
      ? (a.winner_id
          ? `<div class="m-winner">🏆 Pemenang: ${escapeHtml(a.winner?.full_name || 'Peserta')} · ${rupiah(a.winner_amount)}</div>`
          : `<div class="m-winner m-winner-none">Tidak ada tawaran masuk — tidak ada pemenang.</div>`)
      : '';
    return `
    <div class="manage-row">
      <div>
        <div class="m-title">${escapeHtml(a.title)}</div>
        <div class="m-meta">${closed ? 'Ditutup' : 'Aktif'} · Harga saat ini: ${rupiah(a.current_price ?? a.starting_price)}${a.extended_count ? ` · diperpanjang ${a.extended_count}x` : ''}</div>
        ${winnerLine}
      </div>
      <button class="btn-close-auction" data-id="${a.id}" ${closed ? 'disabled' : ''}>
        ${closed ? 'Sudah Ditutup' : 'Tutup Lelang'}
      </button>
    </div>`;
  }).join('') || '<p>Belum ada lelang.</p>';

  document.querySelectorAll('.btn-close-auction').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Tutup lelang ini? Peserta tidak bisa bid lagi setelah ini, dan pemenang akan otomatis ditentukan dari bid tertinggi.')) return;
      b.disabled = true;
      const { error } = await sb.rpc('close_lelang_auction', { p_auction_id: b.dataset.id });
      if (error) { showToast('Gagal menutup lelang: ' + error.message, true); b.disabled = false; return; }
      showToast('Lelang ditutup, pemenang sudah ditentukan.');
      await loadAuctionsForAdmin();
      renderManageList();
    });
  });
}

// ------------------------------------------------------------
// KELOLA USER (admin & peserta) — lihat semua akun, ubah role,
// nonaktifkan/aktifkan akun. Tidak bisa menghapus akun dari sini (perlu
// service role key yang tidak boleh dipakai di client) — nonaktifkan
// dipakai sebagai gantinya, dan sudah diblok juga di server (place_lelang_bid).
// ------------------------------------------------------------
let allUsers = [];

async function loadUsers() {
  const { data, error } = await sb
    .from('lelang_profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { showToast('Gagal memuat daftar user: ' + error.message, true); return; }
  allUsers = data || [];
}

function renderUserList() {
  const q = ($('userSearch').value || '').trim().toLowerCase();
  const roleFilter = $('userRoleFilter').value;

  const filtered = allUsers.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (!q) return true;
    return [u.full_name, u.email, u.company_name, u.phone]
      .some(v => (v || '').toLowerCase().includes(q));
  });

  $('userList').innerHTML = filtered.map(u => {
    const isSelf = u.id === currentUser.id;
    const roleBadge = u.role === 'admin' ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-user">Peserta</span>';
    const statusBadge = u.is_active === false ? '<span class="badge badge-inactive">Nonaktif</span>' : '<span class="badge badge-active">Aktif</span>';
    const details = [u.email, u.company_name, u.phone].filter(Boolean).join(' · ');
    return `
    <div class="manage-row">
      <div>
        <div class="m-title">${escapeHtml(u.full_name || 'Tanpa nama')} ${roleBadge} ${statusBadge}</div>
        <div class="m-meta">${escapeHtml(details) || 'Belum melengkapi data'}</div>
      </div>
      <div class="user-row-actions">
        <button class="btn-ghost sm btn-edit-user" data-id="${u.id}">Edit</button>
        <button class="btn-ghost sm btn-toggle-role" data-id="${u.id}" data-role="${u.role}" ${isSelf ? 'disabled title="Tidak bisa mengubah role akun sendiri"' : ''}>
          ${u.role === 'admin' ? 'Jadikan Peserta' : 'Jadikan Admin'}
        </button>
        <button class="btn-ghost sm btn-toggle-active" data-id="${u.id}" data-active="${u.is_active !== false}" ${isSelf ? 'disabled title="Tidak bisa menonaktifkan akun sendiri"' : ''}>
          ${u.is_active === false ? 'Aktifkan' : 'Nonaktifkan'}
        </button>
      </div>
    </div>`;
  }).join('') || '<p>Tidak ada user yang cocok.</p>';

  document.querySelectorAll('.btn-edit-user').forEach(b => {
    b.addEventListener('click', () => openEditUserModal(b.dataset.id));
  });

  document.querySelectorAll('.btn-toggle-role').forEach(b => {
    b.addEventListener('click', async () => {
      const newRole = b.dataset.role === 'admin' ? 'user' : 'admin';
      if (!confirm(`Ubah role akun ini menjadi "${newRole === 'admin' ? 'Admin' : 'Peserta'}"?`)) return;
      const { error } = await sb.from('lelang_profiles').update({ role: newRole }).eq('id', b.dataset.id);
      if (error) { showToast('Gagal mengubah role: ' + error.message, true); return; }
      showToast('Role berhasil diubah.');
      await loadUsers();
      renderUserList();
    });
  });

  document.querySelectorAll('.btn-toggle-active').forEach(b => {
    b.addEventListener('click', async () => {
      const willActivate = b.dataset.active !== 'true';
      if (!willActivate && !confirm('Nonaktifkan akun ini? Peserta yang dinonaktifkan tidak bisa memasang bid lagi.')) return;
      const { error } = await sb.from('lelang_profiles').update({ is_active: willActivate }).eq('id', b.dataset.id);
      if (error) { showToast('Gagal mengubah status akun: ' + error.message, true); return; }
      showToast(willActivate ? 'Akun diaktifkan kembali.' : 'Akun dinonaktifkan.');
      await loadUsers();
      renderUserList();
    });
  });
}

$('userSearch').addEventListener('input', renderUserList);
$('userRoleFilter').addEventListener('change', renderUserList);

// ------------------------------------------------------------
// EDIT USER (modal) — admin mengedit data lengkap peserta/admin lain,
// termasuk ganti kata sandi mereka.
//
// Ganti kata sandi AKUN ORANG LAIN cuma bisa lewat Admin API Supabase,
// yang butuh SERVICE ROLE KEY. Key itu tidak boleh ada di kode client
// (siapa saja bisa membukanya lewat DevTools dan mengambil alih akun
// manapun), jadi aksi ini dilempar ke Edge Function "admin-reset-password"
// yang jalan di server Supabase — key-nya tersimpan di sana, bukan di
// browser. Lihat supabase/functions/admin-reset-password/index.ts &
// catatan cara deploy di README.
// ------------------------------------------------------------
let editingUserId = null;

function openEditUserModal(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  editingUserId = id;
  const isSelf = u.id === currentUser.id;

  $('euFullName').value = u.full_name || '';
  $('euEmail').textContent = u.email || '(tidak diketahui)';
  $('euCompany').value = u.company_name || '';
  $('euPhone').value = u.phone || '';
  $('euAddress').value = u.address || '';
  $('euBusinessType').value = u.business_type || '';
  $('euRole').value = u.role;
  $('euRole').disabled = isSelf;
  $('euActive').value = u.is_active === false ? 'inactive' : 'active';
  $('euActive').disabled = isSelf;
  $('euSelfHint').classList.toggle('hidden', !isSelf);
  $('euNewPassword').value = '';
  $('euNewPasswordConfirm').value = '';
  $('editUserError').textContent = '';

  $('editUserModal').classList.remove('hidden');
}

function closeEditUserModal() {
  $('editUserModal').classList.add('hidden');
  editingUserId = null;
}

$('closeEditUserModal').addEventListener('click', closeEditUserModal);
$('editUserModal').addEventListener('click', (e) => { if (e.target.id === 'editUserModal') closeEditUserModal(); });

$('editUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('editUserError').textContent = '';
  if (!editingUserId) return;

  const newPassword = $('euNewPassword').value;
  const confirmPassword = $('euNewPasswordConfirm').value;
  if (newPassword && newPassword !== confirmPassword) {
    $('editUserError').textContent = 'Konfirmasi kata sandi baru tidak cocok.';
    return;
  }
  if (newPassword && newPassword.length < 6) {
    $('editUserError').textContent = 'Kata sandi baru minimal 6 karakter.';
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const updates = {
      full_name: $('euFullName').value.trim(),
      company_name: $('euCompany').value.trim(),
      phone: $('euPhone').value.trim(),
      address: $('euAddress').value.trim(),
      business_type: $('euBusinessType').value.trim(),
    };
    if (!$('euRole').disabled) updates.role = $('euRole').value;
    if (!$('euActive').disabled) updates.is_active = $('euActive').value === 'active';

    const { error: profileErr } = await sb.from('lelang_profiles').update(updates).eq('id', editingUserId);
    if (profileErr) throw profileErr;

    if (newPassword) {
      const { data: fnData, error: fnErr } = await sb.functions.invoke('admin-reset-password', {
        body: { user_id: editingUserId, new_password: newPassword },
      });
      if (fnErr) throw fnErr;
      if (fnData && fnData.ok === false) throw new Error(fnData.error || 'Gagal mengganti kata sandi.');
    }

    showToast(newPassword ? 'Data user & kata sandi berhasil diperbarui.' : 'Data user berhasil diperbarui.');
    closeEditUserModal();
    await loadUsers();
    renderUserList();
  } catch (err) {
    $('editUserError').textContent = err.message ||
      'Gagal menyimpan. Kalau ini soal kata sandi, pastikan Edge Function "admin-reset-password" sudah di-deploy (lihat README).';
  } finally {
    submitBtn.disabled = false;
  }
});

// ------------------------------------------------------------
// KELOLA AKUN (admin) — edit nama sendiri & ganti kata sandi.
// ------------------------------------------------------------
function fillAdminAccountForm() {
  $('acFullName').value = currentProfile?.full_name || '';
  $('acEmail').textContent = currentUser?.email || '';
  $('acNewPassword').value = '';
  $('acNewPasswordConfirm').value = '';
  $('adminAccountError').textContent = '';
}

$('adminAccountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('adminAccountError').textContent = '';
  const newPassword = $('acNewPassword').value;
  const confirmPassword = $('acNewPasswordConfirm').value;
  if (newPassword && newPassword !== confirmPassword) {
    $('adminAccountError').textContent = 'Konfirmasi kata sandi baru tidak cocok.';
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const { error: profileErr } = await sb.from('lelang_profiles')
      .update({ full_name: $('acFullName').value.trim() })
      .eq('id', currentUser.id);
    if (profileErr) throw profileErr;
    currentProfile.full_name = $('acFullName').value.trim();
    $('userBadge').textContent = `${currentProfile.full_name || 'Pengguna'} · Admin`;

    if (newPassword) {
      const { error: pwErr } = await sb.auth.updateUser({ password: newPassword });
      if (pwErr) throw pwErr;
    }

    $('acNewPassword').value = '';
    $('acNewPasswordConfirm').value = '';
    showToast('Akun berhasil diperbarui.');
  } catch (err) {
    $('adminAccountError').textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
