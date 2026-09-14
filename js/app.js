// ------------------------------------------------------------
// BOOT: muat data publik dulu, tidak menunggu login
// ------------------------------------------------------------
(async function boot() {
  await loadCategories();
  renderCategoryPills();
  await closeExpiredAuctions(); // tutup lelang yang sudah lewat waktu sebelum tampil
  await loadAuctions();
  subscribeRealtimeAuctions();
  setInterval(tickCountdowns, 1000);
  setInterval(closeExpiredAuctions, 20000); // cek berkala selama halaman terbuka
})();
