// globals.js
// Shared state, utilities and compatibility layer

// Global state variables
window.currentUserRole = '';
window.currentUserAssignedPHC = '';
window.allPatients = [];
window.allFollowUps = [];

const SESSION_STORAGE_TOKEN_KEY = 'epicare_session_token';
const SESSION_STORAGE_EXPIRY_KEY = 'epicare_session_expiry';
let sessionStorageAvailable = true; // Track if sessionStorage is usable

window.setSessionToken = function(token, expiresAt) {
    window.__epicareSessionToken = token || '';
    
    // Try to persist to sessionStorage
    if (sessionStorageAvailable) {
        try {
            if (token) {
                sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, token);
                if (expiresAt) {
                    sessionStorage.setItem(SESSION_STORAGE_EXPIRY_KEY, String(expiresAt));
                }
                window.Logger.debug('Session token persisted to sessionStorage');
            } else {
                sessionStorage.removeItem(SESSION_STORAGE_TOKEN_KEY);
                sessionStorage.removeItem(SESSION_STORAGE_EXPIRY_KEY);
            }
        } catch (storageError) {
            // sessionStorage failed - likely private/incognito mode
            sessionStorageAvailable = false;
            window.Logger.warn('sessionStorage unavailable (private mode?). Using memory-only token storage.', storageError);
            window.__sessionStorageDisabled = true; // Flag for fetch interceptor
        }
    }
};

window.clearSessionToken = function() {
    window.setSessionToken('', null);
};

window.getSessionToken = function() {
    // First try memory storage
    if (window.__epicareSessionToken) {
        return window.__epicareSessionToken;
    }
    
    // Try sessionStorage only if available
    if (sessionStorageAvailable) {
        try {
            const stored = sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY);
            const expiry = Number(sessionStorage.getItem(SESSION_STORAGE_EXPIRY_KEY) || 0);
            if (expiry && Date.now() > expiry) {
                window.clearSessionToken();
                return '';
            }
            if (stored) {
                window.__epicareSessionToken = stored;
                return stored;
            }
        } catch (err) {
            sessionStorageAvailable = false;
            window.__sessionStorageDisabled = true;
            window.Logger.warn('Unable to read from sessionStorage (may be in private mode):', err);
        }
    }
    return '';
};

window.handleUnauthorizedResponse = function(message) {
    try {
        window.clearSessionToken();
    } catch (err) {
        window.Logger.warn('Failed to clear session token after unauthorized response:', err);
    }

    const dashboard = document.getElementById('dashboardScreen');
    const loginScreen = document.getElementById('loginScreen');
    const dashboardVisible = dashboard && dashboard.style.display !== 'none';

    // Show visible notification BEFORE logout so user sees what happened
    if (dashboardVisible && typeof window.showNotification === 'function') {
        window.showNotification(message || 'Session expired. Please log in again.', 'error');
    } else if (dashboardVisible && typeof window.showToast === 'function') {
        window.showToast('error', message || 'Session expired. Please log in again.');
    }

    if (typeof window.logout === 'function') {
        try {
            window.logout({ silent: true, skipToast: true });
        } catch (err) {
            window.Logger.warn('Logout handler failed during unauthorized response:', err);
        }
    } else {
        if (dashboard) dashboard.style.display = 'none';
        if (loginScreen) loginScreen.style.display = 'block';
    }

    try {
        document.dispatchEvent(new CustomEvent('sessionExpired'));
    } catch (err) {
        window.Logger.warn('Failed to dispatch sessionExpired event:', err);
    }
};

function appendSessionTokenToUrl(url, token) {
    // MOBILE FIX: Do not short-circuit on empty token.
    // Always attempt to build the URL so the parameter key is present.
    // If token is genuinely empty the server will reject it clearly (unauthorized)
    // rather than silently stripping the key and confusing diagnostics.
    if (!token) {
        window.Logger && window.Logger.debug && window.Logger.debug('[Auth] Session token not yet available - will retry on next request');
        return url; // Still return URL unchanged; fetch interceptor should retry after token is ready
    }
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('sessionToken', token);
        return parsed.toString();
    } catch (err) {
        // URL constructor can fail on relative URLs or in older browsers
        window.Logger.warn('Falling back while appending session token to URL:', err);
        // Manual fallback: append as query parameter
        const separator = url.indexOf('?') !== -1 ? '&' : '?';
        return url + separator + 'sessionToken=' + encodeURIComponent(token);
    }
}

function injectSessionTokenIntoBody(init, token) {
    if (!init || !token) return init;
    const headers = new Headers(init.headers || {});
    const headerValue = (headers.get('Content-Type') || headers.get('content-type') || '').toLowerCase();

    const ensureJsonBody = (payload) => {
        if (!payload.sessionToken) {
            payload.sessionToken = token;
            init.body = JSON.stringify(payload);
        }

        if (!headerValue) {
            headers.set('Content-Type', 'text/plain;charset=UTF-8');
        }
    };

    try {
        if (headerValue.includes('application/json') || headerValue.includes('text/plain')) {
            if (typeof init.body === 'string' && init.body.trim()) {
                const payload = JSON.parse(init.body);
                if (!payload.sessionToken) {
                    payload.sessionToken = token;
                    init.body = JSON.stringify(payload);
                }
                // Convert application/json to text/plain to avoid CORS preflight
                if (headerValue.includes('application/json')) {
                    headers.set('Content-Type', 'text/plain;charset=UTF-8');
                }
            }
        } else if (headerValue.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(init.body || '');
            if (!params.get('sessionToken')) {
                params.set('sessionToken', token);
                init.body = params.toString();
            }
        } else if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
            if (!init.body.get('sessionToken')) {
                init.body.set('sessionToken', token);
            }
        } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
            if (!init.body.get('sessionToken')) {
                init.body.append('sessionToken', token);
            }
        } else if (typeof init.body === 'string' && init.body.trim().startsWith('{')) {
            const payload = JSON.parse(init.body);
            ensureJsonBody(payload);
        }
    } catch (err) {
        window.Logger.warn('Failed to inject session token into request body:', err);
    }

    init.headers = headers;
    return init;
}

(function installAuthenticatedFetch() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        return;
    }

    const originalFetch = window.fetch.bind(window);

    window.fetch = function(input, init) {
        let nextInput = input;
        let nextInit = init;
        let touchesBackend = false;

        try {
            const baseUrl = window.API_CONFIG && window.API_CONFIG.MAIN_SCRIPT_URL;
            if (baseUrl) {
                const targetUrl = typeof input === 'string' ? input : (input && input.url);
                touchesBackend = typeof targetUrl === 'string' && targetUrl.indexOf(baseUrl) === 0;
                if (touchesBackend) {
                    const token = window.getSessionToken ? window.getSessionToken() : '';
                    // MOBILE FIX: Always attempt to add token, even if empty - server will handle
                    // This ensures GET requests include session token in URL params consistently
                    if (typeof targetUrl === 'string') {
                        const updatedUrl = appendSessionTokenToUrl(targetUrl, token);
                        if (typeof input === 'string') {
                            nextInput = updatedUrl;
                        } else if (typeof Request !== 'undefined' && input instanceof Request) {
                            nextInput = new Request(updatedUrl, input);
                        }
                    }

                    // For POST requests, always inject into body
                    const method = ((nextInit && nextInit.method) || (input && input.method) || 'GET').toUpperCase();
                    if (method !== 'GET' && token) {
                        nextInit = injectSessionTokenIntoBody(Object.assign({}, nextInit || {}), token);
                    }
                }
            }
        } catch (err) {
            window.Logger.warn('Authenticated fetch preparation failed:', err);
        }

        const responsePromise = originalFetch(nextInput, nextInit);

        if (!touchesBackend) {
            return responsePromise;
        }

        return responsePromise.then(function(response) {
            try {
                const cloned = response.clone();
                const headers = cloned.headers;
                const contentType = headers && (headers.get('Content-Type') || headers.get('content-type')) || '';
                if (contentType.indexOf('application/json') !== -1) {
                    cloned.json().then(function(payload) {
                        if (payload && payload.status === 'error' && payload.code === 'unauthorized' && typeof window.handleUnauthorizedResponse === 'function') {
                            window.handleUnauthorizedResponse(payload.message || 'Authentication required');
                        }
                    }).catch(function(err) {
                        window.Logger.warn('Failed to inspect backend JSON response:', err);
                    });
                }
            } catch (err) {
                window.Logger.warn('Authenticated fetch response inspection failed:', err);
            }
            return response;
        }).catch(function(error) {
            // Handle CORS errors and network errors gracefully
            var isCorsError = error.message && 
                             (error.message.includes('CORS') || 
                              error.message.includes('cross-origin') ||
                              error.message.includes('Access-Control'));
            
            if (isCorsError) {
                window.Logger.error('CORS Error: Backend deployment may not have CORS headers configured. See console for details.', {
                    url: typeof nextInput === 'string' ? nextInput : (nextInput && nextInput.url),
                    error: error.message,
                    solution: 'Verify Google Apps Script is deployed as Web App with proper CORS configuration'
                });
            } else {
                window.Logger.error('API Request Failed:', {
                    url: typeof nextInput === 'string' ? nextInput : (nextInput && nextInput.url),
                    error: error.message
                });
            }
            
            // Re-throw error so caller can handle it, but log it first
            throw error;
        });
    };
})();

// Ensure API_CONFIG is available (set by config.js)
// config.js loads before globals.js, so this should always be available
if (!window.API_CONFIG) {
    window.Logger.error('API_CONFIG not found - config.js failed to load properly');
    // Don't set fallback URLs here - they should be centralized in config.js only
}

// =====================================================
// SESSION VALIDATION & PERIODIC CHECKS
// =====================================================

// Periodic session validation to catch mid-session expirations before API calls fail
window.__sessionValidationIntervalId = null;
window.__sessionValidationInProgress = false;

/**
 * Start periodic session validation (every 5 minutes by default)
 * This proactively checks if the session is still valid on the backend before making API calls
 * Helps prevent silent logouts and 401 errors during normal use
 */
window.startPeriodicSessionValidation = function(intervalMinutes = 5) {
    if (window.__sessionValidationIntervalId) {
        clearInterval(window.__sessionValidationIntervalId);
    }
    
    // Validate immediately on startup
    window.validateSessionWithBackend();
    
    // Then validate periodically
    window.__sessionValidationIntervalId = setInterval(() => {
        window.validateSessionWithBackend();
    }, intervalMinutes * 60 * 1000);
    
    window.Logger.debug(`Session validation started - checking every ${intervalMinutes} minutes`);
};

/**
 * Stop periodic session validation
 */
window.stopPeriodicSessionValidation = function() {
    if (window.__sessionValidationIntervalId) {
        clearInterval(window.__sessionValidationIntervalId);
        window.__sessionValidationIntervalId = null;
        window.Logger.debug('Session validation stopped');
    }
};

/**
 * Validate session with backend by making a lightweight API call
 * If invalid, triggers handleUnauthorizedResponse to log user out
 */
window.validateSessionWithBackend = async function() {
    // Prevent multiple concurrent validation requests
    if (window.__sessionValidationInProgress) return;
    
    window.__sessionValidationInProgress = true;
    try {
        const token = (typeof window.getSessionToken === 'function') ? window.getSessionToken() : '';
        
        // Only validate if we have a token and user is logged in
        if (!token || !window.currentUserName) {
            window.__sessionValidationInProgress = false;
            return;
        }
        
        const payload = new URLSearchParams();
        payload.append('action', 'validateSession');
        payload.append('username', window.currentUserName || '');
        payload.append('sessionToken', token);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for validation
        
        try {
            const response = await fetch(window.API_CONFIG.MAIN_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: payload.toString(),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const result = await response.json();
                if (result.status === 'error' && result.code === 'unauthorized') {
                    window.Logger.warn('Session validation: Backend reports unauthorized');
                    window.handleUnauthorizedResponse('Session expired. Please log in again.');
                } else if (result.status === 'success') {
                    window.Logger.debug('Session validation: OK');
                }
            } else if (response.status === 401) {
                window.Logger.warn('Session validation: Received 401');
                window.handleUnauthorizedResponse('Session expired. Please log in again.');
            }
        } catch (err) {
            clearTimeout(timeoutId);
            if (err && err.name === 'AbortError') {
                window.Logger.debug('Session validation request timed out (expected on slow networks)');
            } else {
                window.Logger.warn('Session validation failed:', err);
            }
        }
    } finally {
        window.__sessionValidationInProgress = false;
    }
};

// API Utilities
window.makeAPICall = async function(action, data = {}) {
    try {
        const token = (typeof window.getSessionToken === 'function') ? window.getSessionToken() : '';
        const payload = Object.assign({}, data, { action });
        if (token && !payload.sessionToken) {
            payload.sessionToken = token;
        }

        // Convert payload to URLSearchParams format to match backend expectations
        // This works reliably with Google Apps Script CORS configuration
        const urlEncoded = new URLSearchParams();
        Object.keys(payload).forEach(key => {
            const value = payload[key];
            // Handle arrays and objects by JSON-encoding them
            if (typeof value === 'object' && value !== null) {
                urlEncoded.append(key, JSON.stringify(value));
            } else {
                urlEncoded.append(key, String(value));
            }
        });

        const response = await fetch(window.API_CONFIG.MAIN_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: urlEncoded.toString()
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.status === 'error') {
            if (result.code === 'unauthorized' && typeof window.handleUnauthorizedResponse === 'function') {
                window.handleUnauthorizedResponse(result.message || 'Authentication required');
            }
            throw new Error(result.message || 'API returned an error');
        }

        return result;
    } catch (error) {
        window.Logger.error('API call failed:', error);
        if (typeof showToast === 'function') {
            showToast('error', `Operation failed: ${error.message}`);
        }
        throw error;
    }
};

// Functions to update global state
window.setCurrentUserRole = function(role) {
    window.currentUserRole = role;
};

window.setCurrentUserAssignedPHC = function(phc) {
    window.currentUserAssignedPHC = phc;
};

window.setPatientData = function(data) {
    window.allPatients = data;
    window.patientData = data;
    try { if (typeof patientData !== 'undefined') patientData = data; } catch (e) { /* ignore */ }
    try {
        if (typeof renderFollowUpTrendChart === 'function') renderFollowUpTrendChart();
        if (typeof renderPHCFollowUpMonthlyChart === 'function') renderPHCFollowUpMonthlyChart();
        if (typeof renderAdherenceTrendChart === 'function') renderAdherenceTrendChart();
    } catch (e) { /* ignore rendering errors */ }
};

window.setFollowUpsData = function(data) {
    window.allFollowUps = data;
    window.followUpsData = data;
    try { if (typeof followUpsData !== 'undefined') followUpsData = data; } catch (e) { /* ignore */ }
    try {
        // Update any charts that depend on follow-up data
        if (typeof renderFollowUpTrendChart === 'function') renderFollowUpTrendChart();
        if (typeof renderPHCFollowUpMonthlyChart === 'function') renderPHCFollowUpMonthlyChart();
        if (typeof renderAdherenceTrendChart === 'function') renderAdherenceTrendChart();
    } catch (e) { /* ignore rendering errors */ }
};

// Ensure followup functions are available globally when loaded
window.ensureFollowUpFunctions = function() {
    // Functions from followup.js
    if (typeof renderFollowUpPatientList !== 'undefined') {
        window.renderFollowUpPatientList = renderFollowUpPatientList;
    }
    if (typeof openFollowUpModal !== 'undefined') {
        window.openFollowUpModal = openFollowUpModal;
    }
    if (typeof closeFollowUpModal !== 'undefined') {
        window.closeFollowUpModal = closeFollowUpModal;
    }
};

// Stub functions for print summary if not loaded
if (!window.buildPatientSummary) {
    window.buildPatientSummary = function(patient) {
        window.Logger.warn('buildPatientSummary not yet loaded');
        return '';
    };
}

// =====================================================
// USER ACTIVITY LOGGING
// =====================================================

/**
 * Log user activity to backend
 * @param {string} action - The action being performed
 * @param {object} details - Additional details about the action
 */
window.logUserActivity = async function(action, details = {}) {
    try {
        const username = window.currentUserName || 'Unknown';
        const role = window.currentUserRole || 'unknown';
        const phc = window.currentUserPHC || 'Unknown';
        
        // Add role and PHC to details
        const enrichedDetails = {
            ...details,
            role: role,
            phc: phc,
            timestamp: new Date().toISOString()
        };
        
        // Check if we're online
        if (!navigator.onLine) {
            window.Logger.debug('[logUserActivity] Offline mode - queueing activity log:', action);
            // Queue to service worker instead of fetching
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'QUEUE_ACTIVITY_LOG',
                    action: action,
                    username: username,
                    details: enrichedDetails,
                    userAgent: navigator.userAgent || 'Unknown'
                });
                window.Logger.debug('[logUserActivity] Activity queued for offline sync:', action);
                return;
            } else {
                window.Logger.warn('[logUserActivity] Service worker not available for offline queueing');
                return;
            }
        }
        
        // Send to backend asynchronously when online
        window.Logger.debug('[logUserActivity] Sending log online:', action, enrichedDetails);
        
        const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?action=logActivity`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                username: username,
                logAction: action,
                details: JSON.stringify(enrichedDetails),
                userAgent: navigator.userAgent || 'Unknown'
            }),
            timeout: 5000 // 5 second timeout
        });
        
        if (!response.ok) {
            window.Logger.warn('[logUserActivity] Network response was not ok: ' + response.status);
            // Queue for retry if failed
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'QUEUE_ACTIVITY_LOG',
                    action: action,
                    username: username,
                    details: enrichedDetails,
                    userAgent: navigator.userAgent || 'Unknown'
                });
                window.Logger.debug('[logUserActivity] Failed log queued for retry:', action);
            }
            return;
        }
        
        const data = await response.json();
        if (data.status !== 'success') {
            window.Logger.warn('[logUserActivity] Backend error:', data.message);
            // Queue for retry if backend error
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'QUEUE_ACTIVITY_LOG',
                    action: action,
                    username: username,
                    details: enrichedDetails,
                    userAgent: navigator.userAgent || 'Unknown'
                });
            }
        } else {
            window.Logger.debug('[logUserActivity] Successfully logged:', action);
        }
    } catch (err) {
        window.Logger.warn('Error in logUserActivity:', err);
        // Queue for retry on any error
        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'QUEUE_ACTIVITY_LOG',
                    action: action || 'unknown',
                    username: window.currentUserName || 'Unknown',
                    details: {
                        ...details,
                        role: window.currentUserRole || 'unknown',
                        phc: window.currentUserPHC || 'Unknown',
                        timestamp: new Date().toISOString(),
                        error: err.message
                    },
                    userAgent: navigator.userAgent || 'Unknown'
                });
                window.Logger.debug('[logUserActivity] Error - activity queued for retry:', action);
            }
        } catch (queueErr) {
            window.Logger.warn('[logUserActivity] Could not queue activity log:', queueErr);
        }
    }
};

// =====================================================
// LOGOUT FUNCTION
// =====================================================

window.logout = function(options = {}) {
    window.Logger.debug('[Logout Function] Starting logout process...', options);
    const opts = options || {};
    let requiresHardReload = false;

    // Stop periodic session validation since user is logging out
    if (typeof window.stopPeriodicSessionValidation === 'function') {
        window.stopPeriodicSessionValidation();
    }

    try {
        // Reset viewer toggle state
        if (typeof window.allowAddPatientForViewer !== 'undefined') {
            window.allowAddPatientForViewer = false;
        }
        if (typeof window.setStoredToggleState === 'function') {
            window.setStoredToggleState(false);
        }
    } catch (err) {
        window.Logger.warn('Failed to persist viewer toggle state during logout:', err);
    }

    try {
        if (typeof window.clearSessionToken === 'function') {
            window.clearSessionToken();
        }
    } catch (err) {
        window.Logger.warn('Failed to clear session token during logout:', err);
    }

    // Clear global state
    window.currentUserRole = '';
    if (typeof window.currentUserName !== 'undefined') window.currentUserName = '';
    if (typeof window.currentUserPHC !== 'undefined') window.currentUserPHC = '';
    if (typeof window.currentUser !== 'undefined') window.currentUser = null;
    if (typeof window.userData !== 'undefined') window.userData = [];
    if (typeof window.patientData !== 'undefined') window.patientData = [];
    if (typeof window.followUpsData !== 'undefined') window.followUpsData = [];
    if (typeof window.lastDataFetch !== 'undefined') window.lastDataFetch = 0;

    try { if (typeof window.setPatientData === 'function') window.setPatientData([]); } catch (e) { /* ignore */ }
    try { if (typeof window.setFollowUpsData === 'function') window.setFollowUpsData([]); } catch (e) { /* ignore */ }

    // Clear patient list cache on logout
    try { 
        if (window.PatientListCache && typeof window.PatientListCache.clearCache === 'function') {
            window.PatientListCache.clearCache();
        }
    } catch (e) { 
        window.Logger.warn('Failed to clear patient list cache on logout:', e);
    }

    const dashboard = document.getElementById('dashboardScreen');
    const loginScreen = document.getElementById('loginScreen');
    window.Logger.debug('[Logout Function] Dashboard element:', !!dashboard, 'Login screen:', !!loginScreen);
    
    if (dashboard) {
        dashboard.style.display = 'none';
        window.Logger.debug('[Logout Function] Dashboard hidden');
    } else {
        requiresHardReload = true;
        window.Logger.warn('[Logout Function] Dashboard element not found!');
    }
    if (loginScreen) {
        loginScreen.style.display = 'flex';
        window.Logger.debug('[Logout Function] Login screen shown');
    } else {
        requiresHardReload = true;
        window.Logger.warn('[Logout Function] Login screen element not found!');
    }

    try { if (typeof window.hideLoader === 'function') window.hideLoader(); } catch (err) { /* ignore */ }

    if (!opts.silent && !opts.skipToast) {
        if (typeof window.showNotification === 'function') {
            window.showNotification('You have been logged out.', 'info');
        }
    }

    try {
        document.dispatchEvent(new CustomEvent('userLoggedOut'));
    } catch (err) {
        window.Logger.warn('Failed to dispatch userLoggedOut event:', err);
    }

    if (opts.hardRefresh || requiresHardReload) {
        window.Logger.debug('[Logout Function] Reloading page...');
        window.location.reload();
    } else {
        window.Logger.debug('[Logout Function] Logout complete (no reload)');
    }
};

// =====================================================
// STUB FUNCTIONS FOR LAZY-LOADED MODULES
// =====================================================

// Stub functions for analytics if not loaded
if (!window.initAdvancedAnalytics) {
    window.initAdvancedAnalytics = function() {
        window.Logger.warn('initAdvancedAnalytics not yet loaded');
    };
}

if (!window.loadAnalytics) {
    window.loadAnalytics = function() {
        window.Logger.warn('loadAnalytics not yet loaded');
    };
}

if (!window.applyFilters) {
    window.applyFilters = function() {
        window.Logger.warn('applyFilters not yet loaded');
    };
}

if (!window.destroyCharts) {
    window.destroyCharts = function() {
        window.Logger.warn('destroyCharts not yet loaded');
    };
}

if (!window.exportChartAsImage) {
    window.exportChartAsImage = function() {
        window.Logger.warn('exportChartAsImage not yet loaded');
    };
}

if (!window.exportAnalyticsCSV) {
    window.exportAnalyticsCSV = function() {
        window.Logger.warn('exportAnalyticsCSV not yet loaded');
    };
}

// Call this function after dependencies are loaded
window.onDependenciesLoaded = function() {
    if (typeof window.ensureFollowUpFunctions === 'function') {
        window.ensureFollowUpFunctions();
    }
};

// =====================================================
// PATIENT LIST CACHING UTILITIES
// =====================================================
// Cache patient list in localStorage for instant dashboard on repeat login
window.PatientListCache = {
    CACHE_KEY: 'epicare_patient_list_cache',
    CACHE_EXPIRY_KEY: 'epicare_patient_list_cache_expiry',
    CACHE_DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
    
    /**
     * Cache the patient list with timestamp
     * Called after fetching fresh patient data
     */
    cachePatientList: function(patients, limit = 50) {
        try {
            // Store up to 'limit' patients in localStorage for quick display
            const cacheObj = {
                patients: patients.slice(0, limit),
                fullCount: patients.length,
                timestamp: Date.now(),
                version: 1
            };
            localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheObj));
            localStorage.setItem(this.CACHE_EXPIRY_KEY, String(Date.now() + this.CACHE_DURATION_MS));
            window.Logger.debug('Patient list cached:', cacheObj.patients.length, 'of', fullCount);
            return true;
        } catch (err) {
            window.Logger.warn('Failed to cache patient list:', err);
            return false;
        }
    },
    
    /**
     * Get cached patient list if valid (not expired)
     * Returns null if cache doesn't exist or is expired
     */
    getCachedPatientList: function() {
        try {
            const expiry = Number(localStorage.getItem(this.CACHE_EXPIRY_KEY) || 0);
            // Check if cache exists and hasn't expired
            if (expiry && Date.now() <= expiry) {
                const cached = localStorage.getItem(this.CACHE_KEY);
                if (cached) {
                    const cacheObj = JSON.parse(cached);
                    window.Logger.debug('Using cached patient list:', cacheObj.patients.length, 'patients (full dataset:', cacheObj.fullCount, ')');
                    return cacheObj;
                }
            }
            return null;
        } catch (err) {
            window.Logger.warn('Failed to retrieve cached patient list:', err);
            return null;
        }
    },
    
    /**
     * Clear the patient list cache (called on logout)
     */
    clearCache: function() {
        try {
            localStorage.removeItem(this.CACHE_KEY);
            localStorage.removeItem(this.CACHE_EXPIRY_KEY);
            window.Logger.debug('Patient list cache cleared');
            return true;
        } catch (err) {
            window.Logger.warn('Failed to clear patient list cache:', err);
            return false;
        }
    }
};

window.Logger.debug('Globals and compatibility layer loaded');