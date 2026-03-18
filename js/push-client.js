// push-client.js
// Handles service worker registration and push notification diagnostics for Epicare
// This file does NOT handle subscription logic (done by backend), but ensures SW is registered and permission is checked.

(function() {
  // Check for service worker and push support
  if (!('serviceWorker' in navigator)) {
    console.warn('[PushClient] Service workers are not supported in this browser.');
    return;
  }
  if (!('PushManager' in window)) {
    console.warn('[PushClient] Push notifications are not supported in this browser.');
    return;
  }

  // Register the service worker
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js')
      .then(function(reg) {
        console.log('[PushClient] Service worker registered:', reg);
        // Check notification permission
        if (Notification.permission === 'granted') {
          console.log('[PushClient] Notification permission already granted.');
        } else if (Notification.permission === 'denied') {
          console.warn('[PushClient] Notification permission denied. Please enable notifications in your browser settings.');
        } else {
          Notification.requestPermission().then(function(permission) {
            if (permission === 'granted') {
              console.log('[PushClient] Notification permission granted.');
            } else {
              console.warn('[PushClient] Notification permission not granted:', permission);
            }
          });
        }

        // Listen for push events/messages from the service worker
        navigator.serviceWorker.addEventListener('message', function(event) {
          console.log('[PushClient] Message from service worker:', event.data);
        });
      })
      .catch(function(error) {
        console.error('[PushClient] Service worker registration failed:', error);
      });
  });

  // Diagnostic: log when a notification is received while page is open
  if ('Notification' in window) {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && Notification.permission === 'granted') {
        console.log('[PushClient] Page is visible and notifications are enabled.');
      }
    });
  }
})();
