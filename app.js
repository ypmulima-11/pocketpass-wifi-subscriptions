const dialog=document.querySelector('#auth-dialog');
const form=document.querySelector('#account-form');
const message=document.querySelector('#form-message');
const modeSwitch=document.querySelector('#switch-mode');
const selectedPlan=document.querySelector('#selected-plan');
let mode='signup';

function showAuth(nextMode='signup',plan=''){
  mode=nextMode;
  message.textContent='';
  form.reset();
  document.querySelector('#dialog-eyebrow').textContent=mode==='signup'?'YOUR OFFLINE LIBRARY STARTS HERE':'WELCOME BACK';
  document.querySelector('#dialog-title').textContent=mode==='signup'?'Create your account.':'Log in to your library.';
  document.querySelector('#dialog-copy').textContent=mode==='signup'?'Save your picks and take them with you.':'Your saved content is right where you left it.';
  document.querySelector('#submit-account').innerHTML=mode==='signup'?'Create account <span>↗</span>':'Log in <span>↗</span>';
  document.querySelector('#switch-label').textContent=mode==='signup'?'Already have an account?':'New to PocketPass?';
  modeSwitch.textContent=mode==='signup'?'Log in':'Create an account';
  document.querySelector('input[name="name"]').closest('label').hidden=mode==='login';
  document.querySelector('input[name="password"]').autocomplete=mode==='signup'?'new-password':'current-password';
  selectedPlan.hidden=!plan;
  selectedPlan.textContent=plan?`Selected: ${plan}. Payment setup follows account creation.`:'';
  dialog.showModal();
}

document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>showAuth(button.dataset.open)));
document.querySelectorAll('[data-plan]').forEach(button=>button.addEventListener('click',()=>showAuth('signup',button.dataset.plan)));
modeSwitch.addEventListener('click',()=>showAuth(mode==='signup'?'login':'signup'));
form.addEventListener('submit',event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  message.textContent=mode==='signup'?'Account details captured for this demo. A server must verify email and payment before access is activated.':'Demo login only. Connect a secure account server to verify your details.';
});
document.querySelector('.menu-toggle').addEventListener('click',()=>document.querySelector('.topbar').classList.toggle('menu-open'));
document.querySelectorAll('nav a').forEach(link=>link.addEventListener('click',()=>document.querySelector('.topbar').classList.remove('menu-open')));
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
