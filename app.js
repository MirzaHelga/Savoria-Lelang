// ============================================================
// KONFIGURASI SUPABASE — ganti dengan nilai proyekmu sendiri
// (Supabase Dashboard > Project Settings > API)
// ============================================================
const SUPABASE_URL = 'https://pcnrkvxaujutsfytbtrf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbnJrdnhhdWp1dHNmeXRidHJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNjg2MjAsImV4cCI6MjA5OTc0NDYyMH0.xiGmUxRph5qVTjJxRRpGXbJte36XMh2NMgP-qJgBPy8 ';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// STATE
// ------------------------------------------------------------
let currentUser = null;    // auth user (null = guest, browsing is still allowed)
let currentProfile = null; // { id, full_name, role }
let pendingEmail = null;   // email menunggu verifikasi OTP
let categories = [];
let auctions = [];
let activeAuctionChannel = null;
let currentModalAuctionId = null;
let activeCategoryId = '';
let searchQuery = '';
let sortMode = 'newest';

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function fmtDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function isClosed(a) {
  return a.status !== 'active' || (a.end_time && new Date(a.end_time) < new Date());
}

// Daftar foto sebuah lot, dengan fallback ke kolom lama photo_url
function getPhotos(a) {
  if (Array.isArray(a.photo_urls) && a.photo_urls.length) return a.photo_urls;
  return a.photo_url ? [a.photo_url] : [];
}

function countdownText(endIso) {
  if (!endIso) return null;
  const diff = new Date(endIso).getTime() - Date.now();
  if (diff <= 0) return 'Sudah berakhir';
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}h ${h}j lagi`;
  if (h > 0) return `${h}j ${m}m lagi`;
  if (m > 0) return `${m}m ${sec}d lagi`;
  return `${sec}d lagi`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

// ------------------------------------------------------------
// BOOT: muat data publik dulu, tidak menunggu login
// ------------------------------------------------------------
(async function boot() {
  await loadCategories();
  await loadAuctions();
  subscribeRealtimeAuctions();
  setInterval(tickCountdowns, 1000);
})();

// ------------------------------------------------------------
// AUTH — semua lewat modal, tidak lagi menghalangi halaman utama
// ------------------------------------------------------------
$('btnOpenLogin').addEventListener('click', () => openAuthModal('login'));
$('btnOpenRegister').addEventListener('click', () => openAuthModal('register'));
$('closeAuthModal').addEventListener('click', closeAuthModal);
$('authModal').addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuthModal(); });
$('tabLogin').addEventListener('click', () => switchAuthTab('login'));
$('tabRegister').addEventListener('click', () => switchAuthTab('register'));

function openAuthModal(which) {
  switchAuthTab(which);
  $('authModal').classList.remove('hidden');
}
function closeAuthModal() { $('authModal').classList.add('hidden'); }

function switchAuthTab(which) {
  $('tabLogin').classList.toggle('active', which === 'login');
  $('tabRegister').classList.toggle('active', which === 'register');
  document.querySelector('#authModal .tabs').classList.toggle('hidden', which === 'verify');
  $('loginForm').classList.toggle('hidden', which !== 'login');
  $('registerForm').classList.toggle('hidden', which !== 'register');
  $('verifyForm').classList.toggle('hidden', which !== 'verify');
  $('authTitle').textContent = which === 'register' ? 'Daftar akun baru' : 'Masuk ke Savoria Lelang';
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { $('loginError').textContent = error.message; return; }
  closeAuthModal();
});

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('registerError').textContent = '';
  const full_name = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const password = $('regPassword').value;
  const { error } = await sb.auth.signUp({
    email, password, options: { data: { full_name } }
  });
  if (error) { $('registerError').textContent = error.message; return; }

  pendingEmail = email;
  $('verifyEmailLabel').textContent = `Kami mengirim kode 6 digit ke ${email}. Masukkan kodenya di bawah ini.`;
  $('verifyError').textContent = '';
  $('verifyCode').value = '';
  switchAuthTab('verify');
});

$('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('verifyError').textContent = '';
  const code = $('verifyCode').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token: code, type: 'signup' });
  submitBtn.disabled = false;
  if (error) { $('verifyError').textContent = error.message; return; }
  pendingEmail = null;
  closeAuthModal();
});

$('btnResendCode').addEventListener('click', async () => {
  if (!pendingEmail) return;
  const { error } = await sb.auth.resend({ type: 'signup', email: pendingEmail });
  if (error) { $('verifyError').textContent = error.message; return; }
  showToast('Kode baru sudah dikirim.');
});

$('btnBackToRegister').addEventListener('click', () => {
  pendingEmail = null;
  switchAuthTab('register');
});

$('btnLogout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session ? session.user : null;
  if (currentUser) {
    const { data: profile, error } = await sb.from('lelang_profiles').select('*').eq('id', currentUser.id).single();
    if (error) { showToast('Gagal memuat profil: ' + error.message, true); return; }
    currentProfile = profile;
    $('guestActions').classList.add('hidden');
    $('userActions').classList.remove('hidden');
    $('userBadge').textContent = `${profile.full_name || 'Pengguna'} · ${profile.role === 'admin' ? 'Admin' : 'Peserta'}`;
    $('navAdmin').classList.toggle('hidden', profile.role !== 'admin');
  } else {
    currentProfile = null;
    $('guestActions').classList.remove('hidden');
    $('userActions').classList.add('hidden');
    $('navAdmin').classList.add('hidden');
    showHomeView();
  }
  await renderAuctionGrid();
});

// ------------------------------------------------------------
// NAV: beranda publik <-> panel admin
// ------------------------------------------------------------
$('navAdmin').addEventListener('click', showAdminView);
$('btnBackToHome').addEventListener('click', showHomeView);

function showAdminView() {
  $('viewHome').classList.add('hidden');
  $('viewAdmin').classList.remove('hidden');
  renderManageList();
}
function showHomeView() {
  $('viewAdmin').classList.add('hidden');
  $('viewHome').classList.remove('hidden');
}

document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('admin' + capitalize(btn.dataset.tab)).classList.add('active');
  });
});
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ------------------------------------------------------------
// KATEGORI
// ------------------------------------------------------------
async function loadCategories() {
  const { data, error } = await sb.from('lelang_categories').select('*').order('name');
  if (error) { showToast('Gagal memuat kategori: ' + error.message, true); return; }
  categories = data || [];
  renderCategorySelects();
  renderCategoryPills();
  renderCategoryList();
  $('statCategories').textContent = categories.length;
}

function renderCategorySelects() {
  const formSel = $('auctionCategory');
  if (formSel) formSel.innerHTML = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderCategoryPills() {
  const wrap = $('categoryPills');
  wrap.innerHTML = categories.map(c =>
    `<button class="cat-pill" data-id="${c.id}">${escapeHtml(c.name)}</button>`
  ).join('');

  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategoryId = btn.dataset.id || '';
      document.querySelectorAll('.cat-pill').forEach(b => b.classList.toggle('active', b === btn));
      renderAuctionGrid();
      $('lelangSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
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
});

// ------------------------------------------------------------
// PENCARIAN & URUTAN
// ------------------------------------------------------------
function handleSearch(value) {
  searchQuery = value.trim().toLowerCase();
  $('headerSearch').value = value;
  $('heroSearch').value = value;
  renderAuctionGrid();
  $('lelangSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('headerSearch').addEventListener('input', () => { searchQuery = $('headerSearch').value.trim().toLowerCase(); $('heroSearch').value = $('headerSearch').value; renderAuctionGrid(); });
$('heroSearch').addEventListener('input', () => { searchQuery = $('heroSearch').value.trim().toLowerCase(); $('headerSearch').value = $('heroSearch').value; renderAuctionGrid(); });
$('heroSearchBtn').addEventListener('click', () => handleSearch($('heroSearch').value));
$('sortOrder').addEventListener('change', () => { sortMode = $('sortOrder').value; renderAuctionGrid(); });

// ------------------------------------------------------------
// LELANG: MUAT & TAMPILKAN
// ------------------------------------------------------------
async function loadAuctions() {
  const { data, error } = await sb
    .from('lelang_auctions')
    .select('*, lelang_categories(name)')
    .order('created_at', { ascending: false });
  if (error) { showToast('Gagal memuat lelang: ' + error.message, true); return; }
  auctions = data || [];
  $('statTotal').textContent = auctions.length;
  $('statActive').textContent = auctions.filter(a => !isClosed(a)).length;
  await renderAuctionGrid();
}

function sortAuctions(list) {
  const sorted = [...list];
  if (sortMode === 'ending') {
    sorted.sort((a, b) => {
      if (!a.end_time) return 1;
      if (!b.end_time) return -1;
      return new Date(a.end_time) - new Date(b.end_time);
    });
  } else if (sortMode === 'price-low') {
    sorted.sort((a, b) => (a.current_price ?? a.starting_price) - (b.current_price ?? b.starting_price));
  } else if (sortMode === 'price-high') {
    sorted.sort((a, b) => (b.current_price ?? b.starting_price) - (a.current_price ?? a.starting_price));
  }
  // 'newest' keeps the created_at desc order already returned by the query
  return sorted;
}

async function renderAuctionGrid() {
  let list = auctions.filter(a => !activeCategoryId || a.category_id === activeCategoryId);
  if (searchQuery) {
    list = list.filter(a =>
      a.title.toLowerCase().includes(searchQuery) ||
      (a.description || '').toLowerCase().includes(searchQuery)
    );
  }
  list = sortAuctions(list);

  $('emptyState').classList.toggle('hidden', list.length > 0);
  const grid = $('auctionGrid');

  const cards = await Promise.all(list.map(async (a, i) => {
    const rank = await getMyRank(a.id);
    return renderLotCard(a, i, rank);
  }));
  grid.innerHTML = cards.join('');

  document.querySelectorAll('.btn-bid').forEach(b => {
    b.addEventListener('click', () => openBidModal(b.dataset.id));
  });
  tickCountdowns();
}

function statusBadge(a) {
  if (isClosed(a)) return '<span class="status-badge status-closed">SELESAI</span>';
  if (a.end_time) {
    const hoursLeft = (new Date(a.end_time) - Date.now()) / 3600000;
    if (hoursLeft <= 3) return '<span class="status-badge status-soon">SEGERA BERAKHIR</span>';
  }
  return '<span class="status-badge status-active">AKTIF</span>';
}

function renderLotCard(a, index, rank) {
  const photos = getPhotos(a);
  const photo = photos.length
    ? `<div class="lot-photo-wrap"><img class="lot-photo" src="${photos[0]}" alt="${escapeHtml(a.title)}">${photos.length > 1 ? `<span class="lot-photo-count">+${photos.length - 1} foto</span>` : ''}</div>`
    : `<div class="lot-photo-placeholder">Tanpa foto</div>`;
  const price = a.current_price ?? a.starting_price;
  const priceLabel = a.current_price ? 'Tawaran tertinggi' : 'Harga awal';
  const closed = isClosed(a);
  const rankPill = rank
    ? `<span class="rank-pill ${rank <= 3 ? 'rank-' + rank : 'rank-out'}">${rank === 1 ? 'Posisi #1 · Memimpin' : 'Posisi #' + rank}</span>`
    : '';

  return `
  <div class="lot-card">
    <div class="lot-stub">
      <span class="lot-num">LOT ${String(index + 1).padStart(3, '0')}</span>
      ${statusBadge(a)}
    </div>
    ${photo}
    <div class="lot-body">
      <span class="lot-cat">${escapeHtml(a.lelang_categories?.name || 'Tanpa kategori')}</span>
      <h3 class="lot-title">${escapeHtml(a.title)}</h3>
      <span class="lot-countdown" data-end="${a.end_time || ''}">${a.end_time ? `<strong>${countdownText(a.end_time)}</strong>` : 'Tanpa batas waktu'}</span>
      ${rankPill}
      <div class="lot-price-row">
        <span class="lot-price-label">${priceLabel}</span>
        <span class="lot-price">${rupiah(price)}</span>
      </div>
      <div class="lot-meta"><span>Kelipatan bid</span><span>${rupiah(a.bid_increment)}</span></div>
      ${closed
        ? `<span class="status-closed-text">Lelang ditutup</span>`
        : `<button class="btn-bid" data-id="${a.id}">Lihat &amp; Bid</button>`}
    </div>
  </div>`;
}

// Perbarui teks hitung mundur setiap detik tanpa menggambar ulang seluruh grid
function tickCountdowns() {
  document.querySelectorAll('.lot-countdown[data-end]').forEach(el => {
    const end = el.dataset.end;
    if (!end) return;
    el.innerHTML = `<strong>${countdownText(end)}</strong>`;
  });
}

// Rank pengguna saat ini di sebuah lelang, berdasarkan bid tertinggi tiap orang
async function getMyRank(auctionId) {
  if (!currentUser) return null;
  const { data, error } = await sb
    .from('lelang_bids')
    .select('user_id, amount')
    .eq('auction_id', auctionId)
    .order('amount', { ascending: false });
  if (error || !data) return null;

  const seen = new Set();
  const ranking = [];
  for (const b of data) {
    if (!seen.has(b.user_id)) { seen.add(b.user_id); ranking.push(b); }
  }
  const idx = ranking.findIndex(b => b.user_id === currentUser.id);
  return idx === -1 ? null : idx + 1;
}

// ------------------------------------------------------------
// MODAL BID
// ------------------------------------------------------------
$('closeModal').addEventListener('click', closeBidModal);
$('bidModal').addEventListener('click', (e) => { if (e.target.id === 'bidModal') closeBidModal(); });

function closeBidModal() {
  $('bidModal').classList.add('hidden');
  if (activeAuctionChannel) { sb.removeChannel(activeAuctionChannel); activeAuctionChannel = null; }
  currentModalAuctionId = null;
}

async function openBidModal(auctionId) {
  currentModalAuctionId = auctionId;
  await renderModal(auctionId);
  $('bidModal').classList.remove('hidden');

  if (activeAuctionChannel) sb.removeChannel(activeAuctionChannel);
  activeAuctionChannel = sb
    .channel('bids-' + auctionId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lelang_bids', filter: `auction_id=eq.${auctionId}` },
      async () => {
        await refreshAuction(auctionId);
        if (currentModalAuctionId === auctionId) await renderModal(auctionId);
        await renderAuctionGrid();
      })
    .subscribe();
}

async function refreshAuction(auctionId) {
  const { data } = await sb.from('lelang_auctions').select('*, lelang_categories(name)').eq('id', auctionId).single();
  if (data) {
    const i = auctions.findIndex(a => a.id === auctionId);
    if (i !== -1) auctions[i] = data;
  }
}

async function renderModal(auctionId) {
  const a = auctions.find(x => x.id === auctionId);
  if (!a) return;

  const { data: bidsData } = await sb
    .from('lelang_bids')
    .select('user_id, amount, created_at, lelang_profiles(full_name)')
    .eq('auction_id', auctionId)
    .order('amount', { ascending: false });

  const seen = new Set();
  const ranking = [];
  for (const b of (bidsData || [])) {
    if (!seen.has(b.user_id)) { seen.add(b.user_id); ranking.push(b); }
  }
  const top5 = ranking.slice(0, 5);

  const minNext = a.current_price ? a.current_price + a.bid_increment : a.starting_price;
  const closed = isClosed(a);

  const photos = getPhotos(a);
  const gallery = photos.length ? `
    <div class="modal-gallery">
      <img class="modal-photo" id="modalMainPhoto" src="${photos[0]}" alt="${escapeHtml(a.title)}">
      ${photos.length > 1 ? `
        <div class="modal-thumbs">
          ${photos.map((url, i) => `<img class="modal-thumb${i === 0 ? ' active' : ''}" data-src="${url}" src="${url}" alt="Foto ${i + 1}">`).join('')}
        </div>` : ''}
    </div>` : '';

  let bidArea;
  if (closed) {
    bidArea = '<p class="status-closed-text">Lelang ini sudah ditutup.</p>';
  } else if (!currentUser) {
    bidArea = `
      <div class="login-prompt">
        <span>Masuk atau daftar akun untuk memasang tawaran pada lot ini.</span>
        <button id="modalLoginBtn" class="btn-primary sm" type="button">Masuk / Daftar</button>
      </div>`;
  } else {
    bidArea = `
      <form id="bidForm" class="bid-form">
        <input type="number" id="bidAmount" min="${minNext}" step="1" value="${minNext}" required>
        <button type="submit" class="btn-primary">Pasang Bid</button>
      </form>
      <p class="bid-hint">Bid minimal saat ini: ${rupiah(minNext)}</p>
      <p id="bidModalError" class="form-error"></p>`;
  }

  $('modalContent').innerHTML = `
    ${gallery}
    <span class="modal-cat">${escapeHtml(a.lelang_categories?.name || 'Tanpa kategori')}</span>
    <h2>${escapeHtml(a.title)}</h2>
    ${a.description ? `<p class="modal-desc">${escapeHtml(a.description)}</p>` : ''}
    <div class="modal-price-block">
      <div>
        <div class="lot-price-label">${a.current_price ? 'Tawaran tertinggi saat ini' : 'Harga awal'}</div>
        <div class="modal-price">${rupiah(a.current_price ?? a.starting_price)}</div>
      </div>
      <div style="text-align:right">
        <div class="lot-price-label">Kelipatan bid</div>
        <div>${rupiah(a.bid_increment)}</div>
      </div>
    </div>
    ${bidArea}
    <h3 style="font-size:1rem;margin-bottom:8px;">Peringkat Penawar</h3>
    <ul class="leaderboard">
      ${top5.length ? top5.map((b, i) => `
        <li class="${currentUser && b.user_id === currentUser.id ? 'me' : ''}">
          <span class="rank-badge">${i + 1}</span>
          <span>${currentUser && b.user_id === currentUser.id ? 'Anda' : escapeHtml(b.lelang_profiles?.full_name || 'Peserta')}</span>
          <span class="l-amount">${rupiah(b.amount)}</span>
        </li>`).join('') : '<li>Belum ada tawaran. Jadilah yang pertama!</li>'}
    </ul>
  `;

  document.querySelectorAll('.modal-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      $('modalMainPhoto').src = thumb.dataset.src;
      document.querySelectorAll('.modal-thumb').forEach(t => t.classList.toggle('active', t === thumb));
    });
  });

  const modalLoginBtn = $('modalLoginBtn');
  if (modalLoginBtn) modalLoginBtn.addEventListener('click', () => { closeBidModal(); openAuthModal('login'); });

  const bidForm = $('bidForm');
  if (bidForm) {
    bidForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number($('bidAmount').value);
      const submitBtn = bidForm.querySelector('button');
      submitBtn.disabled = true;
      const { error } = await sb.rpc('place_lelang_bid', { p_auction_id: auctionId, p_amount: amount });
      submitBtn.disabled = false;
      if (error) { $('bidModalError').textContent = error.message; return; }
      showToast('Bid berhasil dipasang.');
    });
  }
}

// ------------------------------------------------------------
// REALTIME: perbarui grid saat ada lelang baru / harga berubah
// ------------------------------------------------------------
function subscribeRealtimeAuctions() {
  sb.channel('auctions-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lelang_auctions' }, async () => {
      await loadAuctions();
    })
    .subscribe();
}

// ------------------------------------------------------------
// ADMIN: BUAT LELANG
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
    await loadAuctions();
    document.querySelector('.admin-tab[data-tab="kelola"]').click();
  } catch (err) {
    $('auctionFormError').textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ------------------------------------------------------------
// ADMIN: KELOLA LELANG
// ------------------------------------------------------------
function renderManageList() {
  const mine = auctions;
  $('manageList').innerHTML = mine.map(a => `
    <div class="manage-row">
      <div>
        <div class="m-title">${escapeHtml(a.title)}</div>
        <div class="m-meta">${a.status === 'active' ? 'Aktif' : 'Ditutup'} · Harga saat ini: ${rupiah(a.current_price ?? a.starting_price)}</div>
      </div>
      <button class="btn-close-auction" data-id="${a.id}" ${a.status !== 'active' ? 'disabled' : ''}>
        ${a.status === 'active' ? 'Tutup Lelang' : 'Sudah Ditutup'}
      </button>
    </div>`).join('') || '<p>Belum ada lelang.</p>';

  document.querySelectorAll('.btn-close-auction').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Tutup lelang ini? Peserta tidak bisa bid lagi setelah ini.')) return;
      const { error } = await sb.from('lelang_auctions').update({ status: 'closed' }).eq('id', b.dataset.id);
      if (error) { showToast('Gagal menutup lelang: ' + error.message, true); return; }
      await loadAuctions();
      renderManageList();
    });
  });
}
