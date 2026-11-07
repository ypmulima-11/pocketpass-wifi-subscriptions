const $ = selector => document.querySelector(selector);
const pageViews = ['login-view', 'plans-view', 'waiting', 'success', 'account-view'];
let selectedPlan = null;
let paymentId = null;
let pollTimer = null;
let authMode = 'login';

function toast(message) {
  const box = $('#toast');
  box.textContent = message;
  box.classList.add('show');
  window.setTimeout(() => box.classList.remove('show'), 3200);
}

function show(view) {
  pageViews.forEach(id => $(`#${id}`).classList.toggle('hidden', id !== view));
}

function setTab(tab) {
  document.querySelectorAll('.tab').forEach(button => {
    const active = button.dataset.view === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  show(tab === 'login' ? 'login-view' : 'plans-view');
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function durationLabel(seconds) {
  if (seconds < 86400) return `${seconds / 3600} hours`;
  const days = seconds / 86400;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function quotaLabel(bytes) {
  if (!bytes) return 'No data cap shown';
  const gb = bytes / 1073741824;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB included` : `${Math.round(bytes / 1048576)} MB included`;
}

function openCheckout() {
  if (!selectedPlan) return;
  $('#plan-list').classList.add('hidden');
  $('#payment-form').classList.remove('hidden');
  $('#selected-plan').textContent = `${selectedPlan.name} · ${Number(selectedPlan.price_tzs).toLocaleString()} TZS`;
}

async function loadPlans() {
  try {
    const plans = await api('/v1/plans');
    if (!plans.length) {
      $('#plan-list').innerHTML = '<p class="loading">There are no passes available right now.</p>';
      return;
    }
    $('#plan-list').replaceChildren(...plans.map(plan => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'plan-card';
      button.setAttribute('aria-label', `${plan.name}, ${Number(plan.price_tzs).toLocaleString()} Tanzanian shillings`);
      const radio = document.createElement('span');
      radio.className = 'radio';
      const details = document.createElement('span');
      details.className = 'plan-meta';
      const title = document.createElement('strong');
      title.textContent = plan.name;
      const terms = document.createElement('small');
      terms.textContent = `${durationLabel(plan.duration_seconds)} · ${quotaLabel(plan.quota_bytes)}`;
      details.append(title, terms);
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = `${Number(plan.price_tzs).toLocaleString()} TZS`;
      button.append(radio, details, price);
      button.addEventListener('click', () => {
        selectedPlan = plan;
        document.querySelectorAll('.plan-card').forEach(card => card.classList.remove('selected-card'));
        button.classList.add('selected-card');
        openCheckout();
      });
      return button;
    }));
  } catch {
    $('#plan-list').innerHTML = '<p class="loading">Passes are temporarily unavailable. Please try again.</p>';
  }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => setTab(button.dataset.view)));
document.querySelector('[data-goto="plans"]').addEventListener('click', () => setTab('plans'));

$('#auth-switch').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  $('#auth-submit').innerHTML = `${authMode === 'signup' ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
  $('#auth-switch-label').textContent = authMode === 'signup' ? 'Already registered?' : 'New to PocketPass?';
  $('#auth-switch').textContent = authMode === 'signup' ? 'Sign in' : 'Create an account';
  $('#login-form input[name="password"]').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
});

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api(`/v1/auth/${authMode}`, {
      method: 'POST',
      body: JSON.stringify({ phone: form.get('phone'), password: form.get('password') })
    });
    if (authMode === 'signup') {
      toast('Account created. Choose a pass to continue.');
      setTab('plans');
      if (selectedPlan) openCheckout();
      return;
    }
    const me = await api('/v1/me');
    if (me.subscription) {
      $('#account-info').textContent = `${me.subscription.plan} is active until ${new Date(me.subscription.expiresAt).toLocaleString()}.`;
      show('account-view');
    } else if (selectedPlan) {
      setTab('plans');
      openCheckout();
    } else {
      toast('There is no active pass on this account. Choose one to continue.');
      setTab('plans');
    }
  } catch (error) {
    toast(error.message);
  }
});

$('#payment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/v1/payments', {
      method: 'POST',
      body: JSON.stringify({ planId: selectedPlan.id, phone: form.get('phone'), provider: form.get('provider') })
    });
    paymentId = result.paymentId;
    $('#payment-status').textContent = result.message;
    show('waiting');
    $('#demo-confirm').classList.toggle('hidden', !['localhost', '127.0.0.1'].includes(location.hostname));
    pollTimer = window.setInterval(checkPayment, 2500);
  } catch (error) {
    if (error.status === 401) {
      toast('Sign in or create an account before buying a pass.');
      setTab('login');
      return;
    }
    toast(error.message);
  }
});

async function checkPayment() {
  if (!paymentId) return;
  try {
    const payment = await api(`/v1/payments/${paymentId}`);
    if (payment.status === 'paid') {
      window.clearInterval(pollTimer);
      show('success');
    } else if (['failed', 'expired'].includes(payment.status)) {
      window.clearInterval(pollTimer);
      $('#payment-status').textContent = 'Payment was not completed. You can go back and try again.';
    }
  } catch { /* A brief network interruption should not discard payment polling. */ }
}

$('#demo-confirm').addEventListener('click', async () => {
  try {
    await api(`/dev/confirm-payment/${paymentId}`, { method: 'POST' });
    await checkPayment();
  } catch (error) { toast(error.message); }
});

$('#back-plans').addEventListener('click', () => {
  $('#payment-form').classList.add('hidden');
  $('#plan-list').classList.remove('hidden');
});
$('#cancel-wait').addEventListener('click', () => {
  window.clearInterval(pollTimer);
  setTab('plans');
});
$('#account-connect').addEventListener('click', () => toast('If the Wi-Fi has not opened, reconnect to the network or ask the provider for help.'));
$('#done').addEventListener('click', () => toast('You can close this sign-in window.'));
$('#logout').addEventListener('click', async () => {
  try { await api('/v1/auth/logout', { method: 'POST' }); show('login-view'); }
  catch (error) { toast(error.message); }
});

loadPlans();
