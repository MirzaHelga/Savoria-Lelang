// ------------------------------------------------------------
// KATEGORI (index.html) — muat data & tampilkan sebagai filter pill.
// Manajemen kategori (tambah/hapus) ada di html/dashboard.js, admin-only.
// ------------------------------------------------------------
async function loadCategories() {
  const { data, error } = await sb.from('lelang_categories').select('*').order('name');
  if (error) { showToast('Gagal memuat kategori: ' + error.message, true); return; }
  categories = data || [];
  if ($('statCategories')) $('statCategories').textContent = categories.length;
}

function renderCategoryPills() {
  const wrap = $('categoryPills');
  if (!wrap) return;
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
