(() => {
  if (AdminAuth.isLoggedIn()) {
    window.location.href = 'index.html';
    return;
  }

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      await AdminAuth.login(document.getElementById('email').value.trim(), document.getElementById('password').value);
      window.location.href = 'index.html';
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
})();
