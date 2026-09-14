// ------------------------------------------------------------
// AUTH — semua lewat modal, tidak menghalangi halaman utama
// ------------------------------------------------------------
let pendingEmail = null; // email menunggu verifikasi OTP (fitur ini tidak aktif, lihat catatan di bawah)
let onboardingRequired = false; // true = modal tidak boleh ditutup sebelum form onboarding terisi

$('btnOpenLogin').addEventListener('click', () => openAuthModal('login'));
$('btnOpenRegister').addEventListener('click', () => openAuthModal('register'));
$('closeAuthModal').addEventListener('click', attemptCloseAuthModal);
$('authModal').addEventListener('click', (e) => { if (e.target.id === 'authModal') attemptCloseAuthModal(); });
$('tabLogin').addEventListener('click', () => switchAuthTab('login'));
$('tabRegister').addEventListener('click', () => switchAuthTab('register'));

function openAuthModal(which) {
  switchAuthTab(which);
  $('authModal').classList.remove('hidden');
}

// Dipanggil dari klik user (tombol X / klik di luar kartu modal) — diblokir
// selama form onboarding wajib belum selesai diisi.
function attemptCloseAuthModal() {
  if (onboardingRequired) return;
  closeAuthModal();
}
// Force-close terprogram, dipakai setelah login/daftar/onboarding sukses.
function closeAuthModal() { $('authModal').classList.add('hidden'); }

function switchAuthTab(which) {
  $('tabLogin').classList.toggle('active', which === 'login');
  $('tabRegister').classList.toggle('active', which === 'register');
  document.querySelector('#authModal .tabs').classList.toggle('hidden', which === 'verify' || which === 'onboarding');
  $('closeAuthModal').classList.toggle('hidden', which === 'onboarding');
  $('loginForm').classList.toggle('hidden', which !== 'login');
  $('registerForm').classList.toggle('hidden', which !== 'register');
  $('verifyForm').classList.toggle('hidden', which !== 'verify');
  $('onboardingForm').classList.toggle('hidden', which !== 'onboarding');
  $('authTitle').textContent = which === 'register' ? 'Daftar akun baru'
    : which === 'onboarding' ? 'Lengkapi data akun'
    : 'Masuk ke Savoria Lelang';
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { $('loginError').textContent = error.message; return; }
  // Jangan closeAuthModal() di sini — onAuthStateChange di bawah yang
  // memutuskan: langsung tutup, atau paksa ke form onboarding dulu kalau
  // akun ini (mis. akun lama) belum pernah mengisinya.
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

  // Email confirmation is disabled (see Supabase Auth settings), so signUp()
  // already returns an active session. onAuthStateChange di bawah akan
  // mendeteksi profil baru ini belum onboarding_completed, dan otomatis
  // memaksa form "Lengkapi data akun" muncul — jadi tidak langsung tertutup.
  showToast('Pendaftaran berhasil! Satu langkah lagi ya.');
});

// --- OTP email verification (currently unused) -----------------------
// Not called anywhere right now because "Confirm email" is turned off in
// Supabase Auth settings, so signUp() logs the user in immediately.
// Kept here so it's a one-step re-enable later: turn "Confirm email" back
// on in Supabase, then restore the switchAuthTab('verify') call above.
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

// ------------------------------------------------------------
// ONBOARDING WAJIB — perusahaan, no. HP, alamat, jenis usaha. Berlaku
// untuk peserta (role 'user'), bukan admin. Muncul otomatis setelah
// daftar, dan juga tetap dipaksa muncul kalau ada akun lama yang login
// tapi belum pernah mengisinya (onboarding_completed masih false).
// ------------------------------------------------------------
$('onboardingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('onboardingError').textContent = '';
  if (!currentUser) return;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  const { error } = await sb.from('lelang_profiles').update({
    company_name: $('obCompany').value.trim(),
    phone: $('obPhone').value.trim(),
    address: $('obAddress').value.trim(),
    business_type: $('obBusinessType').value.trim(),
    onboarding_completed: true,
  }).eq('id', currentUser.id);

  submitBtn.disabled = false;
  if (error) { $('onboardingError').textContent = error.message; return; }

  if (currentProfile) currentProfile.onboarding_completed = true;
  onboardingRequired = false;
  e.target.reset();
  closeAuthModal();
  showToast('Data tersimpan. Selamat datang di Savoria Lelang!');
});

$('btnLogout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

// ------------------------------------------------------------
// Sinkronkan header (guest/user, badge, link Panel Admin) dengan sesi auth.
// ------------------------------------------------------------
sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session ? session.user : null;
  if (currentUser) {
    const { data: profile, error } = await sb.from('lelang_profiles').select('*').eq('id', currentUser.id).single();
    if (error) { showToast('Gagal memuat profil: ' + error.message, true); return; }
    if (profile.is_active === false) {
      showToast('Akun Anda telah dinonaktifkan admin. Hubungi admin untuk info lebih lanjut.', true);
      await sb.auth.signOut();
      return;
    }

    currentProfile = profile;
    $('guestActions').classList.add('hidden');
    $('userActions').classList.remove('hidden');
    $('userBadge').textContent = `${profile.full_name || 'Pengguna'} · ${profile.role === 'admin' ? 'Admin' : 'Peserta'}`;
    $('navAdmin').classList.toggle('hidden', profile.role !== 'admin');
    $('btnOpenAccount').classList.toggle('hidden', profile.role === 'admin');

    if (profile.role !== 'admin' && !profile.onboarding_completed) {
      onboardingRequired = true;
      openAuthModal('onboarding');
    } else {
      onboardingRequired = false;
      closeAuthModal();
    }
  } else {
    currentProfile = null;
    onboardingRequired = false;
    $('guestActions').classList.remove('hidden');
    $('userActions').classList.add('hidden');
    $('navAdmin').classList.add('hidden');
    $('btnOpenAccount').classList.add('hidden');
  }
  await renderAuctionGrid();
});
