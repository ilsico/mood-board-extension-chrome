if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
window.addEventListener('load', function () {
  document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function () {});
});
