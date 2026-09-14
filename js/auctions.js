// ------------------------------------------------------------
// STATE khusus halaman publik (index.html)
// ------------------------------------------------------------
let activeAuctionChannel = null;
let currentModalAuctionId = null;
let activeCategoryId = '';
let searchQuery = '';
let sortMode = 'newest';

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
  const prevExtended = new Map(auctions.map(a => [a.id, a.extended_count || 0]));

  const { data, error } = await sb
    .from('lelang_auctions')
    .select('*, lelang_categories(name)')
    .order('created_at', { ascending: false });
  if (error) { showToast('Gagal memuat lelang: ' + error.message, true); return; }
  auctions = data || [];
  $('statTotal').textContent = auctions.length;
  $('statActive').textContent = auctions.filter(a => !isClosed(a)).length;
  await renderAuctionGrid();

  // Anti-sniping: kalau lot yang sedang dibuka di modal baru saja
  // diperpanjang waktunya (ada bid di menit-menit terakhir), beri tahu.
  if (currentModalAuctionId) {
    const a = auctions.find(x => x.id === currentModalAuctionId);
    if (a && (a.extended_count || 0) > (prevExtended.get(a.id) || 0)) {
      showToast('⏳ Ada tawaran baru mendekati waktu akhir — lelang ini diperpanjang 2 menit.');
    }
  }
}

// Panggil fungsi server untuk menutup semua lelang yang waktunya sudah
// lewat (menentukan pemenang + kirim notifikasi). Dipanggil berkala dari
// app.js oleh siapa pun yang sedang membuka halaman — bukan hanya admin —
// supaya lelang tetap tertutup tepat waktu walau tidak ada yang klik "Tutup".
async function closeExpiredAuctions() {
  await sb.rpc('close_expired_lelang_auctions');
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

// Rank pengguna saat ini di sebuah lelang. Dihitung lewat fungsi database
// (bukan query lelang_bids langsung), karena RLS sekarang membatasi peserta
// hanya boleh melihat bid miliknya sendiri — bukan milik peserta lain.
async function getMyRank(auctionId) {
  if (!currentUser) return null;
  const { data, error } = await sb.rpc('get_my_lelang_rank', { p_auction_id: auctionId });
  if (error) return null;
  return data ?? null;
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
        if (currentModalAuctionId === auctionId) await updateModalDynamic(auctionId);
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

// Bangun HTML peringkat penawar. Admin lihat top 5 lengkap (nama & jumlah
// semua orang). Peserta biasa hanya lihat baris dirinya sendiri, plus info
// berapa total peserta lain yang ikut bid — tanpa nama/jumlah bid mereka.
async function buildLeaderboardHtml(auctionId, isAdmin) {
  if (isAdmin) {
    const { data: bidsData } = await sb
      .from('lelang_bids')
      .select('user_id, amount, lelang_profiles(full_name)')
      .eq('auction_id', auctionId)
      .order('amount', { ascending: false });

    const seen = new Set();
    const ranking = [];
    for (const b of (bidsData || [])) {
      if (!seen.has(b.user_id)) { seen.add(b.user_id); ranking.push(b); }
    }
    const top5 = ranking.slice(0, 5);

    return `
    <ul class="leaderboard">
      ${top5.length ? top5.map((b, i) => `
        <li class="${currentUser && b.user_id === currentUser.id ? 'me' : ''}">
          <span class="rank-badge">${i + 1}</span>
          <span>${currentUser && b.user_id === currentUser.id ? 'Anda' : escapeHtml(b.lelang_profiles?.full_name || 'Peserta')}</span>
          <span class="l-amount">${rupiah(b.amount)}</span>
        </li>`).join('') : '<li>Belum ada tawaran. Jadilah yang pertama!</li>'}
    </ul>`;
  }

  const { data: count } = await sb.rpc('count_lelang_bidders', { p_auction_id: auctionId });

  if (!currentUser) {
    return `<p class="leaderboard-hint">${count ? `${count} peserta sedang mengikuti lelang ini.` : 'Belum ada tawaran. Jadilah yang pertama!'}</p>`;
  }

  const myRank = await getMyRank(auctionId);
  const otherCount = Math.max(0, (count || 0) - (myRank ? 1 : 0));

  if (!myRank) {
    return `<p class="leaderboard-hint">${count ? `${count} peserta lain sedang mengikuti lelang ini. Posisi Anda akan muncul di sini setelah memasang tawaran pertama.` : 'Belum ada tawaran. Jadilah yang pertama!'}</p>`;
  }

  // Amount bid TERTINGGI milik user sendiri saja — RLS mengizinkan ini
  // (auth.uid() = user_id), berbeda dari melihat bid milik orang lain.
  const { data: myBid } = await sb
    .from('lelang_bids')
    .select('amount')
    .eq('auction_id', auctionId)
    .eq('user_id', currentUser.id)
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  return `
  <ul class="leaderboard">
    <li class="me">
      <span class="rank-badge">${myRank}</span>
      <span>Anda</span>
      <span class="l-amount">${rupiah(myBid?.amount ?? 0)}</span>
    </li>
  </ul>
  <p class="leaderboard-hint">${otherCount > 0 ? `+${otherCount} peserta lain ikut bid pada lot ini. Bid dan nama mereka bersifat rahasia.` : ''}</p>`;
}

async function renderModal(auctionId) {
  const a = auctions.find(x => x.id === auctionId);
  if (!a) return;

  // Privasi: peserta biasa cuma boleh lihat posisi & bid MEREKA SENDIRI,
  // bukan milik peserta lain (dibatasi juga di level database lewat RLS,
  // ini bukan sekadar disembunyikan di tampilan). Admin tetap lihat semua
  // baris untuk keperluan kelola lelang.
  const isAdmin = currentProfile?.role === 'admin';
  const leaderboardHtml = await buildLeaderboardHtml(auctionId, isAdmin);

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
      <p class="bid-hint" id="bidMinHint">Bid minimal saat ini: ${rupiah(minNext)}</p>
      <p id="bidModalError" class="form-error"></p>`;
  }

  $('modalContent').innerHTML = `
    ${gallery}
    <span class="modal-cat">${escapeHtml(a.lelang_categories?.name || 'Tanpa kategori')}</span>
    <h2>${escapeHtml(a.title)}</h2>
    ${a.description ? `<p class="modal-desc">${escapeHtml(a.description)}</p>` : ''}
    <div class="modal-price-block" id="modalPriceBlock">
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
    <div id="modalLeaderboardWrap">${leaderboardHtml}</div>
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

// Perbarui bagian yang memang berubah saat ada bid baru masuk (harga
// tertinggi & peringkat), TANPA membongkar ulang form bid — supaya nominal
// yang sedang diketik user tidak ketimpa/ke-reset oleh render ulang.
async function updateModalDynamic(auctionId) {
  const a = auctions.find(x => x.id === auctionId);
  if (!a) return;

  // Kalau lelang baru saja ditutup sejak modal dibuka, area bid perlu
  // diganti jadi pesan "lelang ditutup" — di sini render ulang penuh
  // memang tepat karena form memang harus hilang.
  if (isClosed(a) && $('bidForm')) {
    await renderModal(auctionId);
    return;
  }

  const priceBlock = $('modalPriceBlock');
  if (priceBlock) {
    priceBlock.innerHTML = `
      <div>
        <div class="lot-price-label">${a.current_price ? 'Tawaran tertinggi saat ini' : 'Harga awal'}</div>
        <div class="modal-price">${rupiah(a.current_price ?? a.starting_price)}</div>
      </div>
      <div style="text-align:right">
        <div class="lot-price-label">Kelipatan bid</div>
        <div>${rupiah(a.bid_increment)}</div>
      </div>`;
  }

  const isAdmin = currentProfile?.role === 'admin';
  const leaderboardWrap = $('modalLeaderboardWrap');
  if (leaderboardWrap) leaderboardWrap.innerHTML = await buildLeaderboardHtml(auctionId, isAdmin);

  // Naikkan minimum bid berikutnya. Nilai yang sedang diketik user cuma
  // ikut disesuaikan kalau dia belum sempat mengubahnya dari default lama
  // (jadi tidak menimpa nominal yang sedang aktif diketik).
  const bidAmountInput = $('bidAmount');
  if (bidAmountInput) {
    const minNext = a.current_price ? a.current_price + a.bid_increment : a.starting_price;
    const prevMin = Number(bidAmountInput.min);
    if (Number(bidAmountInput.value) === prevMin) bidAmountInput.value = minNext;
    bidAmountInput.min = minNext;
    const hint = $('bidMinHint');
    if (hint) hint.textContent = `Bid minimal saat ini: ${rupiah(minNext)}`;
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
