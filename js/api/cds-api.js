/**
 * Epicare CDS API Client
 * Provides a clean interface for communicating with the CDS backend services
 * Handles caching, error handling, and response normalization
 */

// Use global API configuration

class CDSApiClient {
  constructor() {
    this.baseUrl = window.API_CONFIG ? window.API_CONFIG.MAIN_SCRIPT_URL : '';
    this.cache = new Map();
    // Track in-flight evaluate requests to deduplicate concurrent calls
    this._inFlightEvaluations = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes in milliseconds
    this.isOnline = navigator.onLine;
    this.retryAttempts = 3;
    this.retryDelay = 2000; // 2 seconds
    this.sessionId = this.generateSessionId();

    // Set up event listeners for online/offline status
    window.addEventListener('online', () => {
      this.isOnline = true;
      window.Logger.debug('CDS API client: Connection restored');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      window.Logger.debug('CDS API client: Connection lost');
    });
  }

  /**
   * Generate a unique session ID for caching and telemetry
   * @returns {string} Unique session ID
   */
  generateSessionId() {
    return 'session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Fetch CDS configuration from backend
   * @returns {Promise<Object>} CDS configuration
   */
  async getConfig() {
    try {
      const cacheKey = 'cds_config';
      
      // Check cache first
      const cachedConfig = this.getCachedItem(cacheKey);
      if (cachedConfig) {
        return cachedConfig;
      }
      
      // Use fetch for config retrieval (backend now returns CORS headers)
      const response = await this.fetchWithRetry(`${this.baseUrl}?action=cdsGetConfig`, { method: 'GET' });
      const result = await response.json();
      if (result.status !== 'success') {
        window.Logger.error('Failed to get CDS config:', result.message);
        return null;
      }
      // Cache and return result
      this.setCachedItem(cacheKey, result.data, 15 * 60 * 1000); // Cache for 15 minutes
      return result.data;
    } catch (error) {
      window.Logger.error('Error fetching CDS config:', error);
      return null;
    }
  }

  /**
   * Update CDS configuration (admin only)
   * @param {Object} config - Configuration updates
   * @returns {Promise<Object>} Updated configuration
   */
  async setConfig(config) {
    try {
      // Prepare request payload with proper structure for backend
      const payload = {
        action: 'cdsSetConfig',
        config: config,
        timestamp: new Date().toISOString()
      };
      
      // Send to backend
      // Use form-encoded body to avoid CORS preflight
      const params = new URLSearchParams();
      Object.keys(payload).forEach(k => params.append(k, typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : String(payload[k])));
      const response = await this.fetchWithRetry(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString()
      });
      
      // Process response
      const result = await response.json();
      if (result.status !== 'success') {
        window.Logger.error('Failed to update CDS config:', result.message);
        return { success: false, message: result.message };
      }
      
      // Clear config cache
      this.cache.delete('cds_config');
      
      return { success: true, data: result.data };
    } catch (error) {
      window.Logger.error('Error updating CDS config:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Evaluate patient data with CDS rules
   * @param {Object} patientContext - Patient data for evaluation
   * @returns {Promise<Object>} Evaluation results with warnings, prompts, and dose findings
   */
  async evaluatePatient(patientContext) {
    try {
      window.Logger.debug('CDS API: Starting evaluatePatient for patient', patientContext?.patientId);
      
      // Generate cache key based on patient data hash
      const patientHash = await this.hashObject(patientContext);
      const cacheKey = `cds_evaluate_${patientContext.patientId || ''}_${patientHash}`;
      
      // Check cache first
      const cachedResult = this.getCachedItem(cacheKey);
      if (cachedResult) {
        window.Logger.debug('CDS API: Returning cached result');
        return cachedResult;
      }

      // If a request for this same cacheKey is already in-flight, return the same promise
      if (this._inFlightEvaluations.has(cacheKey)) {
        window.Logger.debug('CDS API: Reusing in-flight evaluation request for cacheKey', cacheKey);
        return this._inFlightEvaluations.get(cacheKey);
      }
      
      // Normalize patient demographics before sending to backend to satisfy server validation
      // ENHANCED NORMALIZATION: Validate and normalize patient context comprehensively
      const pc = JSON.parse(JSON.stringify(patientContext || {})); // deep clone
      
      // Ensure structured v1.2 format
      if (!pc.demographics) pc.demographics = {};
      if (!pc.epilepsy) pc.epilepsy = {};
      if (!pc.regimen) pc.regimen = {};
      if (!pc.clinicalFlags) pc.clinicalFlags = {};
      
      // Normalize demographics
      const rawAge = pc.demographics.age !== undefined && pc.demographics.age !== null ? pc.demographics.age : pc.age;
      const ageNum = Number(rawAge);
      pc.demographics.age = (!isNaN(ageNum) && isFinite(ageNum) && ageNum >= 0 && ageNum <= 150) ? ageNum : null;

      // Normalize gender to canonical form
      const rawGender = (pc.demographics.gender || pc.gender || '').toString().trim();
      if (/^m(ale)?$/i.test(rawGender)) pc.demographics.gender = 'Male';
      else if (/^f(emale)?$/i.test(rawGender)) pc.demographics.gender = 'Female';
      else if (rawGender) pc.demographics.gender = 'Other';
      else pc.demographics.gender = null;
      
      // Normalize weight
      const rawWeight = pc.demographics.weightKg || pc.weightKg;
      const weightNum = Number(rawWeight);
      pc.demographics.weightKg = (!isNaN(weightNum) && isFinite(weightNum) && weightNum > 0) ? weightNum : null;
      
      // Normalize epilepsy type
      const rawEpilepsy = pc.epilepsy.epilepsyType || pc.epilepsyType || '';
      const canonicalEpilepsy = ['Focal', 'Generalized', 'Unknown'].includes(rawEpilepsy) ? rawEpilepsy : 'Unknown';
      pc.epilepsy.epilepsyType = canonicalEpilepsy;
      
      // Normalize medications with synonym mapping
      if (pc.regimen && pc.regimen.medications) {
        pc.regimen.medications = pc.regimen.medications.map(med => {
          if (typeof med === 'string') {
            return normalizeMedicationName(med) || med;
          } else if (med && typeof med === 'object') {
            const medName = med.name || med.medication || med.drug || '';
            med.name = normalizeMedicationName(medName) || medName;
            return med;
          }
          return med;
        }).filter(m => m); // Remove nulls
      }
      
      // Log normalization if changes were made
      if (pc.demographics.age !== Number(rawAge)) {
        window.Logger.debug('CDS: Age normalized from', rawAge, 'to', pc.demographics.age);
      }

      // Prepare base payload fields (patientContext is stringified when appended)
      const basePayload = {
        patientContext: JSON.stringify(pc),
        // Add user context for logging/audit purposes (not for authentication)
        username: window.currentUserName || 'unknown',
        role: window.currentUserRole || 'unknown',
        assignedPHC: window.currentUserPHC || '',
        authToken: window.currentUser?.token || '',
        clientVersion: '1.2.0',
        timestamp: new Date().toISOString()
      };
      const hasAuthToken = typeof basePayload.authToken === 'string' && basePayload.authToken.trim().length > 10;

      // Helper that posts with a given action and returns parsed JSON result
      const postEvaluate = async (actionName) => {
        const payloadObj = Object.assign({ action: actionName }, basePayload);
        const urlEncoded = new URLSearchParams();
        Object.keys(payloadObj).forEach(k => urlEncoded.append(k, payloadObj[k]));

        window.Logger.debug(`CDS API: Making POST request to backend (action=${actionName})`);
        const response = await this.fetchWithRetry(this.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: urlEncoded.toString()
        }, 60000);

        window.Logger.debug('CDS API: Received response, status:', response.status);
        const parsed = await response.json();
        window.Logger.debug('CDS API: Parsed response:', parsed);
        return { httpStatus: response.status, body: parsed };
      };

      // First try the session-gated endpoint (cdsEvaluate). If it fails with 401 auth error,
      // automatically retry the public wrapper (publicCdsEvaluate) to support browser clients.
  let evalResult = null;
  // We'll create a promise that represents this evaluation so we can dedupe concurrent callers
  const evaluationPromise = (async () => {
  try {
        if (hasAuthToken) {
          try {
            evalResult = await postEvaluate('cdsEvaluate');
          } catch (err) {
            const msg = (err && err.message) ? err.message : String(err);
            if (msg.indexOf('401') !== -1 || /Authentication required/i.test(msg)) {
              window.Logger.warn('CDS API: cdsEvaluate returned 401 or auth error, retrying publicCdsEvaluate');
              evalResult = await postEvaluate('publicCdsEvaluate');
            } else {
              throw err;
            }
          }
          if (evalResult && evalResult.body && evalResult.body.status && evalResult.body.status !== 'success') {
            const code = evalResult.body.code || 0;
            const msg = evalResult.body.message || '';
            if (code === 401 || /Authentication required/i.test(msg)) {
              window.Logger.warn('CDS API: cdsEvaluate responded with auth error, retrying publicCdsEvaluate');
              evalResult = await postEvaluate('publicCdsEvaluate');
            }
          }
        } else {
          window.Logger.debug('CDS API: No auth token detected, using publicCdsEvaluate directly');
          evalResult = await postEvaluate('publicCdsEvaluate');
        }
      } catch (finalErr) {
        window.Logger.error('CDS API: Evaluation failed after attempts:', finalErr);
        // Return an API error prompt with user-friendly message
        const userMsg = this.getErrorMessage(finalErr.code, finalErr.message);
        return {
          version: 'error',
          warnings: [],
          prompts: [{
            id: 'connectionError',
            severity: 'medium',
            message: userMsg,
            rationale: 'Connection error: ' + (finalErr && finalErr.message ? finalErr.message : String(finalErr))
          }],
          doseFindings: []
        };
      }

        const result = evalResult ? evalResult.body : { status: 'error', message: 'No response from CDS backend' };

        if (result.status !== 'success') {
          window.Logger.error('CDS API: Failed to evaluate patient data:', result.message);
          // Use user-friendly error message based on code
          const userMsg = this.getErrorMessage(result.code, result.message);
          return {
            version: 'error',
            warnings: [],
            prompts: [{
              id: 'apiError',
              severity: 'medium',
              message: userMsg,
              rationale: 'API error: ' + result.message
            }],
            doseFindings: []
          };
        }

        // Cache and return result
        this.setCachedItem(cacheKey, result.data, 5 * 60 * 1000); // Cache for 5 minutes
        window.Logger.debug('CDS API: Evaluation completed successfully');
        return result.data;
      })();

      // Store in-flight promise and ensure cleanup
      this._inFlightEvaluations.set(cacheKey, evaluationPromise);
      try {
        const finalData = await evaluationPromise;
        return finalData;
      } finally {
        this._inFlightEvaluations.delete(cacheKey);
      }
    } catch (error) {
      window.Logger.error('Error evaluating patient data:', error);
      return {
        version: 'error',
        warnings: [],
        prompts: [{
          id: 'connectionError',
          severity: 'medium',
          message: 'Failed to get clinical guidance due to connection issues',
          rationale: 'Connection error: ' + error.message
        }],
        doseFindings: []
      };
    }
  }

  /**
   * Get knowledge base metadata from backend
   * @returns {Promise<Object>} Knowledge base metadata
   */
  async getKnowledgeBaseMetadata() {
    try {
      const cacheKey = 'cds_kb_metadata';
      
      // Check cache first
      const cachedMetadata = this.getCachedItem(cacheKey);
      if (cachedMetadata) {
        return cachedMetadata;
      }
      
      // Use fetch for KB metadata retrieval (backend now returns CORS headers)
      // The backend provides KB metadata within the 'cdsGetConfig' action.
      const response = await this.fetchWithRetry(`${this.baseUrl}?action=cdsGetConfig`, { method: 'GET' });
      const result = await response.json();
      if (result.status !== 'success') {
        window.Logger.error('Failed to get KB metadata:', result.message);
        return null;
      }

      // Cache and return result
      this.setCachedItem(cacheKey, result.data, 60 * 60 * 1000); // Cache for 1 hour
      return result.data;
    } catch (error) {
      window.Logger.error('Error fetching KB metadata:', error);
      return null;
    }
  }

  /**
   * Log CDS events to backend
   * @param {Array} events - Array of event objects to log
   * @returns {Promise<boolean>} Success status
   */
  async logEvents(events) {
    try {
      // Don't attempt if offline
      if (!this.isOnline) {
        window.Logger.debug('Cannot log events: offline mode');
        return false;
      }
      
      // Prepare request payload with proper structure for backend
      const payload = {
        action: 'cdsLogEvents',
        events: Array.isArray(events) ? events : [events],
        timestamp: new Date().toISOString()
      };
      
      // Send to backend
      // Use form-encoded body to avoid CORS preflight
      const params = new URLSearchParams();
      Object.keys(payload).forEach(k => params.append(k, typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : String(payload[k])));
      try {
        const response = await this.fetchWithRetry(this.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: params.toString()
        });
        // Process response
        const result = await response.json();
        return result.status === 'success';
      } catch (err) {
        // If fetch fails due to CORS or network issues, fall back to a hidden form POST (no preflight)
        window.Logger.warn('logEvents fetch failed, attempting form POST fallback:', err && err.message ? err.message : err);
        try {
          this.sendFormPost(this.baseUrl, Object.fromEntries(params));
          // We cannot reliably detect server response from form POST in iframe; assume success for best-effort
          return true;
        } catch (formErr) {
          window.Logger.error('logEvents form POST fallback failed:', formErr);
          return false;
        }
      }
    } catch (error) {
      window.Logger.error('Error logging CDS events:', error);
      return false;
    }
  }

  /**
   * Send a form-encoded POST via a hidden iframe to avoid CORS preflight for write-only endpoints.
   * This is a best-effort delivery and does not surface the server response to the caller.
   * @param {string} url - Destination URL
   * @param {Object} fields - Key/value pairs to include in the form
   */
  sendFormPost(url, fields) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.style.display = 'none';
    // Add inputs
    Object.keys(fields || {}).forEach(k => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : String(fields[k]);
      form.appendChild(input);
    });

    // Create a unique iframe target so the form POST doesn't navigate the page
    const iframeName = 'cds_form_post_iframe_' + Math.random().toString(36).slice(2);
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    form.target = iframeName;
    document.body.appendChild(form);

    // Submit and cleanup shortly after
    form.submit();
    setTimeout(() => {
      try { document.body.removeChild(form); } catch (e) {}
      try { document.body.removeChild(iframe); } catch (e) {}
    }, 5000);
  }

  /**
   * Fetch with retry logic and timeout for reliability
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} timeout - Timeout in milliseconds (default 30000)
   * @returns {Promise<Response>} Fetch response
   */
  async fetchWithRetry(url, options = {}, timeout = 30000) {
    let attempts = 0;
    let lastError = null;
    
    while (attempts < this.retryAttempts) {
      try {
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Request timeout after ${timeout}ms`)), timeout);
        });
        
        // Race between fetch and timeout
        const response = await Promise.race([
          fetch(url, options),
          timeoutPromise
        ]);
        
        if (response.ok) {
          return response;
        }
        lastError = new Error(`HTTP error ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      
      attempts++;
      if (attempts < this.retryAttempts) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempts));
      }
    }
    
    throw lastError || new Error('Failed to fetch after multiple attempts');
  }

  /**
   * Get item from cache if not expired
   * @param {string} key - Cache key
   * @returns {Object|null} Cached item or null if expired/not found
   */
  getCachedItem(key) {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  /**
   * Set item in cache with expiry
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   * @param {number} ttl - Time to live in milliseconds
   */
  setCachedItem(key, data, ttl = this.cacheTimeout) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl
    });
  }

  /**
   * Clear specific item from cache
   * @param {string} key - Cache key
   */
  clearCacheItem(key) {
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clearCache() {
    this.cache.clear();
  }
  
  /**
   * Generate a hash for an object (for caching)
   * @param {Object} obj - Object to hash
   * @returns {Promise<string>} Hash string
   */
  async hashObject(obj) {
    try {
      // Convert object to string
      const objString = JSON.stringify(obj);
      
      // Use SubtleCrypto if available
      if (window.crypto && window.crypto.subtle) {
        const msgBuffer = new TextEncoder().encode(objString);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
      
      // Simple fallback hash function
      let hash = 0;
      for (let i = 0; i < objString.length; i++) {
        const char = objString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return hash.toString(36);
    } catch (error) {
      window.Logger.error('Error generating hash:', error);
      // Fallback to timestamp for uniqueness
      return Date.now().toString(36);
    }
  }
  
  /**
   * Get user-friendly error message based on error code
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @returns {string} User-friendly message
   */
  getErrorMessage(code, message) {
    if (!message) message = '';
    
    // Parse validation errors
    if (message.indexOf('Invalid patient context') !== -1 || message.indexOf('must be') !== -1) {
      return 'Please ensure all patient context fields are filled correctly: pregnancy status, renal function, and hepatic function must be set.';
    }
    
    // Network/connection errors
    if (code === 'timeout' || message.indexOf('timeout') !== -1) {
      return 'Request timed out. Please check your connection and try again.';
    }
    
    // Auth errors
    if (code === 401 || message.indexOf('Authentication') !== -1) {
      return 'Authentication required. Please log in again.';
    }
    
    // Generic backend error
    if (message) {
      return 'CDS evaluation failed: ' + message.substring(0, 100);
    }
    
    return 'Failed to get clinical guidance. Please try again.';
  }
  
  /**
   * PHASE 3: Get CDS health status and system metrics
   * @returns {Promise<Object>} Health status with cache stats
   */
  async getHealthStatus() {
    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}?action=cdsHealthCheck`, {
        method: 'GET'
      });
      const result = await response.json();
      return result.data || result;
    } catch (error) {
      window.Logger.error('[PHASE 3] Health check failed:', error);
      return { status: 'offline', error: error.toString() };
    }
  }
  
  /**
   * PHASE 3: Submit KB change request for approval
   * @param {Object} changeRequest - Configuration change details
   * @returns {Promise<Object>} Request ID and approval status
   */
  async requestKBChange(changeRequest) {
    try {
      const params = new URLSearchParams();
      params.append('action', 'cdsRequestKBChange');
      params.append('changeType', changeRequest.changeType);
      params.append('oldValue', JSON.stringify(changeRequest.oldValue || {}));
      params.append('newValue', JSON.stringify(changeRequest.newValue || {}));
      params.append('notes', changeRequest.notes || '');
      params.append('requestedBy', changeRequest.requestedBy || 'unknown');
      
      const response = await this.fetchWithRetry(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString()
      });
      
      const result = await response.json();
      return result.data || result;
    } catch (error) {
      window.Logger.error('[PHASE 3] KB change request failed:', error);
      return { status: 'error', message: error.toString() };
    }
  }
  
  /**
   * PHASE 4: Submit patient outcome data for effectiveness tracking
   * @param {Object} outcomeData - Outcome information
   * @returns {Promise<Object>} Outcome tracking response
   */
  async submitOutcomeData(outcomeData) {
    try {
      const params = new URLSearchParams();
      params.append('action', 'cdsRecordOutcome');
      params.append('patientIdHash', outcomeData.patientIdHash || '');
      params.append('recommendationId', outcomeData.recommendationId || '');
      params.append('followupDate', outcomeData.followupDate || '');
      params.append('seizureFrequencyPost', outcomeData.seizureFrequencyPost || '');
      params.append('adherenceScore', outcomeData.adherenceScore || '');
      params.append('tolerability', outcomeData.tolerability || '');
      params.append('adverseEvents', outcomeData.adverseEvents || '');
      params.append('recommendationFollowed', outcomeData.recommendationFollowed || 'unknown');
      params.append('clinicianNotes', outcomeData.clinicianNotes || '');
      
      const response = await this.fetchWithRetry(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString()
      });
      
      const result = await response.json();
      if (result.status === 'success') {
        window.Logger.debug('[PHASE 4] Outcome data recorded successfully');
      }
      return result.data || result;
    } catch (error) {
      window.Logger.error('[PHASE 4] Outcome submission failed:', error);
      return { status: 'error', message: error.toString() };
    }
  }
  
  /**
   * PHASE 4: Get effectiveness report for outcomes
   * @param {string} startDate - Start date (ISO format)
   * @param {string} endDate - End date (ISO format)
   * @returns {Promise<Object>} Effectiveness metrics and analytics
   */
  async getEffectivenessReport(startDate, endDate) {
    try {
      const cacheKey = `cds_effectiveness_${startDate}_${endDate}`;
      const cached = this.getCachedItem(cacheKey);
      if (cached) return cached;
      
      const params = new URLSearchParams();
      params.append('action', 'cdsGenerateOutcomeReport');
      params.append('startDate', startDate);
      params.append('endDate', endDate);
      
      const response = await this.fetchWithRetry(`${this.baseUrl}?${params.toString()}`, {
        method: 'GET'
      });
      
      const result = await response.json();
      if (result.status === 'success') {
        this.setCachedItem(cacheKey, result.data, 60 * 60 * 1000); // Cache for 1 hour
      }
      return result.data || result;
    } catch (error) {
      window.Logger.error('[PHASE 4] Effectiveness report failed:', error);
      return { status: 'error', message: error.toString() };
    }
  }
}

// Create a singleton instance of the API client
const cdsApi = new CDSApiClient();

// Make both the class and singleton instance globally available
window.CDSApiClient = CDSApiClient;
window.cdsApi = cdsApi;

if (window.Logger) {
  window.Logger.debug('CDS API client initialized - baseUrl:', cdsApi.baseUrl ? 'configured' : 'missing');
}