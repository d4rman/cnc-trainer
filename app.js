const VERSION = '0.1';
document.getElementById('ver').textContent = VERSION;

// Переключение вкладок
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Значок "в сети / офлайн"
const net = document.getElementById('net');
function showNet() {
  net.textContent = navigator.onLine ? 'в сети' : 'офлайн';
  net.className = 'badge ' + (navigator.onLine ? 'on' : 'off');
}
addEventListener('online', showNet);
addEventListener('offline', showNet);
showNet();

// Офлайн-работа
const ready = document.getElementById('offline-ready');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { ready.textContent = 'Офлайн: готово, можно включать авиарежим'; })
    .catch(err => { ready.textContent = 'Офлайн: ошибка (' + err.message + ')'; });
} else {
  ready.textContent = 'Офлайн: этот браузер не поддерживает';
}
