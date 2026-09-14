// ------------------------------------------------------------
// STATE — dipakai bersama oleh index.html dan html/dashboard.html
// ------------------------------------------------------------
let currentUser = null;    // auth user (null = guest, browsing tetap boleh)
let currentProfile = null; // { id, full_name, role }
let categories = [];
let auctions = [];

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

function showToast(msg, isError = false) {
  const t = $('toast');
  if (!t) return;
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

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
