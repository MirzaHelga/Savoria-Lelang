// ------------------------------------------------------------
// NOTIFIKASI IN-APP — "Anda menang" / "lelang berakhir, belum menang".
// Baris notifikasi dibuat di server oleh fungsi close_lelang_auction()
// (lihat sql/schema.sql), file ini hanya menampilkan & menandai dibaca.
// Hanya aktif untuk index.html (peserta login), Panel Admin tidak perlu.
// ------------------------------------------------------------
let notifications = [];
let notifChannel = null;

async function loadNotifications() {
  if (!currentUser) { notifications = []; renderNotifBell(); return; }
  const { data, error } = await sb
    .from('lelang_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return; // diam-diam gagal, bukan fitur inti — jangan ganggu halaman utama
  notifications = data || [];
  renderNotifBell();
}

function renderNotifBell() {
  const badge = $('notifBadge');
  const bell = $('notifBell');
  if (!bell) return;
  bell.classList.toggle('hidden', !currentUser);
  const unread = notifications.filter(n => !n.is_read).length;
  if (badge) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
  }
  renderNotifList();
}

function renderNotifList() {
  const list = $('notifList');
  if (!list) return;
  list.innerHTML = notifications.length
    ? notifications.map(n => `
      <li class="notif-item ${n.is_read ? '' : 'unread'} notif-${n.type}" data-id="${n.id}">
        <span class="notif-icon">${n.type === 'win' ? '🏆' : 'ℹ️'}</span>
        <div>
          <p class="notif-msg">${escapeHtml(n.message)}</p>
          <span class="notif-time">${fmtDateTime(n.created_at)}</span>
        </div>
      </li>`).join('')
    : '<li class="notif-empty">Belum ada notifikasi.</li>';

  document.querySelectorAll('.notif-item.unread').forEach(el => {
    el.addEventListener('click', () => markNotifRead(el.dataset.id));
  });
}

async function markNotifRead(id) {
  const n = notifications.find(x => x.id === id);
  if (!n || n.is_read) return;
  n.is_read = true; // optimistic, biar badge langsung turun
  renderNotifBell();
  await sb.from('lelang_notifications').update({ is_read: true }).eq('id', id);
}

$('notifBell')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('notifDropdown').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const dd = $('notifDropdown');
  if (dd && !dd.classList.contains('hidden') && !dd.contains(e.target) && e.target.id !== 'notifBell') {
    dd.classList.add('hidden');
  }
});

// Realtime: notif baru (mis. baru saja menang) langsung muncul + toast,
// tanpa peserta harus refresh halaman.
function subscribeRealtimeNotifications() {
  if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
  if (!currentUser) return;
  notifChannel = sb
    .channel('notif-' + currentUser.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lelang_notifications', filter: `user_id=eq.${currentUser.id}` },
      (payload) => {
        notifications.unshift(payload.new);
        renderNotifBell();
        showToast(payload.new.message);
      })
    .subscribe();
}

// Ikut siklus login/logout yang sudah ada di auth.js
sb.auth.onAuthStateChange(async () => {
  await loadNotifications();
  subscribeRealtimeNotifications();
});
