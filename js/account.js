// ------------------------------------------------------------
// AKUN SAYA (index.html, khusus peserta) — edit data profil sendiri
// (nama, perusahaan, telepon, alamat, jenis usaha) dan ganti kata sandi.
// Admin mengelola akunnya sendiri lewat tab "Kelola Akun" di Panel Admin
// (html/dashboard.js), bukan lewat modal ini.
// ------------------------------------------------------------
$('btnOpenAccount').addEventListener('click', () => {
  if (!currentProfile) return;
  fillAccountForm();
  $('accountModal').classList.remove('hidden');
});

$('closeAccountModal').addEventListener('click', () => $('accountModal').classList.add('hidden'));
$('accountModal').addEventListener('click', (e) => {
  if (e.target.id === 'accountModal') $('accountModal').classList.add('hidden');
});

function fillAccountForm() {
  $('accFullName').value = currentProfile.full_name || '';
  $('accEmail').textContent = currentUser?.email || '';
  $('accCompany').value = currentProfile.company_name || '';
  $('accPhone').value = currentProfile.phone || '';
  $('accAddress').value = currentProfile.address || '';
  $('accBusinessType').value = currentProfile.business_type || '';
  $('accNewPassword').value = '';
  $('accNewPasswordConfirm').value = '';
  $('accountError').textContent = '';
}

$('accountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('accountError').textContent = '';
  const newPassword = $('accNewPassword').value;
  const confirmPassword = $('accNewPasswordConfirm').value;
  if (newPassword && newPassword !== confirmPassword) {
    $('accountError').textContent = 'Konfirmasi kata sandi baru tidak cocok.';
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const updates = {
      full_name: $('accFullName').value.trim(),
      company_name: $('accCompany').value.trim(),
      phone: $('accPhone').value.trim(),
      address: $('accAddress').value.trim(),
      business_type: $('accBusinessType').value.trim(),
    };
    const { error: profileErr } = await sb.from('lelang_profiles').update(updates).eq('id', currentUser.id);
    if (profileErr) throw profileErr;
    Object.assign(currentProfile, updates);
    $('userBadge').textContent = `${currentProfile.full_name || 'Pengguna'} · Peserta`;

    if (newPassword) {
      const { error: pwErr } = await sb.auth.updateUser({ password: newPassword });
      if (pwErr) throw pwErr;
    }

    $('accNewPassword').value = '';
    $('accNewPasswordConfirm').value = '';
    showToast('Akun berhasil diperbarui.');
    $('accountModal').classList.add('hidden');
  } catch (err) {
    $('accountError').textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
