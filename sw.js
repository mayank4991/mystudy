// Service Worker for Epilepsy Management System
// Handles push notifications, offline capabilities, and background sync

const CACHE_NAME = 'epicare-v4.2';
const OFFLINE_URL = './offline.html';
const DB_NAME = 'EpicareOfflineDB';
const DB_VERSION = 4;
const SYNC_QUEUE_STORE = 'syncQueue';
const OFFLINE_DATA_STORE = 'offlineData';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './offline.html',
  './style.css',
  './script.js',
  './js/utils.js',
  './js/config.js',
  './js/globals.js',
  './js/followup.js',
  './js/date-utils.js',
  './js/i18n.js',
  './js/offline-sync.js',
  './js/validation.js',
  './js/injury-map.js',
  './js/seizure-classifier.js',
  './js/draft.js',
  './js/dose-adequacy.js',
  './js/adminManagement.js',
  './js/advancedAnalytics.js',
  './js/security.js',
  './js/performance-optimizations.js',
  './js/teleconsultation.js',
  './js/seizure-video-upload.js',
  './js/cds/integration.js',
  './js/cds/ui-components.js',
  './js/cds/governance.js',
  './js/cds/version-manager.js',
  './js/api/cds-api.js',
  './js/telemetry/cds-telemetry.js',
  './images/notification-icon.jpg',
  './images/badge.png',
  // i18n files
  './i18n/en.json',
  './i18n/hi.json',
  './i18n/bn.json',
  './i18n/ta.json',
  './i18n/te.json',
  './i18n/ml.json',
  './i18n/kn.json',
  './i18n/mr.json',
  './i18n/pa.json'
];

// =====================================================
// IndexedDB UTILITIES
// =====================================================

/**
 * Open IndexedDB for storing offline data and sync queue
 * Handles version conflicts gracefully by retrying without a specific version
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (event) => {
      const error = request.error;
      // Handle VersionError: stale SW may request older version than what the page created
      if (error && error.name === 'VersionError') {
        console.warn('[SW] IndexedDB VersionError - retrying without explicit version to match existing DB');
        const retryRequest = indexedDB.open(DB_NAME);
        retryRequest.onerror = () => reject(retryRequest.error);
        retryRequest.onsuccess = () => resolve(retryRequest.result);
      } else {
        reject(error);
      }
    };
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Sync Queue Store: Stores failed POST requests for retry
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        const syncStore = db.createObjectStore(SYNC_QUEUE_STORE, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        syncStore.createIndex('action', 'action', { unique: false });
        syncStore.createIndex('retryCount', 'retryCount', { unique: false });
      }
      
      // Offline Data Store: Stores temporary data created while offline
      if (!db.objectStoreNames.contains(OFFLINE_DATA_STORE)) {
        const dataStore = db.createObjectStore(OFFLINE_DATA_STORE, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        dataStore.createIndex('type', 'type', { unique: false });
        dataStore.createIndex('patientId', 'patientId', { unique: false });
        dataStore.createIndex('timestamp', 'timestamp', { unique: false });
        dataStore.createIndex('synced', 'synced', { unique: false });
      }
    };
  });
}

/**
 * Add request to sync queue
 */
async function addToSyncQueue(requestData) {
  try {
    const db = await openDB();
    const transaction = db.transaction([SYNC_QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    
    // Determine priority and max retries based on action type
    const action = requestData.action || 'unknown';
    const priority = getPriorityForAction(action);
    const maxRetries = getMaxRetriesForAction(action);
    
    const queueItem = {
      url: requestData.url,
      method: requestData.method || 'POST',
      headers: requestData.headers || {},
      body: requestData.body,
      action: action,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: maxRetries,
      queuePriority: priority,
      lastRetryTime: null
    };
    
    await store.add(queueItem);
    
    console.log(`[SW] Added request to sync queue: ${action} (priority: ${priority})`);
    
    // Register background sync if supported
    if (self.registration && self.registration.sync) {
      await self.registration.sync.register('sync-epicare-data');
    }
    
    return true;
  } catch (error) {
    console.error('[SW] Error adding to sync queue:', error);
    return false;
  }
}

/**
 * Get priority for action type (lower = higher priority)
 */
function getPriorityForAction(action) {
  // CRITICAL: New patient creation (priority 1)
  if (action === 'createPatient') return 1;
  // HIGH: Patient updates (priority 2)
  if (action === 'updatePatient') return 2;
  // MEDIUM: Follow-ups and other patient actions (priority 3)
  if (action === 'completeFollowUp' || action === 'createSeizureEvent') return 3;
  // LOW: Everything else (priority 4)
  return 4;
}

/**
 * Get max retries for action type
 * Critical actions get fewer retries (fail fast), medium actions get more
 */
function getMaxRetriesForAction(action) {
  if (action === 'createPatient') return 3;
  if (action === 'updatePatient') return 5;
  if (action === 'completeFollowUp') return 5;
  return 5;
}

/**
 * Calculate exponential backoff delay for retry
 */
function calculateRetryDelay(retryCount, baseDelay = 1000) {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
  const exponential = baseDelay * Math.pow(2, retryCount);
  const capped = Math.min(exponential, 30000);
  
  // Add jitter (±20%) to prevent thundering herd
  const jitter = capped * (0.8 + Math.random() * 0.4);
  
  return Math.round(jitter);
}

/**
 * Get all pending sync queue items, ordered by priority
 */
async function getSyncQueue() {
  try {
    const db = await openDB();
    // Use versionchange event to handle schema upgrades
    const transaction = db.transaction([SYNC_QUEUE_STORE], 'readonly');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result || [];
        // Sort by priority (ascending) then by timestamp
        items.sort((a, b) => {
          const priorityDiff = (a.queuePriority || 4) - (b.queuePriority || 4);
          if (priorityDiff !== 0) return priorityDiff;
          return a.timestamp - b.timestamp;
        });
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[SW] Error getting sync queue:', error);
    return [];
  }
}

/**
 * Remove item from sync queue after successful sync
 */
async function removeFromSyncQueue(id) {
  try {
    const db = await openDB();
    const transaction = db.transaction([SYNC_QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    await store.delete(id);
    console.log('[SW] Removed item from sync queue:', id);
  } catch (error) {
    console.error('[SW] Error removing from sync queue:', error);
  }
}

/**
 * Update retry count and schedule next retry for failed sync attempts
 */
async function updateRetryCount(id, retryCount) {
  try {
    const db = await openDB();
    const transaction = db.transaction([SYNC_QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    
    const item = await store.get(id);
    if (item) {
      item.retryCount = retryCount;
      item.lastRetryTime = Date.now();
      item.lastRetry = Date.now();
      await store.put(item);
    }
  } catch (error) {
    console.error('[SW] Error updating retry count:', error);
  }
}

/**
 * Process sync queue - attempt to send all queued requests
 */
async function processSyncQueue() {
  console.log('[SW] Processing sync queue...');
  const queue = await getSyncQueue();
  
  if (queue.length === 0) {
    console.log('[SW] Sync queue is empty');
    return;
  }
  
  console.log(`[SW] Found ${queue.length} items in sync queue (ordered by priority)`);
  
  for (const item of queue) {
    // Check if max retries exceeded
    if (item.retryCount >= item.maxRetries) {
      console.warn(`[SW] Max retries exceeded for ${item.action} (${item.retryCount}/${item.maxRetries}), removing from queue`);
      await removeFromSyncQueue(item.id);
      // Notify client about permanent failure
      await notifyClients({
        type: 'sync-failed',
        action: item.action,
        reason: 'max_retries_exceeded',
        retryCount: item.retryCount
      });
      continue;
    }
    
    try {
      // Reconstruct the fetch request
      const fetchOptions = {
        method: item.method,
        headers: item.headers,
        body: item.body
      };
      
      console.log(`[SW] Attempting to sync: ${item.action} (retry ${item.retryCount + 1}/${item.maxRetries}, priority: ${item.queuePriority || 'none'})`);
      
      const response = await fetch(item.url, fetchOptions);
      
      if (response.ok) {
        // Success! Remove from queue
        console.log(`[SW] Successfully synced: ${item.action}`);
        
        // Parse response
        let responseData = null;
        try {
          responseData = await response.clone().json();
        } catch (e) {
          // Response might not be JSON
        }
        
        // Special handling for createPatient: merge temp ID → real server ID
        if (item.action === 'createPatient' && responseData) {
          console.log('[SW] Processing createPatient sync merge...');
          try {
            if (window.OfflinePatientCreationManager && typeof window.OfflinePatientCreationManager.mergeSyncResult === 'function') {
              const mergeResult = await window.OfflinePatientCreationManager.mergeSyncResult(item.entityID, responseData);
              console.log('[SW] Sync merge result:', mergeResult);
            }
          } catch (mergeErr) {
            console.error('[SW] Error during sync merge:', mergeErr);
            // Continue anyway - queue will be cleared
          }
        }
        
        await removeFromSyncQueue(item.id);
        
        // Notify client about success
        await notifyClients({
          type: 'sync-success',
          action: item.action,
          data: responseData,
          entityID: item.entityID
        });
      } else {
        // Server error, increment retry count with exponential backoff
        const newRetryCount = item.retryCount + 1;
        const retryDelay = calculateRetryDelay(newRetryCount);
        
        console.warn(`[SW] Server error syncing ${item.action}: ${response.status}. Next retry in ${retryDelay}ms`);
        
        // Special handling for createPatient: log failure to offline patient record
        if (item.action === 'createPatient' && window.OfflinePatientCreationManager) {
          try {
            let errorMsg = `Server error: ${response.status}`;
            try {
              const errData = await response.clone().json();
              errorMsg = errData.message || errorMsg;
            } catch (e) {}
            
            const failureResult = await window.OfflinePatientCreationManager.handleSyncFailure(
              item.entityID,
              errorMsg
            );
            console.log('[SW] Failure handling result:', failureResult);
            
            if (!failureResult.retryable) {
              await notifyClients({
                type: 'sync-failed',
                action: 'createPatient',
                entityID: item.entityID,
                reason: 'max_retries_exceeded',
                message: 'Patient creation failed after 3 retries. User can edit and retry.'
              });
            }
          } catch (handleErr) {
            console.error('[SW] Error handling createPatient failure:', handleErr);
          }
        }
        
        await updateRetryCount(item.id, newRetryCount);
        
        // Schedule retry if not max retries
        if (newRetryCount < item.maxRetries) {
          await scheduleRetryAfterDelay(retryDelay);
        }
      }
    } catch (error) {
      // Network error, increment retry count with exponential backoff
      const newRetryCount = item.retryCount + 1;
      const retryDelay = calculateRetryDelay(newRetryCount);
      
      console.error(`[SW] Network error syncing ${item.action} - next retry in ${retryDelay}ms:`, error);
      
      // Special handling for createPatient: log network failure
      if (item.action === 'createPatient' && window.OfflinePatientCreationManager) {
        try {
          const failureResult = await window.OfflinePatientCreationManager.handleSyncFailure(
            item.entityID,
            `Network error: ${error.message}`
          );
          console.log('[SW] Network error handling result:', failureResult);
          
          if (!failureResult.retryable) {
            await notifyClients({
              type: 'sync-failed',
              action: 'createPatient',
              entityID: item.entityID,
              reason: 'max_retries_exceeded',
              message: 'Patient creation failed after 3 retries. User can edit and retry.'
            });
          }
        } catch (handleErr) {
          console.error('[SW] Error handling createPatient network failure:', handleErr);
        }
      }
      
      await updateRetryCount(item.id, newRetryCount);
      
      // Schedule retry if not max retries
      if (newRetryCount < item.maxRetries) {
        await scheduleRetryAfterDelay(retryDelay);
      }
    }
  }
  
  // Check if there are still items in queue
  const remainingQueue = await getSyncQueue();
  if (remainingQueue.length > 0) {
    console.log(`[SW] ${remainingQueue.length} items remaining in sync queue`);
  } else {
    console.log('[SW] All items synced successfully!');
    await notifyClients({
      type: 'sync-complete',
      message: 'All offline data synced successfully'
    });
  }
}

/**
 * Schedule a retry after the calculated delay
 */
async function scheduleRetryAfterDelay(delay) {
  // Register for background sync with a tag that includes timestamp
  if (self.registration && self.registration.sync) {
    try {
      await self.registration.sync.register('sync-epicare-data');
    } catch (e) {
      console.warn('[SW] Background sync registration failed:', e);
    }
  }
}

/**
 * Notify all clients about sync events
 */
async function notifyClients(message) {
  const allClients = await clients.matchAll({ includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage(message);
  }
}

// =====================================================
// SERVICE WORKER EVENT LISTENERS
// =====================================================

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.debug('[Service Worker] Caching app shell and content');
        // Use individual add calls to make caching more resilient
        const cachePromises = ASSETS_TO_CACHE.map(asset => {
          return cache.add(asset).catch(err => console.warn(`[Service Worker] Failed to cache ${asset}:`, err));
        });
        await Promise.all(cachePromises);
      })
  );
  // Activate the service worker immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Handle push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    console.error('[Service Worker] Error parsing push payload:', e);
    return;
  }

  // Fallback logic for missing title/body
  let title = payload.title;
  let body = payload.body;

  // If title/body missing, try to generate from raw data
  if (!title || typeof title !== 'string' || title.trim() === '') {
    // Try to use keys from payload for a meaningful title
    if (payload.type) {
      title = String(payload.type).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } else if (payload.status) {
      title = String(payload.status).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } else {
      title = 'Notification';
    }
  }
  if (!body || typeof body !== 'string' || body.trim() === '') {
    // Try to summarize the payload
    if (payload.message) {
      body = String(payload.message);
    } else if (payload.data && typeof payload.data === 'object') {
      body = Object.entries(payload.data).map(([k, v]) => `${k}: ${v}`).join(', ');
    } else {
      // Fallback: show all keys/values
      body = Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
  }

  const options = {
    body: body,
    icon: payload.icon || '/images/notification-icon.jpg',
    badge: payload.badge || '/images/badge.png',
    data: payload.data || {},
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  // This looks to see if the current tab is already open and focuses it
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
      return Promise.resolve();
    }).catch((error) => {
      console.error('[Service Worker] Error handling notification click:', error);
      return Promise.resolve();
    })
  );
});

// Handle fetch events - Enhanced with offline queueing for POST requests
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // =====================================================
  // POST REQUEST HANDLING (Follow-ups, Referrals, etc.)
  // =====================================================
  if (request.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          // Try to send the request
          const response = await fetch(request.clone());
          
          // If successful, return response
          if (response.ok) {
            console.log('[SW] POST request successful:', url.pathname);
            return response;
          }
          
          // Server error - queue for retry
          console.warn('[SW] POST request failed with status:', response.status);
          await queuePostRequest(request);
          
          // Return a custom response indicating offline mode
          return new Response(JSON.stringify({
            success: false,
            offline: true,
            message: 'Request queued for sync when connection is restored',
            status: 'queued'
          }), {
            status: 202, // Accepted
            headers: { 'Content-Type': 'application/json' }
          });
          
        } catch (error) {
          // Network error - definitely offline
          console.log('[SW] POST request failed (offline), queuing:', url.pathname);
          await queuePostRequest(request);
          
          // Return offline response
          return new Response(JSON.stringify({
            success: false,
            offline: true,
            message: 'You are offline. Your changes will be synced automatically when connection is restored.',
            status: 'queued'
          }), {
            status: 202, // Accepted  
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }
  
  // =====================================================
  // GET REQUEST HANDLING (Static assets, pages)
  // =====================================================
  // Skip chrome-extension and other non-http(s) requests
  if (!request.url.startsWith('http')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Check if this is a dynamic data endpoint that should always be fresh
      const isDynamicDataEndpoint = () => {
        try {
          const pathname = url.pathname;
          // These endpoints always need fresh data, never use cache
          return /^.*\?.*action=(getPatients|getFollowUps|getUsers|getPHCs|checkAndResetFollowUps)/.test(request.url);
        } catch (e) {
          return false;
        }
      };
      
      // ALWAYS fetch fresh for dynamic data endpoints (network-first, with timeout fallback)
      if (isDynamicDataEndpoint()) {
        console.log('[SW] Network-first for dynamic endpoint:', url.search);
        const networkPromise = fetch(request).then(response => {
          // Don't cache dynamic data to prevent stale patient lists
          console.log('[SW] Fresh data fetched (not cached):', url.search);
          return response;
        });
        
        // MOBILE FIX: Increased timeout from 5s to 35s.
        // 5s was far too aggressive for mobile 3G/2G networks where Google Apps Script
        // cold-start alone can take 10-15s. The page-level AbortController (30s) is the
        // real timeout; the SW should NOT race against it with a shorter deadline.
        return Promise.race([
          networkPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 35000))
        ]).catch(async () => {
          console.warn('[SW] Dynamic endpoint timeout/failed, checking cache...');
          // MOBILE FIX: Strip sessionToken from URL before cache lookup so that
          // cached responses from a previous session can still be used as fallback.
          try {
            const strippedUrl = new URL(request.url);
            strippedUrl.searchParams.delete('sessionToken');
            const cached = await cache.match(new Request(strippedUrl.toString()));
            if (cached) {
              console.warn('[SW] Serving stale cache for dynamic endpoint (network unavailable)');
              return cached;
            }
          } catch (cacheErr) {
            console.warn('[SW] Cache lookup failed:', cacheErr);
          }
          // Return a proper JSON error so the app can handle it gracefully
          return new Response(
            JSON.stringify({ status: 'error', message: 'Network unavailable and no cached data', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        });
      }
      
      // For other API requests with query params, use network-first without caching
      try {
        if (url.origin !== self.location.origin || url.search) {
          // Network first for API/dynamic resources, but do not put into cache
          return fetch(request).catch(async () => {
            const cached = await cache.match(request);
            if (cached) return cached;
            if (request.mode === 'navigate') {
              const offline = await cache.match(OFFLINE_URL);
              if (offline) return offline;
            }
            return new Response('Network error and not in cache', { status: 408, headers: { 'Content-Type': 'text/plain' } });
          });
        }
      } catch (e) {
        // If URL parsing fails, fallback to existing logic
      }
      
      // CRITICAL: Never cache authentication-related requests
      const isAuthRequest = await (async () => {
        if (request.method === 'POST') {
          try {
            const body = await request.clone().text();
            const params = new URLSearchParams(body);
            const action = params.get('action') || '';
            // Don't cache login, logout, session validation, or password change
            if (/^(login|logout|validateSession|changePassword)$/.test(action)) {
              console.log(`[SW] Skipping cache for auth action: ${action}`);
              return true;
            }
          } catch (e) {
            // If can't read body, assume it's not auth-related
          }
        }
        return false;
      })();
      
      if (isAuthRequest) {
        // Always fetch fresh for auth requests, never use cache
        return fetch(request).catch(async () => {
          // Don't fall back to cache for auth requests - if network fails, fail hard
          return new Response('Authentication request failed - no network', { 
            status: 408, 
            headers: { 'Content-Type': 'text/plain' } 
          });
        });
      }
      
      // Try network first for static same-origin requests
      try {
        const networkResponse = await fetch(request);
        // If successful, update the cache
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        // Network failed, try to serve from cache
        console.warn(`[Service Worker] Network fetch failed for ${request.url}, serving from cache.`);
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // If not in cache and network fails, show offline page for navigation requests
      if (request.mode === 'navigate') {
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
      }
      
      // For other assets, return a proper error response
      return new Response('Network error and not in cache', {
        status: 408,
        headers: { 'Content-Type': 'text/plain' },
      });
      }
    })
  );
});

/**
 * Queue POST request for later synchronization
 */
async function queuePostRequest(request) {
  try {
    // Clone the request to read body
    const clonedRequest = request.clone();
    const body = await clonedRequest.text();
    
    // Extract action from body for better tracking
    let action = 'unknown';
    try {
      // Try to parse as URL-encoded form data
      const params = new URLSearchParams(body);
      action = params.get('action') || 'unknown';
      
      // If not found, try JSON
      if (action === 'unknown') {
        try {
          const jsonBody = JSON.parse(body);
          action = jsonBody.action || 'unknown';
        } catch (e) {
          // Not JSON, keep as unknown
        }
      }
    } catch (e) {
      console.warn('[SW] Could not parse request body for action');
    }
    
    // Prepare request data for queueing
    const requestData = {
      url: request.url,
      method: request.method,
      headers: {},
      body: body,
      action: action
    };
    
    // Convert headers to plain object
    for (const [key, value] of request.headers.entries()) {
      requestData.headers[key] = value;
    }
    
    // Add to sync queue
    await addToSyncQueue(requestData);
    
    console.log(`[SW] Queued ${action} request for sync`);
    
  } catch (error) {
    console.error('[SW] Error queuing POST request:', error);
  }
}

// =====================================================
// BACKGROUND SYNC EVENT
// =====================================================

// Handle background sync event (when network is restored)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event triggered:', event.tag);
  
  if (event.tag === 'sync-epicare-data') {
    event.waitUntil(processSyncQueue());
  }
});

// =====================================================
// MESSAGE EVENT (Communication with clients)
// =====================================================

// Handle messages from clients
self.addEventListener('message', (event) => {
  console.log('[SW] Received message:', event.data);
  
  try {
    if (event.data && event.data.type === 'SYNC_NOW') {
      // Manual sync triggered by client
      event.waitUntil(processSyncQueue());
    }
    
    if (event.data && event.data.type === 'GET_SYNC_STATUS') {
      // Return sync queue status to client
      if (event.ports && event.ports[0]) {
        event.waitUntil(
          (async () => {
            try {
              const queue = await getSyncQueue();
              event.ports[0].postMessage({
                type: 'SYNC_STATUS',
                queueLength: queue.length,
                items: queue.map(item => ({
                  action: item.action,
                  timestamp: item.timestamp,
                  retryCount: item.retryCount
                }))
              });
            } catch (err) {
              console.error('[SW] Error handling GET_SYNC_STATUS:', err);
              // Still try to respond even if there's an error
              try {
                event.ports[0].postMessage({
                  type: 'SYNC_STATUS_ERROR',
                  error: err.message
                });
              } catch (portErr) {
                console.error('[SW] Could not send error message to port:', portErr);
              }
            }
          })()
        );
      } else {
        console.warn('[SW] Received GET_SYNC_STATUS but no ports available');
      }
    }
  } catch (err) {
    console.error('[SW] Error in message handler:', err);
  }
});