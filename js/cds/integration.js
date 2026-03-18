/**
 * Epicare Clinical Decision Support Integration Layer
 * Connects CDS backend endpoints with existing application components
 * Updated to use backend-first approach with server-side rule evaluation
 */

// Load CDS API and telemetry dependencies using script tags or global variables
// These should be loaded before this script in the HTML

// i18n helper – thin wrapper around EpicareI18n.translate (falls back to raw key)
function _t(key, params) {
    return window.EpicareI18n && window.EpicareI18n.translate ? window.EpicareI18n.translate(key, params) : key;
}

/**
 * ENHANCED MEDICATION NORMALIZATION: Standardized drug name/synonym mapping
 * This function resolves common medication name variations to canonical KB keys
 */
const MEDICATION_SYNONYM_MAP = {
  // Carbamazepine synonyms
  'carbamazepine': ['cbz', 'tegretol', 'carbatrol', 'epitol'],
  
  // Valproate synonyms
  'sodium valproate': ['valproate', 'valproic acid', 'depakote', 'vpa', 'sodium divalproex', 'divalproex'],
  
  // Phenytoin synonyms
  'phenytoin': ['dilantin', 'phenytek', 'fosphenytoin'],
  
  // Phenobarbital synonyms
  'phenobarbital': ['phenobarbitone', 'luminal', 'pbm'],
  
  // Levetiracetam synonyms
  'levetiracetam': ['keppra', 'levetiracetam', 'keppra xr'],
  
  // Lamotrigine synonyms
  'lamotrigine': ['lamictal', 'lamotrigine'],
  
  // Clobazam synonyms
  'clobazam': ['frisium', 'onfi', 'clb']
};

/**
 * Normalize a medication name to standard form
 * @param {string} medName - Raw medication name
 * @returns {string} Normalized medication name (canonical form)
 */
function normalizeMedicationName(medName) {
  if (!medName) return null;
  
  const normalized = medName.toString().trim().toLowerCase();
  
  // Check against synonym map
  for (const canonical in MEDICATION_SYNONYM_MAP) {
    const synonyms = MEDICATION_SYNONYM_MAP[canonical];
    if (normalized === canonical || synonyms.includes(normalized)) {
      return canonical;
    }
    // Partial match for compound names
    for (const synonym of synonyms) {
      if (normalized.includes(synonym) && synonym.length > 2) {
        return canonical;
      }
    }
  }
  
  // If no synonym match, return original
  return normalized;
}

/**
 * Module-level medication string parser used across the CDS integration.
 * Returns { name, dosage, frequency, dailyMg, notes } or null.
 */
function parseMedicationStringHelper(medString) {
  // Always return an array of parsed medication objects (possibly empty)
  if (!medString) return [];

  // Accept objects by attempting to stringify their key fields
  if (typeof medString === 'object') {
    const name = medString.name || medString.medication || medString.drug || medString.Name || '';
    const dose = medString.dosage || medString.dose || medString.dailyDose || '';
    medString = `${name} ${dose}`.trim();
  }

  if (typeof medString !== 'string') return [];

  const raw = medString.trim();
  if (!raw) return [];

  // Heuristic splits for multi-med strings. Order matters: prefer strong delimiters first.
  const splitRegex = /\s*\+\s*|;|\n|\s+&\s+|\s+and\s+|\s*\|\s*/i;
  let parts = raw.split(splitRegex).map(p => p.trim()).filter(Boolean);

  // If only one part, try splitting by comma only when it looks like multiple meds (both sides contain letters+digits)
  if (parts.length === 1 && raw.includes(',')) {
    const commaParts = raw.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length > 1) {
      // check heuristic: each part has at least one letter and one digit OR ends with common freq token
      const looksLikeMeds = commaParts.every(cp => /[a-zA-Z]/.test(cp) && /\d/.test(cp) || /\b(od|bd|tds|qid|hs|daily|once|twice|tid|bid)\b/i.test(cp));
      if (looksLikeMeds) {
        parts = commaParts;
      }
    }
  }

  const doseRegex = /(\d+(?:\.\d+)?)\s*(mg|g|ml|mcg|µg|ug|IU)?/i;
  const freqRegex = /\b(od|bd|tds|qid|qds|hs|daily|once(?: a day)?|twice(?: a day)?|three times|bid|tid)\b/i;
  const frequencyMap = { od:1, bd:2, tds:3, tid:3, qid:4, qds:4, daily:1 };

  const results = [];
  for (let part of parts) {
    if (!part) continue;

    // Preserve raw fragment
    const cleanPart = part.trim();

    // Keep compound strengths (e.g., 160/800) intact by using a regex that captures digits with optional /digits
    const doseMatch = cleanPart.match(/(\d+(?:\/\d+)?(?:\.\d+)?)(?:\s*(mg|g|ml|mcg|µg|ug|IU))?/i);
    const dosage = doseMatch ? (doseMatch[1] + (doseMatch[2] ? (' ' + doseMatch[2].toLowerCase()) : '')) : '';

    const freqMatch = cleanPart.match(freqRegex);
    const frequency = freqMatch ? freqMatch[0] : '';

    // derive name by removing dose/frequency and common syrup tokens
    let name = cleanPart.replace(doseRegex, '').replace(freqRegex, '').replace(/(syp\.?|syrup\.?)/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) {
      // fallback: take leading words until a digit is seen
      const m = cleanPart.match(/^([a-zA-Z\s]+)/);
      name = m ? m[0].trim() : cleanPart;
    }

    // compute approximate daily mg when possible (only meaningful for mg units)
    let dailyMg = null;
    if (doseMatch && /mg/i.test(doseMatch[2] || 'mg')) {
      const doseValue = parseFloat(doseMatch[1].toString().split('/')[0]);
      const f = (frequency || '').toLowerCase();
      const mult = frequencyMap[f] || 1;
      if (!isNaN(doseValue)) dailyMg = doseValue * mult;
    }

    // NORMALIZATION: Map to standard medication name
    const normalizedName = normalizeMedicationName(name) || name;
    
    results.push({
      name: normalizedName || cleanPart,
      normalizedName: normalizedName,
      originalName: name,
      dosage: dosage || '',
      frequency: frequency || '',
      dailyMg: dailyMg,
      notes: cleanPart,
      raw: cleanPart
    });
  }

  return results;
}

class CDSIntegration {
  constructor() {
    this.config = null;
    this.isInitialized = false;
    this.lastAnalyzedPatient = null;
    this.telemetry = window.CDSTelemetry ? new window.CDSTelemetry() : null;
    this.acknowledgedAlerts = new Set();
  }

  /**
   * CONTEXT-AWARE ALERT FILTERING: Suppress irrelevant alerts based on clinical context
   * Filters out prescribing/initiation counseling in follow-ups, redundant data quality warnings, etc.
   * @param {Object} alerts - Array of alerts to filter
   * @param {Object} context - Clinical context {isFollowUp, isInitialVisit, hasLastVisitDate, etc.}
   * @returns {Object} Filtered alerts
   */
  filterContextualAlerts(alerts, context = {}) {
    if (!Array.isArray(alerts)) return alerts;
    
    return alerts.filter(alert => {
      if (!alert) return true;
      
      const id = (alert.id || '').toLowerCase();
      const text = (alert.text || '').toLowerCase();
      
      // In follow-up visits, suppress:
      // 1. Prescribing/initiation counseling alerts (SJS/TEN, infection risk counseling)
      if (context.isFollowUp) {
        if (id.includes('sjs') || id.includes('ten') || id.includes('dermatologic')) return false;
        if (text.includes('counsel on sjs/ten') || text.includes('counsel on') && text.includes('risk')) return false;
      }
      
      // 2. Suppress redundant data quality warnings if data is actually present
      if (id.includes('data_quality')) {
        if (context.hasLastVisitDate && text.includes('last visit date')) return false;
        if (context.hasWeight && text.includes('weight')) return false;
        // Suppress generic data quality warnings in follow-up
        if (context.isFollowUp && id === 'data_quality_warnings') return false;
      }
      
      // 3. Suppress low-value informational alerts in follow-up context
      if (context.isFollowUp && alert.severity === 'info') {
        // Filter out purely educational/background information
        if (id.includes('recently_diagnosed') || id.includes('early_monitoring')) return false;
        if (text.includes('recently diagnosed') || text.includes('early monitoring phase')) return false;
        if (text.includes('6 months on treatment')) return false;
      }
      
      // 4. Suppress missing weight warning if weight-based calculations weren't needed
      if (id === 'missingweight' && context.hasWeight) return false;
      
      return true;
    });
  }

  /**
   * ENHANCED ALERT SUMMARIZATION: Organize and prioritize alerts for user
   * Groups alerts by clinical priority and returns top actionable items
   * @param {Object} evaluationResult - Raw evaluation result from backend
   * @param {Object} context - Clinical context for filtering
   * @returns {Object} Summarized evaluation with prioritized alerts
   */
  summarizeAlerts(evaluationResult, context = {}) {
    if (!evaluationResult) return evaluationResult;
    
    try {
      const summarized = JSON.parse(JSON.stringify(evaluationResult)); // Deep clone
      
      // Apply context-aware filtering first
      if (summarized.warnings) {
        summarized.warnings = this.filterContextualAlerts(summarized.warnings, context);
      }
      if (summarized.prompts) {
        summarized.prompts = this.filterContextualAlerts(summarized.prompts, context);
      }
      
      // Define alert priorities (lower score = higher priority)
      const priorityMap = {
        'critical': 0,
        'high': 1,
        'medium': 2,
        'info': 3
      };
      
      // Group alerts by category
      const categories = {
        safety: [],           // Critical safety issues (pregnancy, contraindications, severe DDI)
        dosing: [],           // Dose-related alerts
        monitoring: [],       // Monitoring/follow-up alerts
        treatment: [],        // Treatment pathway guidance
        information: []       // Educational information
      };
      
      // Categorize and score warnings
      if (summarized.warnings && Array.isArray(summarized.warnings)) {
        summarized.warnings.forEach(warning => {
          const priority = priorityMap[warning.severity] || 999;
          
          // Assign category
          if (warning.id && warning.id.includes('pregnancy')) {
            categories.safety.push({ ...warning, priority, displayOrder: priority });
          } else if (warning.id && (warning.id.includes('dose') || warning.id.includes('therapeutic'))) {
            categories.dosing.push({ ...warning, priority, displayOrder: priority });
          } else if (warning.id && warning.id.includes('interaction')) {
            categories.safety.push({ ...warning, priority, displayOrder: priority });
          } else if (warning.severity === 'critical' || warning.severity === 'high') {
            categories.safety.push({ ...warning, priority, displayOrder: priority });
          } else {
            categories.information.push({ ...warning, priority, displayOrder: priority });
          }
        });
      }
      
      // Sort each category by priority
      Object.keys(categories).forEach(cat => {
        categories[cat].sort((a, b) => a.priority - b.priority);
      });
      
      // Create summarized output
      summarized.alertSummary = {
        totalAlerts: (summarized.warnings || []).length + (summarized.prompts || []).length,
        criticalCount: (summarized.warnings || []).filter(w => w.severity === 'critical').length,
        highCount: (summarized.warnings || []).filter(w => w.severity === 'high').length,
        categories: categories,
        topActions: [
          ...categories.safety.slice(0, 2),
          ...categories.dosing.slice(0, 2),
          ...categories.monitoring.slice(0, 1)
        ].slice(0, 5) // Top 5 actions
      };
      
      return summarized;
    } catch (error) {
      window.Logger.warn('Alert summarization failed, returning raw result:', error);
      return evaluationResult;
    }
  }

  /**
   * Map error codes to user-friendly messages
   * @param {number} code - HTTP status code
   * @param {string} message - Original error message
   * @returns {string} User-facing error message
   */
  getErrorMessage(code, message) {
    const errorMessages = {
      429: _t('cds.error.tooManyRequests'),
      401: _t('cds.error.authFailed'),
      403: _t('cds.error.forbidden'),
      500: _t('cds.error.serverError'),
      503: _t('cds.error.serviceUnavailable')
    };
    
    if (errorMessages[code]) {
      return errorMessages[code];
    }
    
    if (message && message.includes('Invalid patient context')) {
      return _t('cds.error.noPatient');
    }
    
    return _t('cds.error.generic');
  }

  /**
   * Initialize CDS system by fetching configuration from backend
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    try {
      // Check if CDS API client is available
      if (!window.cdsApi) {
        // Fallback: Try to create it if CDSApiClient class is available
        if (window.CDSApiClient) {
          window.Logger.debug('CDS API client not instantiated - creating fallback instance');
          window.cdsApi = new window.CDSApiClient();
        } else {
          window.Logger.warn('CDS API client (cdsApi) not loaded - ensure cds-api.js is included in HTML');
          this.isInitialized = false;
          return false;
        }
      }

      // Check if CDS is globally enabled by fetching config from backend
      const config = await window.cdsApi.getConfig();
      
      if (!config) {
        window.Logger.debug('CDS backend unavailable or disabled');
        this.isInitialized = false;
        return false;
      }

      this.config = config;
      
      if (!this.config.enabled) {
        window.Logger.debug('CDS is globally disabled');
        return false;
      }

      // Get enhanced knowledge base metadata
      if (!window.cdsApi) {
        window.Logger.warn('CDS API client not available for KB metadata fetch');
        return false;
      }
      this.kbMetadata = await window.cdsApi.getKnowledgeBaseMetadata();
      if (!this.kbMetadata) {
        window.Logger.warn('Could not fetch KB metadata from backend');
      } else {
        window.Logger.debug('Enhanced knowledge base metadata retrieved successfully:', this.kbMetadata);
        
        // Check if we have the enhanced v1.2 structure
        if (this.kbMetadata.specialPopulationInfo || 
            this.kbMetadata.treatmentPathwayInfo) {
          window.Logger.debug('Using enhanced CDS v1.2 features');
          this.isEnhancedVersion = true;
        }
      }

      this.isInitialized = true;
      
      // Check KB version compatibility
      this.checkKBVersionCompatibility();
      
      // Validate and update knowledge base version with governance
      if (typeof window.cdsGovernance !== 'undefined') {
        const kbVersion = this.kbMetadata?.version || this.config.kbVersion;
        const validation = window.cdsGovernance.updateKnowledgeBaseVersion(
          kbVersion,
          'server'
        );
        window.Logger.debug('Knowledge base version validation:', validation);
      }
      
      window.Logger.debug(`CDS Integration initialized with backend version ${this.kbMetadata?.version || this.config.kbVersion}`);
      
      // Notify other components that CDS is ready
      window.dispatchEvent(new CustomEvent('cds-integration-ready', {
        detail: {
          knowledgeBaseVersion: this.kbMetadata?.version || this.config.kbVersion,
          isEnhanced: this.isEnhancedVersion,
          timestamp: new Date().toISOString()
        }
      }));

      // Update version display in UI
      this.updateVersionDisplay();
      
      // Connect epilepsy type update functionality with enhanced types if available
      this.connectEpilepsyTypeUpdates();

      // Attempt to flush any queued audit events
      try { await this.flushQueuedAuditEvents(); } catch (e) { window.Logger.warn('Failed to flush queued audit events', e); }
      
      return true;
    } catch (error) {
      window.Logger.error('Failed to initialize CDS Engine:', error);
      this.recordTelemetry('initialization_failed', { error: error.message });
      return false;
    }
  }

  /**
   * Log an audit event to the backend audit log
   * @param {string} eventType
   * @param {Object} eventData
   */
  async logAuditEvent(eventType, eventData = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      user: window.currentUser?.username || window.currentUser?.email || 'unknown',
      eventType,
      data: eventData
    };

    try {
      if (window.cdsApi && typeof window.cdsApi.logEvents === 'function') {
        return await window.cdsApi.logEvents([event]);
      } else if (typeof window.makeAPICall === 'function') {
        return await window.makeAPICall('cdsLogEvents', { events: [event] });
      } else {
        // queue locally for later flush
        const q = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
        q.push(event);
        localStorage.setItem('cds_audit_queue', JSON.stringify(q.slice(-200)));
        return true;
      }
    } catch (e) {
      window.Logger.warn('logAuditEvent failed:', e);
      // fallback to local queue
      const q = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
      q.push(event);
      localStorage.setItem('cds_audit_queue', JSON.stringify(q.slice(-200)));
      return false;
    }
  }

  /**
   * Log multiple audit events to the backend CDS audit sheet
   * @param {Array} events - Array of audit event objects
   */
  async logAuditEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return true;

    try {
      // Try to send via CDS API first
      if (window.cdsApi && typeof window.cdsApi.logEvents === 'function') {
        try {
          const ok = await window.cdsApi.logEvents(events);
          if (ok) {
            window.Logger.debug('✅ Audit events logged via cdsApi successfully:', events.length, 'events');
            return true;
          }
        } catch (apiErr) {
          window.Logger.warn('⚠️ cdsApi.logEvents failed:', apiErr.message || apiErr);
        }
      }
      
      // Use URLSearchParams format directly - same as successful follow-up and patient forms
      // This avoids the CORS preflight issues that JSON.stringify causes
      try {
        const urlEncoded = new URLSearchParams();
        urlEncoded.append('action', 'cdsLogEvents');
        urlEncoded.append('events', JSON.stringify(events));
        
        // Add session token if available
        const token = (typeof window.getSessionToken === 'function') ? window.getSessionToken() : '';
        if (token) {
          urlEncoded.append('sessionToken', token);
        }
        
        const response = await fetch(window.API_CONFIG.MAIN_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: urlEncoded.toString()
        });

        if (response.ok) {
          const result = await response.json();
          if (result && result.status === 'success') {
            window.Logger.debug('✅ Audit events logged successfully:', events.length, 'events sent to backend');
            return true;
          }
        }
      } catch (directApiErr) {
        window.Logger.warn('⚠️ Direct API call for cdsLogEvents failed:', directApiErr.message || directApiErr);
      }
      
      // Last resort: queue in localStorage for later flush
      const q = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
      const queuedCount = q.length + events.length;
      q.push(...events);
      localStorage.setItem('cds_audit_queue', JSON.stringify(q.slice(-500))); // Keep last 500 events
      window.Logger.debug('📦 Queued', events.length, 'audit events in localStorage (total queued:', Math.min(queuedCount, 500), ')');
      
      // Attempt to schedule a retry flush in the background
      this.scheduleAuditQueueFlush();
      
      return false; // Indicate offline/queued
    } catch (e) {
      window.Logger.error('❌ logAuditEvents error:', e.message || e);
      // Fallback to local queue
      try {
        const q = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
        q.push(...events);
        localStorage.setItem('cds_audit_queue', JSON.stringify(q.slice(-500)));
        window.Logger.debug('📦 Emergency fallback: queued', events.length, 'events');
      } catch (qErr) {
        window.Logger.error('❌ Failed to queue audit events:', qErr.message || qErr);
      }
      return false;
    }
  }

  /**
   * Schedule a background flush of queued audit events
   * Only schedules if not already scheduled in this session
   */
  scheduleAuditQueueFlush() {
    if (window._auditFlushScheduled) return;
    
    window._auditFlushScheduled = true;
    
    // Attempt flush after 5 seconds, then every 30 seconds
    setTimeout(() => {
      this.attemptAuditQueueFlush();
      // Schedule periodic retries
      setInterval(() => {
        this.attemptAuditQueueFlush();
      }, 30000); // Retry every 30 seconds
    }, 5000);
  }

  /**
   * Attempt to flush queued audit events to the backend
   * @private
   */
  async attemptAuditQueueFlush() {
    const queued = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
    if (!Array.isArray(queued) || queued.length === 0) return true;

    try {
      if (window.cdsApi && typeof window.cdsApi.logEvents === 'function') {
        try {
          const ok = await window.cdsApi.logEvents(queued);
          if (ok) {
            localStorage.removeItem('cds_audit_queue');
            window.Logger.debug('✅ Flushed queued audit events:', queued.length, 'events sent successfully');
            return true;
          }
        } catch (apiErr) {
          // Silent fail - will retry on next attempt
        }
      } 
      
      // Use URLSearchParams format directly - same as working API calls
      try {
        const urlEncoded = new URLSearchParams();
        urlEncoded.append('action', 'cdsLogEvents');
        urlEncoded.append('events', JSON.stringify(queued));
        
        // Add session token if available
        const token = (typeof window.getSessionToken === 'function') ? window.getSessionToken() : '';
        if (token) {
          urlEncoded.append('sessionToken', token);
        }
        
        const response = await fetch(window.API_CONFIG.MAIN_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: urlEncoded.toString()
        });

        if (response.ok) {
          const result = await response.json();
          if (result && result.status === 'success') {
            localStorage.removeItem('cds_audit_queue');
            window.Logger.debug('✅ Flushed queued audit events via direct API:', queued.length, 'events sent successfully');
            return true;
          }
        }
      } catch (apiErr) {
        // Silent fail - will retry on next scheduled attempt
      }
    } catch (e) {
      // Silent fail - will retry on next scheduled attempt
    }

    return false;
  }

  /**
   * Flush any queued audit events from localStorage to backend
   */
  async flushQueuedAuditEvents() {
    const queued = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
    if (!Array.isArray(queued) || queued.length === 0) {
      window.Logger.debug('📋 Audit queue is empty - nothing to flush');
      return true;
    }

    window.Logger.debug('🔄 Attempting to flush', queued.length, 'queued audit events...');

    try {
      if (window.cdsApi && typeof window.cdsApi.logEvents === 'function') {
        const ok = await window.cdsApi.logEvents(queued);
        if (ok) {
          localStorage.removeItem('cds_audit_queue');
          window.Logger.debug('✅ Successfully flushed queued audit events via cdsApi:', queued.length, 'events');
          return ok;
        }
      } else if (typeof window.makeAPICall === 'function') {
        await window.makeAPICall('cdsLogEvents', { events: queued });
        localStorage.removeItem('cds_audit_queue');
        window.Logger.debug('✅ Successfully flushed queued audit events via makeAPICall:', queued.length, 'events');
        return true;
      }
    } catch (e) {
      window.Logger.warn('⚠️ Flush queued audit events failed:', e.message || e);
      return false;
    }

    return false;
  }

  /**
   * Get CDS analysis for follow-up form data
   * @param {Object} formData - Follow-up form data
   * @returns {Promise<Object>} CDS analysis result
   */
  async analyzeFollowUpData(formData) {
    window.Logger.debug('CDS Integration: Starting analyzeFollowUpData for patient', formData?.ID);
    
    if (!this.isInitialized) {
      window.Logger.debug('CDS Integration: Initializing CDS integration');
      await this.initialize();
    }

    // If CDS is disabled, return empty result
    if (!this.config?.enabled) {
      window.Logger.debug('CDS Integration: CDS is disabled');
      return { 
        success: true, 
        warnings: [], 
        prompts: [], 
        doseFindings: [],
        version: this.config?.kbVersion || 'disabled',
        isEnabled: false
      };
    }

    // FRONTEND VALIDATION: Check for critical missing data before calling backend
    const validationWarnings = [];
    const missingCriticalFields = [];
    
    // Validate patient ID
    if (!formData?.ID && !formData?.patientId && !formData?.id) {
      validationWarnings.push({
        id: 'validation_missing_patient_id',
        severity: 'critical',
        text: _t('cds.validation.missingPatientId'),
        rationale: _t('cds.validation.missingPatientIdRationale'),
        nextSteps: [_t('cds.validation.missingPatientIdStep')]
      });
      missingCriticalFields.push('patientId');
    }
    
    // Validate weight (required for dose adequacy)
    const weight = formData?.Weight || formData?.weight || formData?.demographics?.weightKg;
    if (!weight || parseFloat(weight) <= 0) {
      validationWarnings.push({
        id: 'validation_weight_missing',
        severity: 'critical',
        text: _t('cds.validation.missingWeight'),
        rationale: _t('cds.validation.missingWeightRationale'),
        nextSteps: [
          _t('cds.validation.missingWeightStep1'),
          _t('cds.validation.missingWeightStep2'),
          _t('cds.validation.missingWeightStep3')
        ]
      });
      missingCriticalFields.push('weight');
    }
    
    // Validate age (required for age-specific recommendations)
    const age = formData?.Age || formData?.age || formData?.demographics?.age;
    if (!age || parseInt(age) <= 0 || parseInt(age) > 120) {
      validationWarnings.push({
        id: 'validation_age_invalid',
        severity: 'high',
        text: _t('cds.validation.invalidAge'),
        rationale: _t('cds.validation.invalidAgeRationale'),
        nextSteps: [_t('cds.validation.invalidAgeStep')]
      });
      missingCriticalFields.push('age');
    }
    
    // Validate medications (at least one medication expected for epilepsy patients)
    const medications = formData?.Medications || formData?.medications;
    if (!medications || (Array.isArray(medications) && medications.length === 0) || 
        (typeof medications === 'string' && medications.trim().length === 0)) {
      validationWarnings.push({
        id: 'validation_no_medications',
        severity: 'high',
        text: _t('cds.validation.noMedications'),
        rationale: _t('cds.validation.noMedicationsRationale'),
        nextSteps: [
          _t('cds.validation.noMedicationsStep1'),
          _t('cds.validation.noMedicationsStep2'),
          _t('cds.validation.noMedicationsStep3')
        ]
      });
      missingCriticalFields.push('medications');
    }
    
    // If critical validation errors, return early without calling backend
    if (validationWarnings.some(w => w.severity === 'critical')) {
      window.Logger.warn('CDS Integration: Critical validation errors detected, blocking backend call', validationWarnings);
      return {
        success: false,
        warnings: validationWarnings,
        prompts: [],
        doseFindings: [],
        version: this.config?.kbVersion || 'unknown',
        dataQuality: {
          missingCriticalFields: missingCriticalFields,
          completeness: 0,
          validationBlocked: true
        }
      };
    }

    try {
  window.Logger.debug('CDS Integration: Transforming follow-up data to patient context');
      // Transform follow-up form data to patient context format
      const patientContext = this.transformFollowUpDataToPatientContext(formData);
      const missingLastVisitInfo = patientContext?.followUp && (patientContext.followUp.daysSinceLastVisit === null || patientContext.followUp.daysSinceLastVisit === undefined);
      if (missingLastVisitInfo) {
        const warning = {
          id: 'missing_last_visit_date',
          severity: 'medium',
          text: _t('cds.validation.missingLastVisitDate'),
          rationale: _t('cds.validation.missingLastVisitDateRationale')
        };
        return {
          success: true,
          warnings: [warning],
          prompts: [],
          doseFindings: [],
          version: this.kbMetadata?.version || this.config?.kbVersion || 'unknown',
          dataQuality: {
            missingFields: ['followUp.daysSinceLastVisit'],
            completeness: 0
          }
        };
      }
  window.Logger.debug('CDS Integration: transformed patientContext:', patientContext);
      
      // Start timing for performance measurement
      const startTime = performance.now();
      window.Logger.debug('CDS Integration: Calling backend CDS evaluation API');
      
      // Call backend CDS evaluation via API client
      if (!window.cdsApi || typeof window.cdsApi.evaluatePatient !== 'function') {
        throw new Error('CDS API client (cdsApi.evaluatePatient) is not available');
      }
      const result = await window.cdsApi.evaluatePatient(patientContext);
      window.Logger.debug('CDS Integration: backend result from cdsApi.evaluatePatient:', result);
      const duration = performance.now() - startTime;
      
      window.Logger.debug('CDS Integration: Backend API call completed in', duration, 'ms, result:', result);
      
      if (!result) {
        throw new Error('CDS evaluation returned null result');
      }

  // Perform enhanced dose analysis using canonical formulary data
      window.Logger.debug('CDS Integration: Using backend-provided CDS outputs when available');

      // Prefer backend-provided dose findings. Only compute local dose analysis as a
      // fallback when offline (or when server did not return doseFindings).
  let enhancedDoseFindings = [];
      if (result && Array.isArray(result.doseFindings) && result.doseFindings.length > 0) {
        enhancedDoseFindings = result.doseFindings;
      } else if (this.isOffline) {
        window.Logger.debug('CDS Integration: offline - running local dose analysis fallback');
        // Prefer backend KB if available
        const formulary = (this.kbMetadata && this.kbMetadata.formulary) ? this.kbMetadata.formulary : (typeof getFormularyData === 'function' ? getFormularyData() : {});
        enhancedDoseFindings = this.analyzeMedicationDoses(
          patientContext.regimen?.medications || [],
          patientContext.demographics,
          formulary
        );
      } else {
        enhancedDoseFindings = [];
      }

      // Prefer backend-provided treatment recommendations; only generate locally when offline
      let treatmentRecommendations = {};
      if (result && result.treatmentRecommendations && Object.keys(result.treatmentRecommendations).length > 0) {
        treatmentRecommendations = result.treatmentRecommendations;
      } else if (this.isOffline) {
        window.Logger.debug('CDS Integration: offline - generating local treatment recommendations as fallback');
        treatmentRecommendations = this.generateTreatmentRecommendations(patientContext, enhancedDoseFindings);
      } else {
        treatmentRecommendations = {};
      }

      // Normalize backend alerts into severity buckets then map back to legacy structures for UI reuse
      const alertBuckets = this.normalizeAlertBuckets(result);
      const flattenedStandardAlerts = this.flattenAlertBuckets(alertBuckets);
      const legacyAlerts = flattenedStandardAlerts
        .map(alert => this.convertStandardAlertToLegacy(alert))
        .filter(Boolean);

      const warningsArray = legacyAlerts.filter(alert => this.isHighSeverity(alert.severity));
      const promptsArray = legacyAlerts.filter(alert => !this.isHighSeverity(alert.severity));
      
      // Log each individual rule firing to the CDS audit sheet
      try {
        const allAlerts = [...warningsArray, ...promptsArray];
        const patientIdRaw = patientContext.patientId ? String(patientContext.patientId) : (patientContext.id ? String(patientContext.id) : null);
        const patientIdHint = patientIdRaw ? patientIdRaw.slice(-3) : 'xxx';
        
        const auditEventsList = allAlerts.map(alert => ({
          timestamp: new Date().toISOString(),
          username: window.currentUser?.username || window.currentUser?.email || 'unknown',
          role: window.currentUser?.role || 'unknown',
          phc: window.currentUser?.assignedPHC || window.currentUser?.facility || 'unknown',
          eventType: 'cds_rule_fired',
          ruleId: alert.ruleId || alert.id || 'unknown',
          severity: alert.severity || 'medium',
          action: 'rule_triggered',
          patientHint: patientIdHint,
          version: result.version || this.config?.kbVersion || 'unknown'
        }));
        
        // Send individual rule firings to backend audit log
        if (auditEventsList.length > 0) {
          this.logAuditEvents(auditEventsList);
        }
      } catch (e) {
        window.Logger.warn('Failed to log individual CDS rule firings:', e);
      }
      
      const recommendationsList = Array.isArray(result.recommendationsList) && result.recommendationsList.length
        ? result.recommendationsList
        : (treatmentRecommendations.recommendationsList || promptsArray);

      let analysis = {
        success: result.success !== false,
        warnings: warningsArray,
        prompts: promptsArray,
        alerts: legacyAlerts,
        alertsBySeverity: alertBuckets,
        doseFindings: enhancedDoseFindings.length > 0 ? enhancedDoseFindings : (result.doseFindings || []),
        version: result.version,
        treatmentRecommendations: treatmentRecommendations,
        plan: result.plan || treatmentRecommendations.plan || {},
        recommendationsList,
        specialConsiderations: result.specialConsiderations || [],
        dataQuality: result.dataQuality || { missingFields: [], completeness: 100 },
        metadata: result.metadata || {},
        standardResponse: result
      };

      this.applyDoseAdjustmentSafetyGates(analysis, patientContext);
      this.applySideEffectDrivenDecisions(analysis, patientContext);
      this.applyChronicMonitoringRules(analysis, patientContext);
      this.applyAdherenceInterventions(analysis, patientContext);
      this.applyPolytherapyRationalityChecks(analysis, patientContext);
      
      // Note: Psychosocial screening (NDDI-E) is now handled by separate module (psychosocial-screening.js)
      // to keep CDS focused on clinical decision support, not mental health screening
      
      // Store for telemetry AFTER analysis is created
      this.lastAnalyzedPatient = patientContext;
      this.lastAnalysisResult = analysis;

      // Filter out acknowledged alerts
      analysis.warnings = analysis.warnings.filter(warning => 
        !this.acknowledgedAlerts.has(warning.id)
      );
      
      analysis.prompts = analysis.prompts.filter(prompt => 
        !this.acknowledgedAlerts.has(prompt.id)
      );
      
      // For v1.2: Check if we have enhanced data and this is the enhanced version
      if (this.isEnhancedVersion && (
          (analysis.treatmentRecommendations && (
            analysis.treatmentRecommendations.monotherapySuggestion ||
            analysis.treatmentRecommendations.addonSuggestion ||
            (analysis.treatmentRecommendations.regimenChanges && analysis.treatmentRecommendations.regimenChanges.length > 0) ||
            (analysis.treatmentRecommendations.specialConsiderations && analysis.treatmentRecommendations.specialConsiderations.length > 0)
          )) ||
          (analysis.doseFindings && analysis.doseFindings.length > 0)
        )) {
        window.Logger.debug('Rendering enhanced CDS v1.2 output');
        this.renderEnhancedCDSOutput(analysis);
      }
      
      // Re-generate alerts array after filtering
      analysis.alerts = [...analysis.warnings, ...analysis.prompts];

      // Record telemetry (guarded)
      if (this.telemetry && typeof this.telemetry.recordEvent === 'function') {
        try {
          this.telemetry.recordEvent('cds_analysis_completed', {
            duration,
            warningCount: warningsArray.length,
            promptCount: promptsArray.length,
            doseCount: analysis.doseFindings.length,
            filteredWarningCount: analysis.warnings.length,
            filteredPromptCount: analysis.prompts.length,
            version: result.version,
            patientIdHash: patientContext.patientId ? patientContext.patientId.toString().slice(-3) : 'unknown'
          });
        } catch (err) { window.Logger.warn('Telemetry recordEvent failed:', err); }
      }

      // Record audit event to backend audit log if available
      try {
        // Sanitize audit payload: do not send raw patient context. Send only hashed patientId hint and summary.
        const hashString = (str) => {
          // simple non-cryptographic hash (djb2) producing hex string for compact hint
          let h = 5381;
          for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
            h = h & 0xFFFFFFFF;
          }
          // convert to unsigned and hex
          return (h >>> 0).toString(16).padStart(8, '0');
        };

        const patientIdRaw = patientContext.patientId ? String(patientContext.patientId) : (patientContext.id ? String(patientContext.id) : null);
        const patientIdHint = patientIdRaw ? hashString(patientIdRaw) : null;

        const auditEvent = {
          timestamp: new Date().toISOString(),
          user: window.currentUser?.username || window.currentUser?.email || 'unknown',
          eventType: 'cds_analysis_completed',
          patientIdHint: patientIdHint,
          patientHint: patientContext.patientName ? String(patientContext.patientName).slice(0,32) : this.generatePatientHint(patientContext),
          kbVersion: result.version || this.config?.kbVersion,
          summary: {
            warningCount: warningsArray.length,
            promptCount: promptsArray.length,
            doseFindings: analysis.doseFindings.length
          }
        };

        // Prefer cdsApi.logEvents if available
        if (window.cdsApi && typeof window.cdsApi.logEvents === 'function') {
          window.cdsApi.logEvents([auditEvent]).catch(e => window.Logger.warn('Failed to write CDS audit event via cdsApi.logEvents', e));
        } else if (typeof window.makeAPICall === 'function') {
          // fallback to generic API wrapper
          window.makeAPICall('cdsLogEvents', { events: [auditEvent] }).catch(e => window.Logger.warn('Failed to write CDS audit event via makeAPICall', e));
        } else {
          // as last resort store in local storage for later flush
          const queued = JSON.parse(localStorage.getItem('cds_audit_queue') || '[]');
          queued.push(auditEvent);
          localStorage.setItem('cds_audit_queue', JSON.stringify(queued.slice(-200))); // keep last 200
        }
      } catch (e) {
        window.Logger.warn('CDS audit logging failed:', e);
      }

      window.Logger.debug('CDS Integration: Analysis completed successfully, returning result');
      
      // DETECT CLINICAL CONTEXT for alert filtering
      const isFollowUp = !!(patientContext?.followUp || document.getElementById('lastVisitDate'));
      const hasLastVisitDate = !!(patientContext?.followUp?.lastVisitDate || 
                                   formData?.LastVisitDate || 
                                   document.getElementById('lastVisitDate')?.value);
      const hasWeight = !!(patientContext?.demographics?.weightKg && patientContext.demographics.weightKg > 0);
      const isInitialVisit = !isFollowUp || (patientContext?.followUp?.visitCount || 0) === 1;
      
      const cdsContext = {
        isFollowUp,
        isInitialVisit,
        hasLastVisitDate,
        hasWeight
      };
      
      // ENHANCED ALERT SUMMARIZATION: Organize alerts for user clarity with context-aware filtering
      analysis = this.summarizeAlerts(analysis, cdsContext);
      
      // Update streamlined CDS display if in follow-up context
      if (document.getElementById('recommendationsContent') && typeof window.updateStreamlinedCDSDisplay === 'function') {
        window.Logger.debug('CDS Integration: Updating streamlined display from analyzeFollowUpData');
        window.updateStreamlinedCDSDisplay(analysis);
      }
      
      return analysis;
    } catch (error) {
      window.Logger.error('CDS Analysis failed:', error);
      this.recordTelemetry('analysis_failed', { error: error.message });
      
      // Return offline fallback if available
      if (this.isOffline) {
        return { 
          success: true, 
          warnings: [{ 
            id: 'offline_warning', 
            severity: 'INFO', 
            text: _t('cds.error.offlineUnavailable') 
          }], 
          prompts: [], 
          doseFindings: [],
          isOffline: true
        };
      }
      
      return { success: false, error: error.message };
    }
  }

  // Fetch and render high-risk dashboard (calls backend endpoint)
  async fetchAndShowHighRiskDashboard() {
    try {
      let res = null;
      if (window.cdsApi && typeof window.cdsApi.scanHighRiskPatients === 'function') {
        res = await window.cdsApi.scanHighRiskPatients();
      } else if (typeof window.makeAPICall === 'function') {
        res = await window.makeAPICall('cdsScanHighRiskPatients', {});
      } else {
        throw new Error('No API client available to fetch high-risk patients');
      }
      const rows = res && res.data ? res.data : [];
      if (typeof this.renderHighRiskModal === 'function') {
        this.renderHighRiskModal(rows);
      } else if (window.cdsIntegration && typeof window.cdsIntegration.renderHighRiskModal === 'function') {
        window.cdsIntegration.renderHighRiskModal(rows);
      } else {
        window.Logger.warn('No renderer for high-risk modal found.');
      }
    } catch (e) {
      window.Logger.error('fetchAndShowHighRiskDashboard failed:', e);
    }
  }

  openHighRiskDashboard() {
    this.fetchAndShowHighRiskDashboard();
  }

  /**
   * Transform follow-up form data to backend patient context format
   * @param {Object} formData - Follow-up form data
   * @returns {Object} Patient context for backend
   */
  transformFollowUpDataToPatientContext(formData) {
    // Build a v1.2-compliant patientContext. Accepts either a follow-up form object or an existing patient record.
    // Use a small helper to pick the first defined, non-null value from a list of possible property names.
    const src = formData || {};

    // Helper to safely parse boolean values from various string/boolean inputs
    const parseBool = (val) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'string') return ['true', 'yes', '1'].includes(val.toLowerCase());
        return !!val;
    };
    const pickFirst = (...keys) => {
      for (let k of keys) {
        // support nested access via dot notation
        if (k.includes('.')) {
          const parts = k.split('.');
          let v = src;
          for (const p of parts) {
            if (v == null) break;
            v = v[p];
          }
          if (v !== undefined && v !== null && v !== '') return v;
        } else {
          if (src[k] !== undefined && src[k] !== null && src[k] !== '') return src[k];
        }
      }
      return undefined;
    };

    // v1.2 normalization helpers for adherence and frequency
    // Delegate to canonical adherence from utils.js
    const normalizeAdherence = (val) => {
      const canonical = window.canonicalizeAdherence(val);
      // Map to uppercase format for v1.2 API compatibility
      if (canonical === 'Always take') return 'ALWAYS';
      if (canonical === 'Occasionally miss') return 'OCCASIONAL';
      if (canonical === 'Frequently miss') return 'FREQUENT';
      if (canonical === 'Completely stopped medicine') return 'STOPPED';
      return null;
    };

    const frequencyOrder = ['LESS_THAN_YEARLY','YEARLY','MONTHLY','WEEKLY','DAILY'];
    const normalizeFrequencyLabel = (val) => {
      if (val === null || val === undefined) return null;
      const s = String(val).trim().toLowerCase();
      if (!s) return null;
      if (s.includes('less')) return 'LESS_THAN_YEARLY';
      if (s.includes('year')) return 'YEARLY';
      if (s.includes('month')) return 'MONTHLY';
      if (s.includes('week')) return 'WEEKLY';
      if (s.includes('day')) return 'DAILY';
      return null;
    };

    const daysBetween = (a, b) => {
      const MS = 24*60*60*1000;
      return Math.max(1, Math.round((b - a) / MS));
    };

    const computeFrequencyFromSeizureCount = (count, lastDateISO, now = new Date()) => {
      const n = Math.max(0, Number(count) || 0);
      if (!lastDateISO) return null;
      const last = new Date(lastDateISO);
      if (isNaN(last.getTime())) return null;
      const d = Math.min(365, daysBetween(last, now));
      const ratePerDay = n / d;
      if (ratePerDay >= 1) return 'DAILY';
      if (ratePerDay >= (1/7)) return 'WEEKLY';
      if (ratePerDay >= (1/30)) return 'MONTHLY';
      if (ratePerDay >= (1/365)) return 'YEARLY';
      return 'LESS_THAN_YEARLY';
    };

    const compareFrequencies = (a, b) => {
      const ai = frequencyOrder.indexOf(a);
      const bi = frequencyOrder.indexOf(b);
      if (ai === -1 || bi === -1) return null;
      return ai - bi; // >0 means a worse than b (more frequent)
    };

    // **v1.2 FIX: Robust Age and Gender Normalization**
    // IMPORTANT: Do NOT use AgeOfOnset as fallback for current age — they are different fields
    const rawAge = pickFirst('Age', 'age', 'patientAge', 'demographics.age');
    // Ensure rawAge is not an empty string before parsing.
    const parsedAge = (rawAge !== undefined && rawAge !== null && String(rawAge).trim() !== '') ? parseInt(rawAge, 10) : null;

    // Age of onset — separate clinical field (Patients sheet column)
    const rawAgeOfOnset = pickFirst('AgeOfOnset', 'ageOfOnset', 'age_of_onset', 'demographics.ageOfOnset');
    const parsedAgeOfOnset = (rawAgeOfOnset !== undefined && rawAgeOfOnset !== null && String(rawAgeOfOnset).trim() !== '') ? parseInt(rawAgeOfOnset, 10) : null;

    let rawGender = pickFirst('Gender', 'gender', 'sex', 'demographics.gender') || '';
    rawGender = String(rawGender).trim();
    // Normalize gender to backend-expected values: 'Male' | 'Female' | 'Other'
    let normalizedGender = null;
    if (/^m(ale)?$/i.test(rawGender)) normalizedGender = 'Male';
    else if (/^f(emale)?$/i.test(rawGender)) normalizedGender = 'Female';
    else if (rawGender) normalizedGender = 'Other';

    const demographics = {
      // Prefer sheet column names: Age, Gender, Weight. Ensure age is a number or null.
      age: isNaN(parsedAge) ? null : parsedAge,
      gender: normalizedGender || 'Other',
      weightKg: parseFloat(pickFirst('Weight', 'weight', 'bodyWeight', 'demographics.weightKg')) || null,
      pregnancyStatus: this.normalizePregnancyStatus(pickFirst('pregnancyStatus', 'pregnancy.status', 'Pregnancy')),
      reproductivePotential: parseBool(pickFirst('reproductivePotential', 'flags.reproductivePotential')),
      ageOfOnset: isNaN(parsedAgeOfOnset) ? null : parsedAgeOfOnset
    };

  const epilepsy = {
      // Use provided epilepsyType or epilepsyCategory
      epilepsyType: pickFirst('epilepsyType', 'EpilepsyType', 'epilepsy.epilepsyType', 'epilepsy.type') || pickFirst('epilepsyCategory') || 'unknown',
      epilepsyCategory: pickFirst('epilepsyCategory') || null,
      seizureFrequency: pickFirst('SeizureFrequency', 'seizureFrequency') || null,
      baselineFrequency: pickFirst('baselineFrequency', 'baseline_frequency', 'SeizureFrequency', 'seizureFrequency') || null
    };

    // Normalize medications into array of { name, dosage, route, frequency }
    const meds = [];
    // Prefer sheet header 'Medications' (may be string like "Drug A 50mg, Drug B 100mg")
    let rawMeds = pickFirst('Medications', 'medications', 'MedicationsList') || src.Medications || src.medications || pickFirst('currentMedications') || [];

    // If Medications is a string (sheet cell), split by common delimiters
    if (typeof rawMeds === 'string') {
      rawMeds = rawMeds.split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean);
    }

    (rawMeds || []).forEach(m => {
      if (!m) return;
  if (typeof m === 'string') {
  const parsedArr = parseMedicationStringHelper(m) || [];
  parsedArr.forEach(parsed => meds.push({ name: parsed?.name || m, dosage: parsed?.dosage || '', route: '', frequency: parsed?.frequency || '', dailyMg: parsed?.dailyMg || null }));
      } else if (typeof m === 'object') {
        const nameField = pickFirst.call({ src: m }, 'name', 'medication', 'drug', 'Name', 'Medication', 'Drug') || m.name || m.medication || m.drug || '';
        const dosageField = m.dosage || m.dose || m.dailyDose || '';
        const combined = `${nameField || ''} ${dosageField || ''}`.trim();
        const parsedArr = parseMedicationStringHelper(combined || (m.name || '')) || [];
          if (parsedArr.length > 0) {
          parsedArr.forEach(parsed => meds.push({ name: parsed?.name || (nameField || ''), dosage: parsed?.dosage || (dosageField || ''), route: m.route || m.adminRoute || '', frequency: parsed?.frequency || m.frequency || m.freq || '', dailyMg: parsed?.dailyMg || m.dailyMg || null }));
        } else {
          meds.push({ name: String(nameField || '').toString(), dosage: dosageField, route: m.route || m.adminRoute || '', frequency: m.frequency || m.freq || '', dailyMg: m.dailyMg || null });
        }
      }
    });

    // Build comorbidities object (try to parse string or use object provided)
    let comorbidities = {};
    const rawComorb = pickFirst('comorbidities') || src.comorbidities;
    if (typeof rawComorb === 'string') {
      try { comorbidities = JSON.parse(rawComorb); } catch (e) { comorbidities = { freeText: rawComorb }; }
    } else if (typeof rawComorb === 'object') {
      comorbidities = rawComorb;
    } else {
      // try to derive common flags
      comorbidities = {
        renal: !!(pickFirst('renalFunction') && pickFirst('renalFunction') !== 'normal'),
        hepatic: !!(pickFirst('hepaticFunction') && pickFirst('hepaticFunction') !== 'normal')
      };
    }

    const flags = {
      reproductivePotential: this.isReproductiveAge(src) || !!pickFirst('flags.reproductivePotential', 'flags.reproductivePotential'),
      failedTwoAdequateTrials: parseBool(pickFirst('failedTwoAdequateTrials', 'clinicalFlags.failedTwoAdequateTrials')) || false,
      adherenceConcerns: parseBool(pickFirst('adherenceConcerns', 'clinicalFlags.adherenceConcerns')) || false,
      recentAdverseEffects: parseBool(pickFirst('recentAdverseEffects', 'clinicalFlags.recentAdverseEffects')) || false
    };

    const clinicalContext = {
      renalFunction: this.normalizeRenalFunction(pickFirst('renalFunction', 'clinicalFlags.renalFunction')),
      hepaticFunction: this.normalizeHepaticFunction(pickFirst('hepaticFunction', 'clinicalFlags.hepaticFunction')),
      adherencePattern: pickFirst('treatmentAdherence', 'adherencePattern', 'clinicalFlags.adherencePattern') || null,
      adverseEffects: pickFirst('adverseEffects', 'clinicalFlags.adverseEffects') || null
    };

    // Women's health specific flags from the follow-up form
    const hormonalContraception = parseBool(pickFirst('hormonalContraception', 'usesHormonalContraception', 'contraception', 'contraceptiveUse')) || false;
    const irregularMenses = parseBool(pickFirst('irregularMenses', 'irregular_menses', 'menstrualIrregularity')) || false;
    const weightGain = parseBool(pickFirst('weightGain', 'weight_gain', 'recentWeightGain')) || false;
    const catamenialPattern = parseBool(pickFirst('catamenialPattern', 'catamenial_pattern', 'seizuresAroundMenses')) || false;

  // If reproductivePotential is not explicitly provided, derive it.
  // Ensure gender comparisons are case-insensitive and handle normalized values.
  if (demographics.reproductivePotential === undefined || demographics.reproductivePotential === null) {
    const age = demographics.age;
    const gender = (demographics.gender || '').toString().toLowerCase();
    demographics.reproductivePotential = (gender === 'female' || gender === 'f' || gender === 'female') && age >= 12 && age <= 50;
  };

    // Build v1.2 nested patientContext with regimen, clinicalFlags and follow-up information
    const patientContext = {
      // Map sheet ID and PatientName directly
      patientId: pickFirst('ID', 'patientId', 'id') || null,
      patientName: pickFirst('PatientName', 'Patient Name', 'patientName') || pickFirst('Patient_Name') || null,
      // Patients sheet column
      registrationDate: pickFirst('RegistrationDate', 'registrationDate', 'RegisteredOn', 'registeredOn', 'EnrollmentDate', 'enrollmentDate', 'DateOfRegistration', 'dateOfRegistration') || null,
      demographics,
      epilepsy,
      regimen: {
        medications: meds
      },
      clinicalFlags: { ...flags, ...clinicalContext }, // Merge all clinical flags
  // Include women's health flags at top-level for compatibility with backend normalization
  hormonalContraception: hormonalContraception,
  irregularMenses: irregularMenses,
  weightGain: weightGain,
  catamenialPattern: catamenialPattern,
      comorbidities: (src.currentFollowUpData?.comorbidities ? { freeText: src.currentFollowUpData.comorbidities } : (typeof rawComorb === 'object') ? rawComorb : (rawComorb ? { freeText: rawComorb } : {})),
      pregnancyStatus: pickFirst('pregnancyStatus', 'pregnancy.status') || 'unknown',
      followFrequency: pickFirst('FollowFrequency', 'followFrequency') || pickFirst('FollowUpFrequency') || null,
      // ── Additional Patients-sheet fields for richer CDS context ──
      ageOfOnset: isNaN(parsedAgeOfOnset) ? null : parsedAgeOfOnset,
      diagnosis: pickFirst('Diagnosis', 'diagnosis') || null,
      addictions: pickFirst('Addictions', 'addictions') || null,
      previouslyOnDrug: pickFirst('PreviouslyOnDrug', 'previouslyOnDrug') || null,
      treatmentStatus: pickFirst('TreatmentStatus', 'treatmentStatus') || null,
      injuryType: pickFirst('InjuryType', 'injuryType') || null,
      rawForm: src // keep original for debugging if needed
    };

    // Add follow-up specific context if present in the form data
    const followUp = {};
    followUp.followUpId = pickFirst('FollowUpID', 'FollowUpId', 'followUpId') || pickFirst('FollowUpID', 'FollowUpId') || null;
    followUp.followUpDate = pickFirst('FollowUpDate', 'followUpDate', 'SubmissionDate', 'submissionDate') || null;
    followUp.followUpMode = pickFirst('FollowUpMode', 'followUpMode') || null;
    followUp.phoneCorrect = parseBool(pickFirst('PhoneCorrect', 'phoneCorrect')) || false;
    followUp.correctedPhoneNumber = pickFirst('CorrectedPhoneNumber', 'correctedPhoneNumber') || null;
    followUp.feltImprovement = src.currentFollowUpData?.improvement || pickFirst('FeltImprovement', 'feltImprovement') || false;
  followUp.seizureFrequency = pickFirst('SeizureFrequency', 'seizureFrequency', 'SeizureFrequency') || followUp.seizureFrequency || patientContext.epilepsy?.seizureFrequency || null;
  // New field: number of seizures since last visit (preferred measure for follow-up)
  // Check current form data first, then fall back to historical data
  const currentSeizures = src.currentFollowUpData?.seizuresSinceLastVisit;
  followUp.seizuresSinceLastVisit = (currentSeizures !== undefined && currentSeizures !== null) 
    ? Number(currentSeizures) 
    : Number(pickFirst('seizuresSinceLastVisit', 'followup-seizure-count', 'SeizuresSinceLastVisit')) || 0;

    const injuryNotesRaw = src.currentFollowUpData?.injuryNotes ||
      pickFirst('SeizureSeverityChange', 'injuryNotes', 'injuryDescription');
    if (injuryNotesRaw !== undefined && injuryNotesRaw !== null) {
      followUp.seizureInjuryNotes = injuryNotesRaw;
    }

    const injurySelectionRaw = src.currentFollowUpData?.injuriesData ||
      pickFirst('injuriesData', 'InjuryType', 'injurySelection', 'injuryData');
    const parsedInjurySelection = this.parseInjurySelection(injurySelectionRaw) || null;
    if (Array.isArray(parsedInjurySelection) && parsedInjurySelection.length > 0) {
      followUp.injuryList = parsedInjurySelection;
    }
    if (
      (typeof injuryNotesRaw === 'string' && injuryNotesRaw.trim().length > 0) ||
      (Array.isArray(parsedInjurySelection) && parsedInjurySelection.length > 0) ||
      (typeof injurySelectionRaw === 'string' && injurySelectionRaw.trim().length > 0 && !parsedInjurySelection)
    ) {
      followUp.hasSeizureInjury = true;
    }

    followUp.medicationChanged = parseBool(pickFirst('MedicationChanged', 'medicationChanged')) || false;
    // NewMedications can be a string or array/object
    let newMedsRaw = pickFirst('NewMedications', 'newMedications', 'NewMedications') || pickFirst('NewMedications', 'NewMedication') || src.NewMedications || src.newMedications || null;
    const newMedications = [];
    if (newMedsRaw) {
      if (typeof newMedsRaw === 'string') {
        // parseMedicationStringHelper now returns an array per input fragment; flatten results
        const parts = newMedsRaw.split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean);
        parts.forEach(p => {
          const parsedArr = parseMedicationStringHelper(p) || [];
          parsedArr.forEach(parsed => { if (parsed) newMedications.push(parsed); });
        });
      } else if (Array.isArray(newMedsRaw)) {
        newMedsRaw.forEach(m => {
          if (typeof m === 'string') {
            const parsedArr = parseMedicationStringHelper(m) || [];
            parsedArr.forEach(parsed => { if (parsed) newMedications.push(parsed); });
          } else if (typeof m === 'object') {
            const combined = `${m.name || m.medication || ''} ${m.dosage || m.dose || ''}`.trim();
            const parsedArr = parseMedicationStringHelper(combined || (m.name || '')) || [];
            parsedArr.forEach(parsed => { if (parsed) newMedications.push(parsed); });
          }
        });
      } else if (typeof newMedsRaw === 'object') {
        // single object
        const combined = `${newMedsRaw.name || newMedsRaw.medication || ''} ${newMedsRaw.dosage || newMedsRaw.dose || ''}`.trim();
        const parsedArr = parseMedicationStringHelper(combined || JSON.stringify(newMedsRaw)) || [];
        parsedArr.forEach(parsed => { if (parsed) newMedications.push(parsed); });
      }
    }
    followUp.newMedications = newMedications;
    followUp.adverseEffects = src.currentFollowUpData?.adverseEffects || pickFirst('AdverseEffects', 'adverseEffects') || null;
    // Derive sideEffectsPresent flag from AdverseEffects column for adherence barrier identification
    // Handle both array (from checkboxes) and string formats
    const adverseEffectsValue = followUp.adverseEffects;
    if (Array.isArray(adverseEffectsValue)) {
      followUp.sideEffectsPresent = adverseEffectsValue.length > 0 && !adverseEffectsValue.every(e => e === 'None' || e === '');
    } else if (typeof adverseEffectsValue === 'string') {
      followUp.sideEffectsPresent = !!(adverseEffectsValue && adverseEffectsValue !== 'None' && adverseEffectsValue.trim() !== '');
    } else {
      followUp.sideEffectsPresent = false;
    }
    followUp.adherence = src.currentFollowUpData?.adherence || pickFirst('Adherence', 'treatmentAdherence') || null;
    followUp.nextFollowUpDate = pickFirst('NextFollowUpDate', 'nextFollowUpDate') || null;
    followUp.referredToMO = pickFirst('ReferredToMO', 'referredToMO') || null;
    followUp.drugDoseVerification = pickFirst('DrugDoseVerification', 'drugDoseVerification') || null;
    
    // Psychosocial screening dates for biannual NDDI-E tracking
    followUp.NDDIEScreeningDate = pickFirst('NDDIEScreeningDate', 'nddiescreeningdate', 'lastPsychScreeningDate') || null;
    followUp.lastPsychScreeningDate = followUp.NDDIEScreeningDate; // Alias for compatibility
    
    // Also check at top-level patientContext for historical screening data
    patientContext.NDDIEScreeningDate = followUp.NDDIEScreeningDate || pickFirst('patient.NDDIEScreeningDate', 'patientRecord.NDDIEScreeningDate') || null;
    patientContext.lastPsychScreeningDate = patientContext.NDDIEScreeningDate;

    // Derive Step 3 frequency/adherence normalization per v1.2
    // For daysSinceLast calculation, we specifically want the PREVIOUS visit date, not the current one.
    // If followUp.followUpDate is present, it might be the current date (if explicitly set) or previous (if from patient record).
    // To be safe, we prefer LastFollowUpDate from the source if available, as that reliably indicates history.
    const lastFollowUpISO = pickFirst('LastFollowUpDate', 'lastFollowUpDate', 'lastVisitDate', 'currentFollowUpData.lastFollowUpDate') || followUp.followUpDate;
    
    const baselineRaw = epilepsy.baselineFrequency || epilepsy.seizureFrequency || pickFirst('baselineFreqLabel');
    const baselineCategory = normalizeFrequencyLabel(baselineRaw) || null;
    const currentCategory = computeFrequencyFromSeizureCount(followUp.seizuresSinceLastVisit, lastFollowUpISO) || null;
    const adherenceCanonical = normalizeAdherence(followUp.adherence || clinicalContext.adherencePattern);

    let worsening = false;
    let worseningMagnitude = null;
    if (baselineCategory && currentCategory) {
      const cmp = compareFrequencies(currentCategory, baselineCategory);
      if (cmp !== null) {
        worsening = cmp > 0;
        worseningMagnitude = cmp;
      }
    }

    // Calculate days since last visit
    const daysSinceLast = (lastFollowUpISO ? (Math.min(365, Math.max(1, Math.round((new Date() - new Date(lastFollowUpISO)) / (24*60*60*1000))))) : null);
    window.Logger.debug('CDS Integration: Calculated daysSinceLast:', daysSinceLast, 'from lastFollowUpISO:', lastFollowUpISO);

    // attach followUp only if any field present
    if (Object.keys(followUp).some(k => followUp[k] !== null && followUp[k] !== '' && followUp[k] !== false)) {
      patientContext.followUp = {
        ...followUp,
        daysSinceLastVisit: daysSinceLast, // Explicitly provide for backend
        step3: {
          // Use ?? (nullish coalescing) instead of || so that 0 is treated correctly
          seizureCount: Number(followUp.seizuresSinceLastVisit) ?? 0,
          lastFollowUpISO: lastFollowUpISO || null,
          daysSinceLast: daysSinceLast,
          currentFrequency: currentCategory || 'UNKNOWN',
          baselineFrequency: baselineCategory || 'UNKNOWN',
          adherence: adherenceCanonical || 'UNKNOWN',
          worsening,
          worseningMagnitude
        }
      };
    }

    // Backwards compatibility: also expose flat medications and flags
  patientContext.medications = meds;
    patientContext.flags = flags;
    patientContext.flags = { ...flags, reproductivePotential: demographics.reproductivePotential };
  // Backwards-compat: expose seizuresSinceLastVisit at top-level for older consumers
  // Use ?? (nullish coalescing) instead of || so that 0 is treated correctly
  patientContext.seizuresSinceLastVisit = followUp.seizuresSinceLastVisit ?? 0;

    return patientContext;
  }

  /**
   * Transform follow-up form data to standard patient data format (legacy)
   * @param {Object} formData - Follow-up form data
   * @returns {Object} Standardized patient data
   */
  transformFollowUpData(formData) {
    return {
      // Basic demographics
      age: formData.age || formData.patientAge,
      gender: formData.gender || formData.sex,
      weight: formData.weight || formData.bodyWeight,
      
      // Pregnancy status
      pregnancyStatus: formData.pregnancyStatus || 'unknown',
      
      // Current medications
      currentMedications: this.extractMedicationsFromForm(formData),
      
      // Seizure information
      seizureFrequency: formData.seizureFrequency || formData.seizuresPerMonth,
      lastSeizure: formData.lastSeizure || formData.lastSeizureDate,
      
      // Comorbidities
      comorbidities: this.extractComorbiditiesFromForm(formData),
      
      // Additional context
      formType: 'followup',
      submissionDate: new Date().toISOString()
    };
  }

  /**
   * Check if patient is in reproductive age range
   * @param {Object} formData - Form data
   * @returns {boolean} Whether patient is in reproductive age
   */
  isReproductiveAge(formData) {
    const age = parseInt(formData.age || formData.patientAge) || 0;
    const gender = (formData.gender || formData.sex || '').toLowerCase();
    return (gender === 'female' || gender === 'f') && age >= 12 && age <= 50;
  }

  /**
   * Normalize pregnancy status to backend-expected enum values
   * @param {string} value - Raw pregnancy status value
   * @returns {string} Normalized value: "Pregnant", "Not Pregnant", or "Unknown"
   */
  normalizePregnancyStatus(value) {
    if (!value) return 'Unknown';
    const normalized = String(value).trim().toLowerCase();
    if (normalized.includes('pregnant') && !normalized.includes('not')) return 'Pregnant';
    if (normalized.includes('not')) return 'Not Pregnant';
    return 'Unknown';
  }

  /**
   * Normalize renal function to backend-expected enum values
   * @param {string} value - Raw renal function value
   * @returns {string} Normalized value: "Normal", "Impaired", or "Unknown"
   */
  normalizeRenalFunction(value) {
    if (!value) return 'Unknown';
    const normalized = String(value).trim().toLowerCase();
    if (normalized.includes('impair') || normalized.includes('poor') || normalized.includes('reduced')) return 'Impaired';
    if (normalized.includes('normal') || normalized.includes('healthy')) return 'Normal';
    return 'Unknown';
  }

  /**
   * Normalize hepatic function to backend-expected enum values
   * @param {string} value - Raw hepatic function value
   * @returns {string} Normalized value: "Normal", "Impaired", or "Unknown"
   */
  normalizeHepaticFunction(value) {
    if (!value) return 'Unknown';
    const normalized = String(value).trim().toLowerCase();
    if (normalized.includes('impair') || normalized.includes('poor') || normalized.includes('reduced') || normalized.includes('cirrhosis')) return 'Impaired';
    if (normalized.includes('normal') || normalized.includes('healthy')) return 'Normal';
    return 'Unknown';
  }

  /**
   * Fetch with offline fallback detection
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} Fetch response
   */
  async fetchWithFallback(url, options = {}) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok && response.status >= 500) {
        this.isOffline = true;
      } else {
        this.isOffline = false;
      }
      
      return response;
    } catch (error) {
      this.isOffline = true;
      throw error;
    }
  }

  /**
   * Log CDS action events (snooze, acknowledge, etc.)
   * @param {string} action - Action taken
   * @param {Object} context - Additional context
   */
  async logCDSAction(action, context = {}) {
    try {
      const event = {
        timestamp: new Date().toISOString(),
        username: window.currentUser?.username || 'unknown',
        role: window.currentUser?.role || 'unknown',
        phc: window.currentUser?.assignedPHC || 'unknown',
        eventType: 'cds_action',
        ruleId: context.ruleId || '',
        severity: context.severity || '',
        action: action,
        patientHint: this.generatePatientHint(this.lastAnalyzedPatient),
        version: this.config?.kbVersion || 'unknown'
      };

      // Prefer high-level telemetry API if available
      if (this.telemetry && typeof this.telemetry.recordAlertInteraction === 'function') {
        try {
          this.telemetry.recordAlertInteraction(action, event.ruleId || '', { severity: event.severity });
        } catch (e) { window.Logger.warn('telemetry.recordAlertInteraction failed:', e); }
      } else if (this.telemetry && typeof this.telemetry.queueEvent === 'function') {
        try { this.telemetry.queueEvent(event); } catch (e) { window.Logger.warn('telemetry.queueEvent failed:', e); }
      } else {
        // Fallback: write to audit log
        try { await this.logAuditEvent('cds_action', event); } catch (e) { /* ignore */ }
      }
    } catch (error) {
      window.Logger.warn('Failed to log CDS action:', error);
    }
  }

  /**
   * Flush telemetry events to backend
   */
  async flushTelemetry() {
    if (this.telemetry.length === 0 || this.isOffline) {
      return;
    }

    try {
      const events = [...this.telemetry];
      this.telemetry = []; // Clear queue immediately

      // Use form-encoded body to avoid CORS preflight when talking to Apps Script
      const params = new URLSearchParams();
      params.append('action', 'cdsLogEvents');
      params.append('events', JSON.stringify(events));

      const response = await this.fetchWithFallback(`${this.scriptUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: params.toString()
      });

      if (!response.ok) {
        // Put events back in queue if failed
        this.telemetry.unshift(...events);
        throw new Error(`Telemetry flush failed: ${response.status}`);
      }

      const result = await response.json();
      if (result.status !== 'success') {
        window.Logger.warn('Telemetry flush warning:', result.message);
      }
    } catch (error) {
      window.Logger.warn('Failed to flush telemetry:', error);
    }
  }

  /**
   * Generate patient hint for logging (non-identifying)
   * @param {Object} patientContext - Patient context
   * @returns {string} Patient hint
   */
  generatePatientHint(patientContext) {
    if (!patientContext) return 'xxx';
    
    if (patientContext.patientId) {
      const id = patientContext.patientId.toString();
      return id.length >= 3 ? id.slice(-3) : id;
    }
    
    const hashInput = `${patientContext.age || ''}${patientContext.gender || ''}${patientContext.weightKg || ''}`;
    return hashInput ? hashInput.slice(-3) || 'xxx' : 'xxx';
  }

  /**
   * Extract medication information from various form field formats
   * @param {Object} formData - Form data
   * @returns {Array} Medication list in backend format
   */
  extractMedicationsFromForm(formData) {
    const medicationStrings = [];
    
    // Check various possible field names
    const medicationFields = [
      'currentMedications',
      'medications',
      'currentDrugs',
      'treatment',
      'antiepilepticDrugs',
      'aeds'
    ];

    medicationFields.forEach(field => {
      if (formData[field]) {
        if (Array.isArray(formData[field])) {
          formData[field].forEach(med => {
            if (med && typeof med === 'object') {
              // Extract medication name from object
              const name = med.name || med.medication || med.drug || med.Name || med.Medication;
              if (name && typeof name === 'string') {
                medicationStrings.push(name.trim());
              }
              // Also try to extract from string representation
              const medStr = this.extractMedicationFromObject(med);
              if (medStr) medicationStrings.push(medStr);
            } else if (typeof med === 'string' && med.trim()) {
              medicationStrings.push(med.trim());
            }
          });
        } else if (typeof formData[field] === 'string') {
          // Split by common delimiters
          const splitMeds = formData[field].split(/[,;|\n]/).map(m => m.trim()).filter(m => m);
          medicationStrings.push(...splitMeds);
        }
      }
    });

    // Look for numbered medication fields (drug1, drug2, etc.)
    for (let i = 1; i <= 10; i++) {
      const drugField = formData[`drug${i}`] || formData[`medication${i}`];
      if (drugField) {
        if (typeof drugField === 'object') {
          const medStr = this.extractMedicationFromObject(drugField);
          if (medStr) medicationStrings.push(medStr);
        } else if (typeof drugField === 'string' && drugField.trim()) {
          medicationStrings.push(drugField.trim());
        }
      }
    }

    // Convert strings to backend format using module-level parser (which returns arrays); flatten and uniqueness
    const uniqueMedStrings = [...new Set(medicationStrings)];
    const parsed = uniqueMedStrings.map(medStr => parseMedicationStringHelper(medStr) || []).flat();
    // remove falsy and duplicates by raw string
    const seen = new Set();
    const deduped = [];
    parsed.forEach(p => {
      if (!p || !p.raw) return;
      const key = p.raw.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(p);
      }
    });
    return deduped;
  }

  /**
   * Parse medication string to extract name, dosage, etc.
   * @param {string} medString - Medication string
   * @returns {Object|null} Parsed medication
   */
  // Backwards-compatible wrapper: delegate to module-level parser
  // Returns an array of parsed medication objects for consistency
  parseMedicationString(medString) {
    return parseMedicationStringHelper(medString) || [];
  }

  /**
   * Extract medication string from medication object
   * @param {Object} medObject - Medication object
   * @returns {string|null} Medication string
   */
  extractMedicationFromObject(medObject) {
    if (!medObject || typeof medObject !== 'object') return null;
    
    // Try common medication name fields
    const nameFields = ['name', 'medication', 'drug', 'Name', 'Medication', 'Drug'];
    for (const field of nameFields) {
      if (medObject[field] && typeof medObject[field] === 'string') {
        return medObject[field].trim();
      }
    }
    
    // Try to construct medication string from dose and frequency
    if (medObject.dose || medObject.frequency) {
      const parts = [];
      if (medObject.name) parts.push(medObject.name);
      if (medObject.dose) parts.push(medObject.dose + (medObject.unit || 'mg'));
      if (medObject.frequency) parts.push(medObject.frequency);
      
      if (parts.length > 0) {
        return parts.join(' ');
      }
    }
    
    return null;
  }

  /**
   * Extract comorbidities from form data
   * @param {Object} formData - Form data
   * @returns {Array} Comorbidity list
   */
  extractComorbiditiesFromForm(formData) {
    const comorbidities = [];
    
    // Common comorbidity fields
    const comorbidityFields = [
      'comorbidities',
      'medicalHistory',
      'pastMedicalHistory',
      'otherConditions'
    ];

    comorbidityFields.forEach(field => {
      if (formData[field]) {
        if (Array.isArray(formData[field])) {
          comorbidities.push(...formData[field]);
        } else if (typeof formData[field] === 'string') {
          const splitConds = formData[field].split(/[,;|\n]/).map(c => c.trim()).filter(c => c);
          comorbidities.push(...splitConds);
        }
      }
    });

    // Check for specific condition checkboxes
    const specificConditions = [
      'diabetes', 'hypertension', 'depression', 'anxiety',
      'kidneyDisease', 'liverDisease', 'heartDisease'
    ];

    specificConditions.forEach(condition => {
      if (formData[condition] === true || formData[condition] === 'yes') {
        comorbidities.push(condition);
      }
    });

    return [...new Set(comorbidities)];
  }

  /**
   * Generate cache key for patient data
   * @param {Object} patientData - Patient data
   * @returns {string} Cache key
   */
  generateCacheKey(patientData) {
    const keyData = {
      age: patientData.age,
      gender: patientData.gender,
      medications: patientData.currentMedications?.sort(),
      weight: patientData.weight,
      seizureFreq: patientData.seizureFrequency
    };
    return btoa(JSON.stringify(keyData));
  }
  
  /**
   * Refresh CDS analysis with last analyzed patient data
   * Used when patient data has been updated (e.g. epilepsy type change)
   * @returns {Promise<Object>} Updated CDS analysis
   */
  enrichPatientContextForSpecialPopulations(patientContext) {
    // Make a copy to avoid modifying the original
    const enriched = { ...patientContext };
    
    try {
      // Add reproductive potential flag for women of childbearing age
      if (enriched.gender === 'Female' && enriched.age >= 15 && enriched.age <= 45) {
        enriched.reproductivePotential = true;
        
        // Check for pregnancy status if available
        if (enriched.pregnancyStatus) {
          enriched.isPregnant = enriched.pregnancyStatus === 'pregnant';
        }
      }
      
      // Add elderly flag
      if (enriched.age >= 65) {
        enriched.elderly = true;
      }
      
      // Add hepatic and renal impairment flags based on comorbidities
      if (enriched.comorbidities) {
        // Check for liver disease
        if (Array.isArray(enriched.comorbidities) && 
            enriched.comorbidities.some(c => 
              c.includes('liver') || c.includes('hepatic') || c.includes('cirrhosis')
            )) {
          enriched.hepaticFunction = 'impaired';
        }
        
        // Check for kidney disease
        if (Array.isArray(enriched.comorbidities) && 
            enriched.comorbidities.some(c => 
              c.includes('kidney') || c.includes('renal') || c.includes('nephro')
            )) {
          enriched.renalFunction = 'impaired';
        }
      }
      
      return enriched;
    } catch (error) {
      window.Logger.error('Error enriching patient context:', error);
      return patientContext; // Return original if error
    }
  }
  
  /**
   * Connect CDS integration with epilepsy type update flow
   * Enhanced in v1.2 to support detailed epilepsy type classifications
   */
  connectEpilepsyTypeUpdates() {
    try {
  // Make CDS integration available globally for other components
  // Expose both legacy global (`followUpCDS`) and canonical global (`cdsIntegration`)
  window.followUpCDS = this;
  window.cdsIntegration = this;
      
      // Listen for epilepsy type changes
      const epilepsyTypeSelect = document.getElementById('epilepsyType');
      if (epilepsyTypeSelect) {
        // If we have enhanced epilepsy types from the KB metadata, update the select options
        if (this.isEnhancedVersion && this.kbMetadata?.epilepsyTypeInfo?.availableTypes) {
          this.updateEpilepsyTypeOptions(epilepsyTypeSelect, this.kbMetadata.epilepsyTypeInfo.availableTypes);
        }
        
        // Listen for changes to trigger CDS refresh
        epilepsyTypeSelect.addEventListener('change', () => {
          // Wait for the updateEpilepsyType function to complete first
          setTimeout(() => this.refreshCDS(), 1000);
        });
        window.Logger.debug('CDS connected to epilepsy type updates');
      }
    } catch (error) {
      window.Logger.error('Failed to connect CDS to epilepsy type updates:', error);
    }
  }
  
  /**
   * Update epilepsy type dropdown options based on enhanced KB metadata
   * @param {HTMLElement} selectElement The epilepsy type select element
   * @param {Array} availableTypes Array of epilepsy type objects from KB metadata
   */
  updateEpilepsyTypeOptions(selectElement, availableTypes) {
    try {
      // Save current selection
      const currentValue = selectElement.value;
      
      // Clear existing options except for the empty default
      while (selectElement.options.length > 1) {
        selectElement.remove(1);
      }
      
      // Add options from the enhanced KB
      availableTypes.forEach(typeInfo => {
        const option = document.createElement('option');
        option.value = typeInfo.code;
        option.textContent = typeInfo.name;
        if (typeInfo.description) {
          option.title = typeInfo.description;
        }
        selectElement.appendChild(option);
      });
      
      // Restore previous selection if it exists in the new options
      if (currentValue) {
        // Try to match by code or name (case insensitive)
        const normalizedCurrent = currentValue.toLowerCase();
        for (let i = 0; i < selectElement.options.length; i++) {
          const option = selectElement.options[i];
          if (option.value.toLowerCase() === normalizedCurrent || 
              option.textContent.toLowerCase() === normalizedCurrent) {
            selectElement.selectedIndex = i;
            break;
          }
        }
      }
      
      window.Logger.debug('Epilepsy type options updated with enhanced classifications');
    } catch (error) {
      window.Logger.error('Failed to update epilepsy type options:', error);
    }
  }
  
  /**
   * Check KB version compatibility with frontend
   * @returns {boolean} Whether the KB version is compatible
   */
  checkKBVersionCompatibility() {
    // Define the minimum supported KB version for this frontend
    const minSupportedVersion = '0.1.0'; // Align with current backend version
    
    // Get the actual KB version
    const kbVersion = (this.kbMetadata?.version || this.config?.kbVersion || '0.0.0').toString();
    
    // Perform version comparison
    const isCompatible = this.compareVersions(kbVersion, minSupportedVersion) >= 0;
    
    if (!isCompatible) {
      window.Logger.warn(`KB version ${kbVersion} is older than minimum supported version ${minSupportedVersion}`);
      
      // Show warning in UI if available
      this.showVersionWarning(kbVersion, minSupportedVersion);
    }
    
    return isCompatible;
  }
  
  /**
   * Refresh CDS analysis for currently-loaded patient (convenience wrapper)
   * Triggers analyzeFollowUpData(...) then renders alerts into the CDS container.
   * @returns {Promise<Object|null>} analysis result or null on error
   */
  async refreshCDS() {
    try {
      const patient = (window.cdsState && window.cdsState.currentPatient) ? window.cdsState.currentPatient : (this.lastAnalyzedPatient || null);
      if (!patient) {
        window.Logger.debug('refreshCDS: no patient available to analyze - this is normal when no patient is selected');
        return null;
      }

      const analysis = await this.analyzeFollowUpData(patient);
      if (analysis && typeof this.displayAlerts === 'function') {
        // Use canonical container id 'cdsAlerts' by default
        this.displayAlerts(analysis, 'cdsAlerts');
      }
      
      // Update streamlined CDS display if in follow-up context
      if (typeof window.updateStreamlinedCDSDisplay === 'function') {
        window.Logger.debug('CDS Integration: Calling updateStreamlinedCDSDisplay');
        window.updateStreamlinedCDSDisplay(analysis);
      } else {
        window.Logger.debug('CDS Integration: updateStreamlinedCDSDisplay not available');
      }
      
      return analysis;
    } catch (err) {
      window.Logger.error('refreshCDS failed:', err);
      return null;
    }
  }

  /**
   * Render alerts or analysis result into a container using existing UI renderer
   * @param {Object|Array} alertsOrAnalysis - Either the analysis object or an array of alert objects
   * @param {string} containerId - DOM element id to render into
   */
  displayAlerts(alertsOrAnalysis, containerId = 'cdsAlerts', onProceed = null) {
    try {
      const container = document.getElementById(containerId);
      if (!container) {
        window.Logger.warn('displayAlerts: target container not found:', containerId);
        return;
      }

      // Helper: normalize severity to one of: high, medium, low, info
      const normalizeSeverity = (s) => {
        const t = (s || '').toString().toLowerCase();
        if (t === 'critical' || t === 'severe') return 'high';
        if (t === 'high') return 'high';
        if (t === 'medium' || t === 'warn' || t === 'warning') return 'medium';
        if (t === 'low') return 'low';
        return 'info';
      };

      // Helper: normalize alert shape
      const normalizeAlert = (a) => {
        if (!a) return null;
        const severity = normalizeSeverity(a.severity);
        const id = a.id || a.ruleId || null;
        const text = a.text || a.description || a.message || '';
        const name = a.name || a.title || 'CDS';
        return { ...a, severity, id, ruleId: id || a.ruleId, text, name };
      };

      // Helper: dedupe by ruleId or normalized text, keep higher severity
      const dedupeAlerts = (arr) => {
        const key = (x) => (x.ruleId || x.id) ? `id:${x.ruleId || x.id}` : `text:${(x.text || '').toLowerCase().trim()}`;
        const order = { high:3, medium:2, low:1, info:0 };
        const map = new Map();
        for (const raw of arr) {
          const a = normalizeAlert(raw);
          if (!a) continue;
          const k = key(a);
          if (!map.has(k) || order[a.severity] > order[map.get(k).severity]) {
            map.set(k, a);
          }
        }
        return Array.from(map.values());
      };

      let analysis = null;
      if (!alertsOrAnalysis) {
        analysis = { success: true, warnings: [], prompts: [], doseFindings: [], version: this.kbMetadata?.version || this.config?.kbVersion };
      } else if (alertsOrAnalysis && alertsOrAnalysis.success !== undefined) {
        analysis = alertsOrAnalysis;
      } else if (Array.isArray(alertsOrAnalysis)) {
        // Normalize array of alerts into analysis structure
        const alerts = alertsOrAnalysis.map(normalizeAlert);
        const warnings = alerts.filter(a => a && a.severity !== 'info' && a.severity !== 'low');
        const prompts = alerts.filter(a => a && (a.severity === 'info' || a.severity === 'low'));
        analysis = { success: true, warnings: dedupeAlerts(warnings), prompts: dedupeAlerts(prompts), doseFindings: [], version: this.kbMetadata?.version || this.config?.kbVersion };
      } else {
        // Unknown shape - try to render as empty success
        analysis = { success: true, warnings: [], prompts: [], doseFindings: [], version: this.kbMetadata?.version || this.config?.kbVersion };
      }

      // Normalize/dedupe when analysis provided as object
      if (analysis) {
        const normWarnings = dedupeAlerts((analysis.warnings || []).map(normalizeAlert));
        const normPrompts = dedupeAlerts((analysis.prompts || []).map(normalizeAlert));
        analysis.warnings = normWarnings;
        analysis.prompts = normPrompts;
      }

      // Expose proceed callback to renderer (if provided)
      this._onProceedCallback = (typeof onProceed === 'function') ? onProceed : null;

      // Delegates to existing renderer
      this.renderCDSPanel(container, analysis);
    } catch (err) {
      window.Logger.error('displayAlerts error:', err);
    }
  }
  
  /**
   * Compare two semantic versions
   * @param {string} version1 - First version
   * @param {string} version2 - Second version
   * @returns {number} 1 if version1 > version2, 0 if equal, -1 if less
   */
  compareVersions(version1, version2) {
    const parts1 = version1.split('.').map(Number);
    const parts2 = version2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }
    
    return 0; // Versions are equal
  }
  
  /**
   * Show version incompatibility warning
   * @param {string} currentVersion - Current KB version
   * @param {string} requiredVersion - Minimum required version
   */
  showVersionWarning(currentVersion, requiredVersion) {
    // Display warning banner if possible
    const container = document.getElementById('cdsAlertsContainer');
    if (container) {
      const warningEl = document.createElement('div');
      warningEl.className = 'cds-version-warning';
      warningEl.innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <span>${_t('cds.ui.versionWarning', { currentVersion: currentVersion, requiredVersion: requiredVersion })}</span>
      `;
      container.insertBefore(warningEl, container.firstChild);
    }
  }

  /**
   * Renders the CDS analysis panel in the specified container.
   * @param {HTMLElement} container - The DOM element to render into.
   * @param {Object} analysis - The analysis result object.
   */
  renderCDSPanel(container, analysis) {
    if (!container) return;

    if (!analysis || !analysis.success) {
      container.innerHTML = `<div class="cds-no-alerts" style="color: #dc3545;">${_t('cds.ui.guidanceUnavailable')}</div>`;
      return;
    }

    const { warnings = [], prompts = [] } = analysis;
    const allAlerts = [...warnings, ...prompts];

    if (allAlerts.length === 0) {
      container.innerHTML = `<div class="cds-no-alerts"><i class="fas fa-check-circle" style="color: #28a745;"></i> ${_t('cds.ui.noRecommendations')}</div>`;
      if (this._onProceedCallback) {
        this._onProceedCallback();
        this._onProceedCallback = null;
      }
      return;
    }

    let html = '';

    // Add critical alerts as sticky warning bars at the top
    const criticalAlerts = allAlerts.filter(alert => alert.severity === 'high' || alert.severity === 'critical');
    if (criticalAlerts.length > 0) {
      html += '<div class="cds-critical-alerts-banner">';
      criticalAlerts.forEach(alert => {
        html += this.createCriticalAlertBanner(alert);
      });
      html += '</div>';
    }

    // Add summary banner for the most severe finding
    const mostSevereAlert = this.getMostSevereAlert(allAlerts);
    if (mostSevereAlert) {
      html += this.createSummaryBanner(mostSevereAlert);
    }

    const groupedAlerts = this.groupAlertsBySeverity(allAlerts);

    // TOP 3 prioritization: Show only first 3 alerts prominently, rest collapsed
    const TOP_N = 3;
    let alertCount = 0;
    let collapsedAlerts = [];

    const severityOrder = ['high', 'medium', 'low', 'info'];
    severityOrder.forEach(severity => {
      if (groupedAlerts[severity] && groupedAlerts[severity].length > 0) {
        const alertsForSeverity = groupedAlerts[severity];
        const visibleAlerts = [];
        
        alertsForSeverity.forEach(alert => {
          if (alertCount < TOP_N) {
            visibleAlerts.push(alert);
            alertCount++;
          } else {
            collapsedAlerts.push({ ...alert, originalSeverity: severity });
          }
        });
        
        if (visibleAlerts.length > 0) {
          html += `<div class="cds-severity-section cds-${severity}">`;
          html += `<h5 class="cds-severity-header">${_t('cds.ui.' + severity + 'Priority')}</h5>`;
          visibleAlerts.forEach(alert => {
            html += this.createAlertElement(alert).outerHTML;
          });
          html += `</div>`;
        }
      }
    });

    // Add collapsed section for remaining alerts
    if (collapsedAlerts.length > 0) {
      html += `
        <div class="cds-collapsed-section" style="margin-top: 12px;">
          <button type="button" id="cdsShowMoreBtn" class="cds-show-more-btn" 
                  style="background: none; border: 1px dashed var(--primary-color, #0066cc); 
                         color: var(--primary-color, #0066cc); padding: 8px 16px; 
                         border-radius: 6px; cursor: pointer; width: 100%; 
                         font-size: 0.9em; transition: all 0.2s;">
            <i class="fas fa-chevron-down"></i> 
            ${_t('cds.ui.showMoreRecommendations', { count: collapsedAlerts.length })}
          </button>
          <div id="cdsCollapsedAlerts" style="display: none; margin-top: 12px;">`;
      
      // Group collapsed alerts by severity for display
      const collapsedBySeverity = {};
      collapsedAlerts.forEach(alert => {
        const sev = alert.originalSeverity || 'info';
        if (!collapsedBySeverity[sev]) collapsedBySeverity[sev] = [];
        collapsedBySeverity[sev].push(alert);
      });
      
      severityOrder.forEach(severity => {
        if (collapsedBySeverity[severity] && collapsedBySeverity[severity].length > 0) {
          html += `<div class="cds-severity-section cds-${severity}" style="opacity: 0.85;">`;
          html += `<h5 class="cds-severity-header" style="font-size: 0.9em;">${_t('cds.ui.' + severity + 'Priority')}</h5>`;
          collapsedBySeverity[severity].forEach(alert => {
            html += this.createAlertElement(alert).outerHTML;
          });
          html += `</div>`;
        }
      });
      
      html += `</div></div>`;
    }

    // Add a "Proceed" button if a callback is provided
    if (this._onProceedCallback) {
      html += `
        <div class="cds-action-section">
          <button id="cdsProceedBtn" class="btn btn-primary">${_t('cds.ui.proceed')}</button>
        </div>
      `;
    }

    container.innerHTML = html;

    // Attach event listener for the "Show More" button
    const showMoreBtn = document.getElementById('cdsShowMoreBtn');
    const collapsedContainer = document.getElementById('cdsCollapsedAlerts');
    if (showMoreBtn && collapsedContainer) {
      showMoreBtn.addEventListener('click', () => {
        const isExpanded = collapsedContainer.style.display !== 'none';
        collapsedContainer.style.display = isExpanded ? 'none' : 'block';
        showMoreBtn.innerHTML = isExpanded 
          ? `<i class="fas fa-chevron-down"></i> ${_t('cds.ui.showMoreRecommendations', { count: collapsedAlerts.length })}`
          : `<i class="fas fa-chevron-up"></i> ${_t('cds.ui.showLess')}`;
        this.logCDSAction(isExpanded ? 'collapse_alerts' : 'expand_alerts', { count: collapsedAlerts.length });
      });
    }

    // Attach event listener for the proceed button
    const proceedBtn = document.getElementById('cdsProceedBtn');
    if (proceedBtn && this._onProceedCallback) {
      proceedBtn.addEventListener('click', () => {
        this.logCDSAction('proceed', { alertCount: allAlerts.length });
        this._onProceedCallback();
        this._onProceedCallback = null; // Use once
      });
    }
  }

  normalizeAlertSeverity(severity) {
    const value = (severity || '').toString().toLowerCase();
    if (value === 'critical') return 'critical';
    if (value === 'high' || value === 'severe') return 'high';
    if (value === 'medium' || value === 'warning' || value === 'warn') return 'medium';
    if (value === 'low') return 'low';
    return 'info';
  }

  normalizeAlertBuckets(result) {
    const buckets = { critical: [], high: [], medium: [], low: [], info: [] };
    if (!result) return buckets;

    const version = result.version || this.kbMetadata?.version || this.config?.kbVersion || '1.2.0';

    if (result.alerts && typeof result.alerts === 'object') {
      Object.keys(buckets).forEach(level => {
        const entries = Array.isArray(result.alerts[level]) ? result.alerts[level] : [];
        buckets[level] = entries.map(alert => this.ensureStandardAlertShape(alert, version)).filter(Boolean);
      });
      return buckets;
    }

    const addLegacyList = (list, fallbackCategory) => {
      (list || []).forEach(entry => {
        const standard = this.convertLegacyAlertToStandard(entry, fallbackCategory, version);
        if (standard) {
          buckets[standard.severity].push(standard);
        }
      });
    };

    addLegacyList(result.warnings, 'safety');
    addLegacyList(result.prompts, 'optimization');
    if (Array.isArray(result.treatmentRecommendations)) {
      addLegacyList(result.treatmentRecommendations, 'optimization');
    }

    return buckets;
  }

  ensureStandardAlertShape(alert, version) {
    if (!alert) return null;
    const severity = this.normalizeAlertSeverity(alert.severity);
    const actions = Array.isArray(alert.actions)
      ? alert.actions
      : (Array.isArray(alert.nextSteps) ? alert.nextSteps : []);

    return {
      id: alert.id || alert.ruleId || ('alert_' + Math.random().toString(36).slice(2)),
      version: alert.version || version || '1.2.0',
      severity,
      category: alert.category || 'optimization',
      priority: typeof alert.priority === 'number' ? alert.priority : (severity === 'critical' ? 1 : severity === 'high' ? 2 : 3),
      title: alert.title || alert.name || _t('cds.alert.clinicalAlert'),
      message: alert.message || alert.text || '',
      rationale: alert.rationale || '',
      actions,
      references: alert.references || [],
      dismissible: alert.dismissible !== false,
      requiresAcknowledgment: alert.requiresAcknowledgment || severity === 'critical',
      timestamp: alert.timestamp || new Date().toISOString(),
      ruleIds: Array.isArray(alert.ruleIds) ? alert.ruleIds : (alert.ruleId ? [alert.ruleId] : []),
      doseRecommendation: alert.doseRecommendation || alert.details || null,
      drugInteraction: alert.drugInteraction || null
    };
  }

  convertLegacyAlertToStandard(entry, fallbackCategory, version) {
    if (!entry) return null;
    const severity = this.normalizeAlertSeverity(entry.severity || (fallbackCategory === 'safety' ? 'high' : 'medium'));
    const actions = Array.isArray(entry.nextSteps) ? entry.nextSteps : (entry.recommendation ? [entry.recommendation] : []);

    return {
      id: entry.id || entry.ruleId || ('legacy_' + Math.random().toString(36).slice(2)),
      version: version || '1.2.0',
      severity,
      category: entry.category || fallbackCategory || 'optimization',
      priority: typeof entry.priority === 'number' ? entry.priority : (severity === 'critical' ? 1 : severity === 'high' ? 2 : 3),
      title: entry.title || entry.name || _t('cds.alert.clinicalAlert'),
      message: entry.text || entry.message || '',
      rationale: entry.rationale || '',
      actions,
      references: entry.references || [],
      dismissible: entry.dismissible !== false,
      requiresAcknowledgment: severity === 'critical',
      timestamp: entry.timestamp || new Date().toISOString(),
      ruleIds: entry.ruleIds || (entry.ruleId ? [entry.ruleId] : []),
      doseRecommendation: entry.details || null,
      drugInteraction: entry.drugInteraction || null
    };
  }

  flattenAlertBuckets(buckets) {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    return order.reduce((acc, level) => {
      if (Array.isArray(buckets[level])) {
        acc.push(...buckets[level]);
      }
      return acc;
    }, []);
  }

  convertStandardAlertToLegacy(alert) {
    if (!alert) return null;
    const title = alert.title || '';
    const message = alert.message || '';
    const text = title && message ? `${title}: ${message}` : (message || title);
    return {
      id: alert.id,
      severity: alert.severity,
      text: text ? text.trim() : '',
      title,
      rationale: alert.rationale,
      nextSteps: Array.isArray(alert.actions) ? alert.actions : [],
      references: alert.references || [],
      dismissible: alert.dismissible,
      requiresAcknowledgment: alert.requiresAcknowledgment,
      ruleId: Array.isArray(alert.ruleIds) && alert.ruleIds.length ? alert.ruleIds[0] : null,
      category: alert.category,
      priority: alert.priority,
      rawAlert: alert
    };
  }

  isHighSeverity(severity) {
    const normalized = this.normalizeAlertSeverity(severity);
    return normalized === 'critical' || normalized === 'high';
  }

  // Note: array-based displayAlerts implementation removed — unified implementation above handles both analysis objects and arrays.

  /**
   * Filter alerts based on governance rules
   * @param {Array} alerts - All alerts
   * @returns {Array} Enabled alerts
   */
  filterAlertsByGovernance(alerts) {
    if (typeof window.cdsGovernance === 'undefined') {
      return alerts; // No governance, show all alerts
    }

    return alerts.filter(alert => {
      const isEnabled = window.cdsGovernance.isRuleEnabled(alert.ruleId);
      
      if (!isEnabled) {
        window.Logger.debug(`Alert filtered by governance: ${alert.ruleId}`);
        this.recordTelemetry('alert_filtered_governance', { ruleId: alert.ruleId });
      }
      
      return isEnabled;
    });
  }

  /**
   * Group alerts by severity level
   * @param {Array} alerts - Alerts array
   * @returns {Object} Grouped alerts
   */
  groupAlertsBySeverity(alerts) {
    return {
      high: alerts.filter(a => a.severity === 'high'),
      medium: alerts.filter(a => a.severity === 'medium'),
      info: alerts.filter(a => a.severity === 'info'),
      low: alerts.filter(a => a.severity === 'low')
    };
  }

  /**
   * Create DOM element for a single alert
   * @param {Object} alert - Alert object
   * @returns {HTMLElement} Alert DOM element
   */
  createAlertElement(alert) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `cds-alert cds-alert-${alert.severity}`;
    alertDiv.setAttribute('data-rule-id', alert.ruleId);

    // Alert header
    const header = document.createElement('div');
    header.className = 'cds-alert-header';
    
    const title = document.createElement('h5');
    title.className = 'cds-alert-title';
    title.textContent = alert.name;
    
    // Add reference help icon
    if (alert.references && alert.references.length > 0) {
      const helpIcon = document.createElement('span');
      helpIcon.className = 'cds-help-icon';
      helpIcon.innerHTML = ' <i class="fas fa-question-circle" title="' + _t('cds.alert.clickForReferences') + '"></i>';
      helpIcon.style.cursor = 'pointer';
      helpIcon.style.color = '#007bff';
      helpIcon.onclick = () => this.showReferences(alert);
      title.appendChild(helpIcon);
    }
    
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'cds-alert-actions';

    const ruleId = alert.id || alert.ruleId;

    // Acknowledge button
    const ackBtn = document.createElement('button');
    ackBtn.className = 'btn btn-sm btn-outline-primary cds-ack-btn';
    ackBtn.textContent = _t('cds.ui.acknowledge');    
    ackBtn.onclick = () => this.acknowledgeAlert(ruleId);
    actions.appendChild(ackBtn);

    header.appendChild(actions);
    alertDiv.appendChild(header);

    // Alert content
    const content = document.createElement('div');
    content.className = 'cds-alert-content';
    
    const description = document.createElement('p');
    description.className = 'cds-alert-description';
    description.textContent = alert.description;
    description.textContent = alert.text || alert.description || alert.message; // Support multiple text fields
    content.appendChild(description);

    if (alert.rationale) {
      const rationale = document.createElement('p');
      rationale.className = 'cds-alert-rationale';
      rationale.innerHTML = `<strong>${_t('cds.alert.rationaleLabel')}:</strong> ${alert.rationale}`;
      content.appendChild(rationale);
    }

    // Recommended actions
    if (alert.actions && alert.actions.length > 0) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'cds-alert-recommendations';
      
      const actionsTitle = document.createElement('strong');
      actionsTitle.textContent = _t('cds.alert.recommendedActions') + ':';
      actionsDiv.appendChild(actionsTitle);

      const actionsList = document.createElement('ul');
      alert.actions.forEach(action => {
        const actionItem = document.createElement('li');
        actionItem.textContent = this.formatActionText(action);
        actionsList.appendChild(actionItem);
      });
      actionsDiv.appendChild(actionsList);
      content.appendChild(actionsDiv);
    }

    alertDiv.appendChild(content);
    return alertDiv;
  }

  /**
   * Create critical alert banner for high-severity alerts
   * @param {Object} alert - Alert object
   * @returns {string} HTML string for critical alert banner
   */
  createCriticalAlertBanner(alert) {
    const alertId = alert.id || alert.ruleId || `alert_${Date.now()}`;
    const title = alert.name || alert.title || _t('cds.alert.criticalAlert');
    const message = alert.text || alert.description || alert.message || '';

    return `
      <div class="cds-critical-banner" data-alert-id="${alertId}">
        <div class="cds-critical-banner-content">
          <div class="cds-critical-banner-icon">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <div class="cds-critical-banner-text">
            <div class="cds-critical-banner-title">${this.escapeHtml(title)}</div>
            <div class="cds-critical-banner-message">${this.escapeHtml(message)}</div>
          </div>
          <div class="cds-critical-banner-actions">
            <button class="cds-critical-banner-close" onclick="this.closest('.cds-critical-banner').style.display='none'" title="${_t('cds.panel.dismiss')}">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get the most severe alert from a list of alerts
   * @param {Array} alerts - Array of alert objects
   * @returns {Object|null} Most severe alert or null
   */
  getMostSevereAlert(alerts) {
    if (!alerts || alerts.length === 0) return null;

    const severityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1, 'info': 0 };
    let mostSevere = null;
    let highestSeverity = -1;

    alerts.forEach(alert => {
      const severity = alert.severity || 'info';
      const severityValue = severityOrder[severity] || 0;

      if (severityValue > highestSeverity) {
        highestSeverity = severityValue;
        mostSevere = alert;
      }
    });

    return mostSevere;
  }

  /**
   * Create summary banner for the most severe CDS finding
   * @param {Object} alert - Most severe alert object
   * @returns {string} HTML string for summary banner
   */
  createSummaryBanner(alert) {
    const severity = alert.severity || 'info';
    const title = alert.name || alert.title || _t('cds.alert.cdsFinding');
    const message = alert.text || alert.description || alert.message || '';
    const severityClass = `cds-summary-severity-${severity}`;

    return `
      <div class="cds-summary-banner ${severityClass}">
        <div class="cds-summary-banner-content">
          <div class="cds-summary-banner-icon">
            <i class="fas fa-${this.getSeverityIcon(severity)}"></i>
          </div>
          <div class="cds-summary-banner-text">
            <div class="cds-summary-banner-title">${this.escapeHtml(title)}</div>
            <div class="cds-summary-banner-message">${this.escapeHtml(message)}</div>
          </div>
          <div class="cds-summary-banner-badge">
            <span class="cds-severity-badge ${severityClass}">${severity.toUpperCase()}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get icon class for severity level
   * @param {string} severity - Severity level
   * @returns {string} FontAwesome icon class
   */
  getSeverityIcon(severity) {
    const icons = {
      'critical': 'exclamation-triangle',
      'high': 'exclamation-circle',
      'medium': 'exclamation-triangle',
      'low': 'info-circle',
      'info': 'info-circle'
    };
    return icons[severity] || 'info-circle';
  }

  /**
   * Format action text for display
   * @param {string} action - Action code
   * @returns {string} Formatted text
   */
  formatActionText(action) {
    const actionTexts = {
      'avoid_if_possible': _t('cds.action.avoidIfPossible'),
      'pregnancy_prevention_program': _t('cds.action.pregnancyPreventionProgram'),
      'informed_consent': _t('cds.action.informedConsent'),
      'consider_alternatives': _t('cds.action.considerAlternatives'),
      'contraception_counseling': _t('cds.action.contraceptionCounseling'),
      'consider_non_hormonal': _t('cds.action.considerNonHormonal'),
      'higher_dose_hormonal': _t('cds.action.higherDoseHormonal'),
      'sedation_monitoring': _t('cds.action.sedationMonitoring'),
      'falls_assessment': _t('cds.action.fallsAssessment'),
      'driving_counseling': _t('cds.action.drivingCounseling'),
      'tertiary_referral': _t('cds.action.tertiaryReferral'),
      'epilepsy_surgery_evaluation': _t('cds.action.epilepsySurgeryEval'),
      'alternative_therapies': _t('cds.action.alternativeTherapies'),
      'dose_increase': _t('cds.action.doseIncrease'),
      'monitoring_plan': _t('cds.action.monitoringPlan'),
      'medication_rationalization': _t('cds.action.medicationRationalization'),
      'specialist_referral': _t('cds.action.specialistReferral')
    };
    
    return actionTexts[action] || action.replace(/_/g, ' ');
  }

  /**
   * Acknowledge an alert
   * @param {string} ruleId - Rule ID
   */
  acknowledgeAlert(ruleId) {
    // Store acknowledgment
    const ackKey = `cds_ack_${ruleId}`;
    localStorage.setItem(ackKey, Date.now().toString());
    
    // Hide the alert
    const alertElement = document.querySelector(`[data-rule-id="${ruleId}"]`);
    if (alertElement) {
      alertElement.classList.add('cds-acknowledged');
    }

    // Log to audit sheet
    try {
      const auditEvent = {
        timestamp: new Date().toISOString(),
        username: window.currentUser?.username || window.currentUser?.email || 'unknown',
        role: window.currentUser?.role || 'unknown',
        phc: window.currentUser?.assignedPHC || window.currentUser?.facility || 'unknown',
        eventType: 'cds_action',
        ruleId: ruleId,
        severity: '',
        action: 'acknowledge',
        patientHint: this.lastAnalyzedPatient?.patientId ? String(this.lastAnalyzedPatient.patientId).slice(-3) : 'xxx',
        version: this.config?.kbVersion || 'unknown'
      };
      this.logAuditEvents([auditEvent]);
    } catch (e) {
      window.Logger.warn('Failed to log acknowledge action to audit sheet:', e);
    }

    // Record action for telemetry
    this.recordAction('acknowledge', ruleId, {
      userRole: window.currentUserRole || 'unknown'
    });

    this.recordTelemetry('alert_acknowledged', { ruleId });
  }

  /**
   * Check if alert is snoozed
   * @param {string} ruleId - Rule ID
   * @returns {boolean} Is snoozed
   */
  isAlertSnoozed(ruleId) {
    const snoozeKey = `cds_snooze_${ruleId}`;
    const snoozeUntil = localStorage.getItem(snoozeKey);
    return snoozeUntil && Date.now() < parseInt(snoozeUntil);
  }

  /**
   * Record telemetry event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  recordTelemetry(event, data = {}) {
    const telemetryEvent = {
      event,
      data,
      timestamp: new Date().toISOString(),
      sessionId: this.getSessionId()
    };
    // If an external telemetry API is present, use it
    if (this.telemetry && typeof this.telemetry.queueEvent === 'function') {
      try { this.telemetry.queueEvent(telemetryEvent); } catch (e) { window.Logger.warn('telemetry.queueEvent failed:', e); }
      return;
    }

    // Otherwise keep a small in-memory queue on this instance
    if (!this._telemetryQueue) this._telemetryQueue = [];
    this._telemetryQueue.push(telemetryEvent);
    if (this._telemetryQueue.length > 200) this._telemetryQueue = this._telemetryQueue.slice(-200);
  }

  /**
   * Get or create session ID
   * @returns {string} Session ID
   */
  getSessionId() {
    let sessionId = sessionStorage.getItem('cds_session_id');
    if (!sessionId) {
      sessionId = 'cds_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('cds_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Get telemetry data for reporting
   * @returns {Array} Telemetry events
   */
  getTelemetry() {
    return [...this.telemetry];
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.recordTelemetry('cache_cleared');
  }

  /**
   * Update version display in UI
   */
  updateVersionDisplay() {
    const versionEl = document.getElementById('cdsVersionDisplay');
    if (!versionEl) return;

    const version = this.kbMetadata?.version || this.config?.kbVersion || 'unknown';
    versionEl.textContent = _t('cds.ui.versionLabel', { version: version });

    const lang = (window.EpicareI18n && typeof window.EpicareI18n.getCurrentLang === 'function'
      ? window.EpicareI18n.getCurrentLang()
      : undefined) || 'en-US';
    const details = [];
    details.push(_t('cds.ui.knowledgeBaseVersion', { version: version }));
    if (this.kbMetadata?.lastUpdated) {
      details.push(_t('cds.panel.lastUpdated') + ': ' + new Date(this.kbMetadata.lastUpdated).toLocaleString(lang));
    }
    if (typeof this.kbMetadata?.drugCount === 'number') {
      details.push(_t('cds.ui.formularyEntries', { count: this.kbMetadata.drugCount }));
    }
    versionEl.title = details.join('\n');
  }

  /**
   * Record CDS rule fired event for telemetry
   * @param {Object} alert - Fired alert
   * @param {Object} patientContext - Patient context (anonymized)
   */
  recordRuleFired(alert, patientContext) {
    this.recordTelemetry('cds_rule_fired', {
      ruleId: alert.ruleId,
      ruleName: alert.name,
      severity: alert.severity,
      category: alert.category,
      confidence: alert.evaluation?.confidence || null,
      patientAgeGroup: this.anonymizeAge(patientContext.age),
      patientGender: patientContext.gender,
      medicationCount: patientContext.currentMedications?.length || 0
    });
  }

  /**
   * Record CDS action event for telemetry
   * @param {string} action - Action taken (snooze, acknowledge, dismiss)
   * @param {string} ruleId - Rule ID
   * @param {Object} context - Additional context
   */
  recordAction(action, ruleId, context = {}) {
    this.recordTelemetry('cds_action', {
      action,
      ruleId,
      timeOnScreen: context.timeOnScreen || null,
      userRole: context.userRole || null
    });
  }

  /**
   * Anonymize age for privacy
   * @param {number} age - Patient age
   * @returns {string} Age group
   */
  anonymizeAge(age) {
    if (!age || age < 0) return 'unknown';
    if (age < 2) return 'infant';
    if (age < 12) return 'child';
    if (age < 18) return 'adolescent';
    if (age < 65) return 'adult';
    return 'elderly';
  }

  /**
   * Render enhanced CDS v1.2 output with dose findings and treatment recommendations
   * @param {Object} analysis - CDS analysis results
   */
  renderEnhancedCDSOutput(analysis) {
    window.Logger.debug('CDS Integration: Rendering enhanced CDS output', analysis);

    // Find CDS container
    const cdsContainer = document.getElementById('cdsRecommendations') ||
                        document.getElementById('recommendationsContent') ||
                        document.querySelector('.cds-container');

    if (!cdsContainer) {
      window.Logger.debug('CDS Integration: No CDS container found for enhanced output');
      return;
    }

    // Build enhanced HTML content
    let html = '<div class="enhanced-cds-output">';

    // Treatment Recommendations Section
    if (analysis.treatmentRecommendations) {
      html += '<div class="cds-section treatment-recommendations">';
      html += `<h4>💊 ${_t('cds.treatment.title')}</h4>`;

      if (analysis.treatmentRecommendations.monotherapySuggestion) {
        html += `<div class="cds-recommendation monotherapy">
          <strong>${_t('cds.treatment.monotherapySuggestion')}:</strong> ${analysis.treatmentRecommendations.monotherapySuggestion}
        </div>`;
      }

      if (analysis.treatmentRecommendations.addonSuggestion) {
        html += `<div class="cds-recommendation addon">
          <strong>${_t('cds.treatment.addOn')}:</strong> ${analysis.treatmentRecommendations.addonSuggestion}
        </div>`;
      }

      if (analysis.treatmentRecommendations.regimenChanges?.length > 0) {
        html += '<div class="cds-regimen-changes">';
        html += `<strong>${_t('cds.treatment.regimenChangesNeeded')}:</strong><ul>`;
        analysis.treatmentRecommendations.regimenChanges.forEach(change => {
          html += `<li>${change.recommendation}</li>`;
        });
        html += '</ul></div>';
      }

      html += '</div>';
    }

    // Dose Findings Section - PHASE 1 IMPROVED
    if (analysis.doseFindings && analysis.doseFindings.length > 0) {
      html += '<div class="cds-section dose-findings">';
      html += `<h4>📏 ${_t('cds.dose.title')}</h4>`;

      analysis.doseFindings.forEach(finding => {
        // Determine status color based on new dosageStatus field
        const dosageStatus = finding.dosageStatus || 'UNKNOWN';
        let statusClass = 'unknown';
        let statusIcon = '❓';
        
        if (dosageStatus === 'ADEQUATE') {
          statusClass = 'adequate';
          statusIcon = '✅';
        } else if (dosageStatus === 'SUBTHERAPEUTIC') {
          statusClass = 'inadequate';
          statusIcon = '⬆️';
        } else if (dosageStatus === 'SUPRATHERAPEUTIC') {
          statusClass = 'inadequate';
          statusIcon = '⬇️';
        } else if (dosageStatus === 'ABOVE_TARGET') {
          statusClass = 'warning';
          statusIcon = '⚠️';
        }
        
        // Build dose display with mg/kg if available
        let doseDisplay = finding.dailyMg ? `${finding.dailyMg}mg/day` : 'Unknown';
        if (finding.mgPerKg) {
          doseDisplay += ` (${finding.mgPerKg} mg/kg)`;
        }
        
        html += `<div class="dose-finding ${statusClass}">
          <div style="font-weight: bold; margin-bottom: 4px;">
            ${statusIcon} <strong>${finding.drug}</strong>: ${doseDisplay}
          </div>`;
        
        // Add notes (current/target range info)
        if (finding.notes && Array.isArray(finding.notes)) {
          finding.notes.forEach(note => {
            html += `<div style="font-size: 0.9em; color: #666; margin: 2px 0;">${note}</div>`;
          });
        }
        
        // Add main recommendation
        if (finding.findings && finding.findings.length > 0) {
          html += `<div style="margin-top: 6px; font-style: italic; color: #333;">${finding.findings[0]}</div>`;
        }
        
        // Add suggested dosages if available and dose is subtherapeutic
        if (finding.suggestedDosages && finding.suggestedDosages.length > 0) {
          html += `<div style="margin-top: 6px; padding: 6px; background: #e8f5e9; border-radius: 3px;">
            <strong style="color: #2e7d32;">${_t('cds.dose.formularyOptions')}:</strong>
            <ul style="margin: 4px 0 0 20px;">`;
          finding.suggestedDosages.forEach(dosage => {
            html += `<li>${dosage}</li>`;
          });
          html += `</ul></div>`;
        }
        
        // Add formulary alert if medication not in formulary
        if (finding.formularyAlert) {
          html += `<div style="margin-top: 6px; padding: 6px; background: #fff3cd; border-radius: 3px; color: #856404;">
            ⚠️ ${finding.formularyAlert}
          </div>`;
        }
        
        html += `</div>`;
      });

      html += '</div>';
    }
    
    // PHASE 4: Therapeutic Drug Monitoring (TDM) Section
    if (analysis.tdmCalibration && analysis.tdmCalibration.status !== 'error' && analysis.tdmCalibration.status !== 'no_level_provided') {
      html += '<div class="cds-section tdm-section">';
      html += `<h4>💊 ${_t('cds.monitoring.tdmTitle')}</h4>`;
      html += `<div style="padding: 8px; background: #e3f2fd; border-left: 4px solid #1976d2; border-radius: 3px;">
        <strong>${analysis.tdmCalibration.medication}</strong>: 
        ${analysis.tdmCalibration.recommendation}<br/>
        <small style="color: #555;">${_t('cds.monitoring.targetRange')}: ${analysis.tdmCalibration.targetRange} | ${_t('cds.monitoring.nextDue')}: ${analysis.tdmCalibration.nextTDMDue}</small>
      </div>`;
      html += '</div>';
    }
    
    // PHASE 4: Advanced Drug Interactions Section
    if (analysis.advancedDrugInteractions && analysis.advancedDrugInteractions.length > 0) {
      html += '<div class="cds-section drug-interactions">';
      html += `<h4>⚠️ ${_t('cds.polytherapy.advancedInteractions')}</h4>`;
      
      analysis.advancedDrugInteractions.forEach(interaction => {
        const severityClass = interaction.severity === 'high' ? 'high-severity' : 'moderate-severity';
        html += `<div class="drug-interaction ${severityClass}" style="padding: 8px; margin: 8px 0; border-left: 4px solid ${interaction.severity === 'high' ? '#dc3545' : '#ffc107'}; background: ${interaction.severity === 'high' ? '#f8d7da' : '#fff3cd'}; border-radius: 3px;">
          <strong style="color: #333;">⚠️ ${interaction.drugA} ↔ ${interaction.drugB}</strong>
          <div style="font-style: italic; color: #555; margin-top: 4px; font-size: 0.9em;">${interaction.mechanism}</div>
          <div style="margin-top: 4px; color: #333; font-weight: bold;">→ ${interaction.recommendedAction}</div>
        </div>`;
      });
      
      html += '</div>';
    }

    // Special Considerations Section
    if (analysis.treatmentRecommendations?.specialConsiderations?.length > 0) {
      html += '<div class="cds-section special-considerations">';
      html += `<h4>⚠️ ${_t('cds.safety.specialConsiderations')}</h4>`;

      analysis.treatmentRecommendations.specialConsiderations.forEach(consideration => {
        const severityClass = consideration.severity === 'high' ? 'high-severity' : 'medium-severity';
        html += `<div class="special-consideration ${severityClass}">
          <strong>${consideration.type.toUpperCase()}:</strong> ${consideration.text}
        </div>`;
      });

      html += '</div>';
    }

    html += '</div>';

    // Add some basic CSS styling
    const style = document.createElement('style');
    style.textContent = `
      .enhanced-cds-output { margin: 10px 0; }
      .cds-section { margin: 15px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
      .cds-section h4 { margin: 0 0 10px 0; color: #2c5aa0; }
      .cds-recommendation { padding: 8px; background: #e8f4fd; border-left: 4px solid #2c5aa0; margin: 5px 0; }
      .dose-finding { padding: 10px; margin: 8px 0; border-left: 4px solid #28a745; background: #f1f8f5; border-radius: 3px; }
      .dose-finding.adequate { border-left-color: #28a745; background: #f1f8f5; }
      .dose-finding.inadequate { border-left-color: #dc3545; background: #f8d7da; }
      .dose-finding.warning { border-left-color: #ffc107; background: #fff3cd; }
      .dose-finding.unknown { border-left-color: #6c757d; background: #f8f9fa; }
      .special-consideration { padding: 8px; margin: 5px 0; border-left: 4px solid #ffc107; background: #fff3cd; }
      .special-consideration.high-severity { border-left-color: #dc3545; background: #f8d7da; }
      /* PHASE 4: TDM and Drug Interaction Styling */
      .tdm-section { background: #f5f5f5; border-color: #1976d2; }
      .tdm-section h4 { color: #1976d2; }
      .drug-interactions { background: #fafafa; border-color: #dc3545; }
      .drug-interactions h4 { color: #dc3545; }
      .drug-interaction { transition: all 0.3s ease; }
      .drug-interaction:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .high-severity { border-left-color: #dc3545 !important; }
      .moderate-severity { border-left-color: #ffc107 !important; }
    `;

    // Insert the content and styling
    cdsContainer.innerHTML = html;
    if (!document.head.querySelector('style[data-cds-enhanced]')) {
      style.setAttribute('data-cds-enhanced', 'true');
      document.head.appendChild(style);
    }

    window.Logger.debug('CDS Integration: Enhanced CDS output rendered');
  }

  applyDoseAdjustmentSafetyGates(analysis, patientContext) {
    if (!analysis || !patientContext) return;
    const gating = this.computeDoseGatingContext(patientContext);
    if (!gating.shouldGateForAdherence && !gating.shouldGateForEarlyTherapy) return;

    const subtherapeuticCodes = ['below_mg_per_kg', 'below_target', 'below_min_dose', 'subtherapeutic', 'inadequate_dose', 'dose_low', 'below_optimal'];
    let adherenceGateApplied = false;
    let waitGateApplied = false;

    if (Array.isArray(analysis.doseFindings)) {
      analysis.doseFindings = analysis.doseFindings.map(finding => {
        if (!finding || !Array.isArray(finding.findings)) return finding;
        const isSubtherapeutic = finding.findings.some(code => subtherapeuticCodes.includes(String(code)));
        if (!isSubtherapeutic) return finding;
        const updated = { ...finding };
        if (gating.shouldGateForAdherence) {
          updated.adherenceGated = true;
          updated.recommendation = _t('cds.dose.adherenceGated');
          updated.message = updated.message || updated.recommendation;
          adherenceGateApplied = true;
        } else if (gating.shouldGateForEarlyTherapy) {
          updated.waitPeriodGated = true;
          updated.recommendation = _t('cds.dose.waitPeriodGated');
          updated.message = updated.message || updated.recommendation;
          waitGateApplied = true;
        }
        return updated;
      });
    }

    if (adherenceGateApplied) {
      const note = _t('cds.dose.adherenceGateNote');
      this.addSpecialConsideration(analysis, {
        name: _t('cds.dose.adherenceGateName'),
        type: 'adherence',
        severity: 'medium',
        text: note
      });
    }

    if (waitGateApplied) {
      const note = _t('cds.dose.waitPeriodGateNote');
      this.addSpecialConsideration(analysis, {
        name: _t('cds.dose.waitPeriodGateName'),
        type: 'optimization',
        severity: 'info',
        text: note
      });
    }
  }

  addSpecialConsideration(analysis, consideration) {
    if (!analysis || !consideration) return;
    analysis.specialConsiderations = analysis.specialConsiderations || [];
    if (!analysis.specialConsiderations.some(sc => sc.text === consideration.text)) {
      analysis.specialConsiderations.push({ ...consideration });
    }

    if (analysis.treatmentRecommendations) {
      analysis.treatmentRecommendations.specialConsiderations = analysis.treatmentRecommendations.specialConsiderations || [];
      if (!analysis.treatmentRecommendations.specialConsiderations.some(sc => sc.text === consideration.text)) {
        analysis.treatmentRecommendations.specialConsiderations.push({ ...consideration });
      }
    }
  }

  applySideEffectDrivenDecisions(analysis, patientContext) {
    const followUp = patientContext?.followUp || {};
    const adverseEffects = this.normalizeAdverseEffectsList(
      followUp.adverseEffects ||
      patientContext?.clinicalFlags?.adverseEffects ||
      patientContext?.adverseEffects
    );
    if (adverseEffects.length === 0) return;

    const meds = (patientContext.regimen?.medications || []).map(m => (m?.name || m?.medication || m?.drug || '').toString().toLowerCase()).filter(Boolean);
    const hasMedication = (needle) => meds.some(name => name.includes(needle));
    const hasEffectKeyword = (keywords) => adverseEffects.some(effect => keywords.some(keyword => effect.includes(keyword)));

    const severeScenarios = [
      {
        id: 'carbamazepine_severe_rash',
        drugNeedle: 'carbamazepine',
        keywords: ['rash', 'skin rash', 'blister', 'stevens'],
        message: _t('cds.safety.severeRashCbz'),
        rationale: _t('cds.safety.severeRashCbzRationale'),
        nextSteps: [_t('cds.safety.stopCbzImmediately'), _t('cds.safety.urgentDermatologyReview'), _t('cds.safety.startAlternativeAsm')]
      },
      {
        id: 'lamotrigine_severe_rash',
        drugNeedle: 'lamotrigine',
        keywords: ['rash', 'skin rash', 'blister', 'stevens'],
        message: _t('cds.safety.severeRashLtg'),
        rationale: _t('cds.safety.severeRashLtgRationale'),
        nextSteps: [_t('cds.safety.stopLtgImmediately'), _t('cds.safety.urgentDermatologyReview'), _t('cds.safety.startAlternativeAsm')]
      },
      {
        id: 'phenytoin_severe_rash',
        drugNeedle: 'phenytoin',
        keywords: ['rash', 'skin rash', 'blister', 'stevens'],
        message: _t('cds.safety.severeRashPht'),
        rationale: _t('cds.safety.severeRashPhtRationale'),
        nextSteps: [_t('cds.safety.stopPhtImmediately'), _t('cds.safety.urgentDermatologyReview'), _t('cds.safety.startAlternativeAsm')]
      },
      {
        id: 'phenytoin_gingival_hyperplasia',
        drugNeedle: 'phenytoin',
        keywords: ['gingival', 'gum hyperplasia', 'gum swelling'],
        message: _t('cds.safety.gingivalHyperplasia'),
        rationale: _t('cds.safety.gingivalHyperplasiaRationale'),
        nextSteps: [_t('cds.safety.gingivalStep1'), _t('cds.safety.gingivalStep2'), _t('cds.safety.gingivalStep3')]
      }
    ];

    severeScenarios.forEach(severe => {
      if (!hasMedication(severe.drugNeedle)) return;
      if (!hasEffectKeyword(severe.keywords)) return;
      const warning = {
        id: severe.id,
        severity: 'high',
        text: severe.message,
        rationale: severe.rationale,
        nextSteps: severe.nextSteps,
        ruleId: severe.id,
        category: 'safety'
      };
      analysis.warnings.push(warning);
      this.addSpecialConsideration(analysis, {
        name: severe.message,
        type: 'safety',
        severity: 'high',
        text: severe.message
      });
      analysis.treatmentRecommendations = analysis.treatmentRecommendations || {};
      analysis.treatmentRecommendations.regimenChanges = analysis.treatmentRecommendations.regimenChanges || [];
      analysis.treatmentRecommendations.regimenChanges.push({
        type: 'drug_change',
        drug: severe.drugNeedle,
        recommendation: severe.message,
        reason: severe.rationale
      });
    });

    const toxicityScenarios = [
      {
        id: 'carbamazepine_toxicity_neurologic',
        drugNeedle: 'carbamazepine',
        keywords: ['ataxia', 'diplopia', 'double vision', 'unsteady', 'giddiness', 'dizziness'],
        message: _t('cds.safety.neurotoxicityCbz'),
        rationale: _t('cds.safety.neurotoxicityCbzRationale'),
        nextSteps: [_t('cds.safety.checkCbzLevels'), _t('cds.safety.reduceDoseReassess'), _t('cds.safety.assessFallsRisk')]
      },
      {
        id: 'phenytoin_toxicity_neurologic',
        drugNeedle: 'phenytoin',
        keywords: ['ataxia', 'diplopia', 'double vision', 'unsteady', 'nystagmus', 'giddiness', 'dizziness'],
        message: _t('cds.safety.neurotoxicityPht'),
        rationale: _t('cds.safety.neurotoxicityPhtRationale'),
        nextSteps: [_t('cds.safety.checkPhtLevels'), _t('cds.safety.reduceDoseReassess'), _t('cds.safety.assessFallsRisk')]
      }
    ];

    toxicityScenarios.forEach(tox => {
      if (!hasMedication(tox.drugNeedle)) return;
      if (!hasEffectKeyword(tox.keywords)) return;
      let touchedDoseFinding = false;
      if (Array.isArray(analysis.doseFindings)) {
        analysis.doseFindings = analysis.doseFindings.map(f => {
          const drugLabel = (f?.drug || f?.medication || '').toString().toLowerCase();
          if (drugLabel.includes(tox.drugNeedle) || meds.length === 1) {
            touchedDoseFinding = true;
            return {
              ...f,
              toxicityFlag: true,
              recommendation: _t('cds.dose.toxicityDoseReduction'),
              message: f.message || _t('cds.dose.toxicityDoseReduction')
            };
          }
          return f;
        });
      }
      this.addSpecialConsideration(analysis, {
        name: _t('cds.safety.holdUptitration'),
        type: 'safety',
        severity: 'medium',
        text: tox.message
      });
      if (!touchedDoseFinding) {
        analysis.warnings.push({
          id: tox.id,
          severity: 'medium',
          text: tox.message,
          rationale: tox.rationale,
          nextSteps: tox.nextSteps,
          category: 'safety'
        });
      }
    });
  }

  normalizeAdverseEffectsList(rawValue) {
    if (!rawValue && rawValue !== 0) return [];
    let list = [];
    if (Array.isArray(rawValue)) {
      list = rawValue;
    } else if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) list = parsed;
        } catch (e) {
          list = trimmed.split(/[,;|\n]+/);
        }
      } else {
        list = trimmed.split(/[,;|\n]+/);
      }
    } else if (typeof rawValue === 'object') {
      list = Object.values(rawValue).filter(Boolean);
    }
    return list
      .map(entry => (entry === undefined || entry === null ? '' : entry).toString().toLowerCase().trim())
      .filter(Boolean);
  }

  computeDoseGatingContext(patientContext) {
    const followUp = patientContext?.followUp || {};
    const step3 = followUp.step3 || {};
    const adherenceRaw = (step3.adherence || followUp.adherence || patientContext.clinicalFlags?.adherencePattern || '').toString().toUpperCase();
    const poorAdherence = ['OCCASIONALLY MISS', 'FREQUENT', 'FREQUENTLY MISS', 'COMPLETELY STOPPED MEDICINE', 'STOPPED'].includes(adherenceRaw);

    const seizureCandidates = [
      followUp.seizuresSinceLastVisit,
      patientContext.seizuresSinceLastVisit,
      step3.seizureCount
    ];
    let numericSeizureCount = 0;
    for (const candidate of seizureCandidates) {
      const val = Number(candidate);
      if (!Number.isNaN(val)) {
        numericSeizureCount = val;
        break;
      }
    }

    const lowSeizureBurden = numericSeizureCount < 2;
    const injuryReported = this.hasReportedSeizureInjury(followUp);
    const daysSinceLast = typeof followUp.daysSinceLastVisit === 'number'
      ? followUp.daysSinceLastVisit
      : (typeof step3.daysSinceLast === 'number' ? step3.daysSinceLast : null);
    const shouldGateForEarlyTherapy = !injuryReported && typeof daysSinceLast === 'number' && daysSinceLast >= 0 && daysSinceLast < 60 && numericSeizureCount > 0;

    return {
      adherenceRaw,
      numericSeizureCount,
      lowSeizureBurden,
      hasInjury: injuryReported,
      daysSinceLast,
      shouldGateForAdherence: poorAdherence && lowSeizureBurden,
      shouldGateForEarlyTherapy
    };
  }

  hasReportedSeizureInjury(followUp = {}) {
    if (!followUp) return false;
    if (followUp.hasSeizureInjury !== undefined) return !!followUp.hasSeizureInjury;
    if (typeof followUp.seizureInjuryNotes === 'string' && followUp.seizureInjuryNotes.trim().length > 0) return true;
    if (Array.isArray(followUp.injuryList) && followUp.injuryList.length > 0) return true;
    if (typeof followUp.injuryList === 'string' && followUp.injuryList.trim().length > 0) return true;
    return false;
  }

  parseInjurySelection(rawValue) {
    if (!rawValue && rawValue !== 0) return null;
    if (Array.isArray(rawValue)) {
      return rawValue.filter(Boolean);
    }
    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean);
        }
        if (parsed && Array.isArray(parsed.parts)) {
          return parsed.parts.filter(Boolean);
        }
      } catch (e) {
        // Not JSON, fall through to delimiter split
      }
      return trimmed.split(/[,;|\n]+/).map(part => part.trim()).filter(Boolean);
    }
    if (typeof rawValue === 'object') {
      if (Array.isArray(rawValue.parts)) {
        return rawValue.parts.filter(Boolean);
      }
      if (Array.isArray(rawValue.list)) {
        return rawValue.list.filter(Boolean);
      }
      return Object.values(rawValue).filter(Boolean);
    }
    return null;
  }

  /**
   * Analyze medication doses against formulary and generate dose findings
   * @param {Array} medications - Array of medication objects
   * @param {Object} demographics - Patient demographics (age, weight, etc.)
   * @returns {Array} Array of dose finding objects
   */
  analyzeMedicationDoses(medications, demographics, formularyOverride) {
  if (typeof window.Logger?.debug === 'function') window.Logger.debug('analyzeMedicationDoses: received medications:', medications, 'demographics:', demographics);
    if (!medications || !Array.isArray(medications) || !demographics) {
      return [];
    }

    const doseFindings = [];
    const weightKg = demographics.weightKg;

    if (!weightKg || weightKg <= 0) {
      return [{
        drug: 'unknown',
        dailyMg: 0,
        mgPerKg: 0,
        findings: ['weight_not_available'],
        recommendation: _t('cds.dose.weightNotAvailable')
      }];
    }

  // Access formulary: prefer provided override (from backend KB), fallback to global scope
  const formulary = formularyOverride || (typeof getFormularyData === 'function' ? getFormularyData() : {});

    medications.forEach(med => {
  if (typeof window.Logger?.debug === 'function') window.Logger.debug('analyzeMedicationDoses: processing med', med);
      const drugName = (med.name || '').toLowerCase().trim();
      let dailyMg = med.dailyMg || this.parseDoseToDailyMg(med.dosage || '');
      // Fallback to global dose parser from dose-adequacy if available
      if ((!dailyMg || isNaN(dailyMg)) && typeof window.parseDoseToDailyMg === 'function') {
        try {
          dailyMg = window.parseDoseToDailyMg(med.dosage || '');
        } catch (e) { window.Logger.warn('Fallback parseDoseToDailyMg failed', e); }
      }
      // final fallback: try trimmed numeric dose without frequency
      if ((!dailyMg || isNaN(dailyMg)) && med.dosage) {
        const m = String(med.dosage).match(/(\d+(?:\.\d+)?)/);
        if (m) dailyMg = parseFloat(m[1]);
      }
  if (typeof window.Logger?.debug === 'function') window.Logger.debug('analyzeMedicationDoses: parsed drugName, dailyMg', drugName, dailyMg);

      if (!drugName || !dailyMg) return;

      // Find matching drug in formulary
      let drugData = null;
      for (const [key, data] of Object.entries(formulary)) {
        const synonyms = data.synonyms || [];
        if (key.toLowerCase() === drugName ||
            synonyms.some(syn => syn.toLowerCase() === drugName)) {
          drugData = data;
          break;
        }
      }

      if (!drugData) {
        doseFindings.push({
          drug: med.name,
          dailyMg: dailyMg,
          mgPerKg: (dailyMg / weightKg).toFixed(1),
          findings: ['drug_not_in_formulary'],
          recommendation: _t('cds.dose.drugNotInFormulary')
        });
        return;
      }

  const mgPerKg = dailyMg / weightKg;
  const findings = [];
  let recommendation = '';
  let severity = 'info';
  let message = '';
  let recommendedTargetDailyMg = null;
  let recommendedTargetMgPerKg = null;

      // Weight-based analysis
      const dosing = drugData.dosing;
      if (dosing && dosing.min_mg_kg != null && dosing.max_mg_kg != null) {
        if (mgPerKg < dosing.min_mg_kg) {
          findings.push('below_mg_per_kg');
          severity = 'medium';
          message = _t('cds.dose.subtherapeuticFor', { drug: drugData.name });
          const minDose = Math.ceil(dosing.min_mg_kg * weightKg);
          recommendation = _t('cds.dose.considerIncreasing', { minDose: minDose, minMgKg: dosing.min_mg_kg });
        } else if (mgPerKg > dosing.max_mg_kg) {
          findings.push('above_mg_per_kg');
          severity = 'medium';
          message = _t('cds.dose.exceedsRange', { drug: drugData.name });
          const maxDose = Math.floor(dosing.max_mg_kg * weightKg);
          recommendation = _t('cds.dose.considerReducing', { maxDose: maxDose, maxMgKg: dosing.max_mg_kg });
        } else {
          findings.push('adequate_dose');
          severity = 'info';
          message = _t('cds.dose.withinRange', { drug: drugData.name });
          recommendation = _t('cds.dose.doseWithinRange');
        }
      }

      // Compute recommended targets if available
      if (drugData.dosing && drugData.dosing.optimal_mg_kg) {
        recommendedTargetMgPerKg = drugData.dosing.optimal_mg_kg;
        recommendedTargetDailyMg = Math.round(recommendedTargetMgPerKg * weightKg);
      }

      doseFindings.push({
        medication: med.name,
        drugKey: drugName,
        dailyMg: dailyMg,
        mgPerKg: Number(mgPerKg.toFixed(1)),
        findings: findings,
        recommendation: recommendation,
        message: message || recommendation,
        severity: severity,
        recommendedTargetMgPerKg: recommendedTargetMgPerKg,
        recommendedTargetDailyMg: recommendedTargetDailyMg,
        current: `${dailyMg} mg/day`,
        recommended: recommendedTargetDailyMg ? { target: `${recommendedTargetDailyMg}`, unit: 'mg/day' } : null
      });
    });

    return doseFindings;
  }

  /**
   * Parse dose string to daily mg (fallback if not provided)
   * @param {string} doseStr - Dose string like "500 mg BD"
   * @returns {number|null} Daily mg or null
   */
  parseDoseToDailyMg(doseStr) {
    if (!doseStr || typeof doseStr !== 'string') return null;
    const str = doseStr.toLowerCase().trim();
    const match = str.match(/(\d+(?:\.\d+)?)\s*mg\s*(od|bd|tds|qds?|qid|tid|hs|nocte|daily|twice|thrice)/i);
    if (!match) return null;

    const strength = parseFloat(match[1]);
    const freqStr = match[2].toLowerCase();

    let frequency = 1;
    switch (freqStr) {
      case 'od': case 'daily': case 'hs': case 'nocte': frequency = 1; break;
      case 'bd': case 'twice': frequency = 2; break;
      case 'tds': case 'tid': case 'thrice': frequency = 3; break;
      case 'qds': case 'qid': frequency = 4; break;
    }

    return strength * frequency;
  }

  /**
   * Apply chronic medication monitoring rules (VPA, phenytoin, bone health, folic acid)
   */
  applyChronicMonitoringRules(analysis, patientContext) {
    const meds = (patientContext.regimen?.medications || []).map(m => (m?.name || '').toString().toLowerCase());
    const demographics = patientContext.demographics || {};
    const age = demographics.age || 0;
    const gender = (demographics.gender || '').toString().toLowerCase();
    const weightKg = demographics.weightKg || demographics.weight || null;
    const followUp = patientContext.followUp || {};
    
    // A. Valproate chronic monitoring (weight gain + PCOS screening in females)
    const hasValproate = meds.some(name => name.includes('valpro') || name.includes('sodium valproate'));
    if (hasValproate && gender === 'female' && age >= 12 && age <= 50) {
      const weightGain = patientContext.weightGain || followUp.weightGain || false;
      const irregularMenses = patientContext.irregularMenses || followUp.irregularMenses || false;
      
      // Track weight changes
      analysis.prompts.push({
        id: 'valproate_weight_pcos_monitoring',
        severity: 'medium',
        text: _t('cds.monitoring.valproateWeightPcos'),
        rationale: _t('cds.monitoring.valproateWeightPcosRationale'),
        nextSteps: [
          _t('cds.monitoring.valproateWeightPcosStep1'),
          _t('cds.monitoring.valproateWeightPcosStep2'),
          _t('cds.monitoring.valproateWeightPcosStep3')
        ],
        category: 'chronic_monitoring',
        ruleId: 'valproate_chronic_monitoring'
      });
      
      // Escalate if weight gain or PCOS signs detected
      if (weightGain || irregularMenses) {
        const threshold = weightKg ? (weightKg * 0.10) : null;
        const escalationText = threshold 
          ? _t('cds.monitoring.valproateEscalationWithThreshold', { threshold: threshold.toFixed(1) })
          : _t('cds.monitoring.valproateEscalation');
        
        analysis.warnings.push({
          id: 'valproate_weight_pcos_escalation',
          severity: 'high',
          text: escalationText + ' ' + _t('cds.monitoring.valproateEscalationAction'),
          rationale: _t('cds.monitoring.valproateEscalationRationale'),
          nextSteps: [
            _t('cds.monitoring.valproateEscalationStep1'),
            _t('cds.monitoring.valproateEscalationStep2'),
            _t('cds.monitoring.valproateEscalationStep3')
          ],
          category: 'safety',
          ruleId: 'valproate_metabolic_escalation'
        });
      }
    }
    
    // B. Folic acid mandate for all women of reproductive age on AEDs
    const isReproductiveAge = gender === 'female' && age >= 12 && age <= 50;
    const hasFolicAcid = meds.some(name => name.includes('folic') || name.includes('folate'));
    if (isReproductiveAge && meds.length > 0 && !hasFolicAcid) {
      analysis.prompts.push({
        id: 'folic_acid_mandate',
        severity: 'medium',
        text: _t('cds.monitoring.folicAcidMandate'),
        rationale: _t('cds.monitoring.folicAcidMandateRationale'),
        nextSteps: [
          _t('cds.monitoring.folicAcidStep1'),
          _t('cds.monitoring.folicAcidStep2'),
          _t('cds.monitoring.folicAcidStep3')
        ],
        category: 'preventive_care',
        ruleId: 'folic_acid_universal_mandate'
      });
    }
    
    // C. Chronic phenytoin monitoring (gingival hyperplasia + hirsutism)
    const hasPhenytoin = meds.some(name => name.includes('phenytoin') || name.includes('eptoin') || name.includes('dilantin'));
    if (hasPhenytoin) {
      analysis.prompts.push({
        id: 'phenytoin_chronic_monitoring',
        severity: 'medium',
        text: _t('cds.monitoring.phenytoinChronic'),
        rationale: _t('cds.monitoring.phenytoinChronicRationale'),
        nextSteps: [
          _t('cds.monitoring.phenytoinChronicStep1'),
          _t('cds.monitoring.phenytoinChronicStep2'),
          _t('cds.monitoring.phenytoinChronicStep3'),
          _t('cds.monitoring.phenytoinChronicStep4')
        ],
        category: 'chronic_monitoring',
        ruleId: 'phenytoin_chronic_effects'
      });
    }
    
    // D. Bone health monitoring in elderly on enzyme inducers
    const isElderly = age >= 65;
    const enzymeInducers = ['carbamazepine', 'phenytoin', 'phenobarbital'];
    const hasEnzymeInducer = meds.some(name => enzymeInducers.some(ei => name.includes(ei)));
    
    if (isElderly && hasEnzymeInducer) {
      analysis.prompts.push({
        id: 'elderly_bone_health_monitoring',
        severity: 'info',
        text: _t('cds.monitoring.elderlyBoneHealth'),
        rationale: _t('cds.monitoring.elderlyBoneHealthRationale'),
        nextSteps: [
          _t('cds.monitoring.elderlyBoneHealthStep1'),
          _t('cds.monitoring.elderlyBoneHealthStep2'),
          _t('cds.monitoring.elderlyBoneHealthStep3'),
          _t('cds.monitoring.elderlyBoneHealthStep4')
        ],
        category: 'chronic_monitoring',
        ruleId: 'elderly_bone_health'
      });
    }
  }

  applyAdherenceInterventions(analysis, patientContext) {
    const adherence = (patientContext.clinicalFlags?.adherencePattern || '').toString().toUpperCase();
    if (!adherence) return;

    const poorPatterns = ['OCCASIONALLY MISS', 'FREQUENTLY MISS', 'COMPLETELY STOPPED MEDICINE'];
    if (!poorPatterns.includes(adherence)) return;

    if (!analysis.additionalPrompts) analysis.additionalPrompts = [];

    if (adherence === 'COMPLETELY STOPPED MEDICINE') {
      analysis.additionalPrompts.push({
        id: 'adherence_stopped',
        severity: 'high',
        text: _t('cds.adherence.stoppedMedication'),
        nextSteps: [
          _t('cds.adherence.stoppedStep1'),
          _t('cds.adherence.stoppedStep2'),
          _t('cds.adherence.stoppedStep3')
        ]
      });
    } else if (adherence === 'FREQUENTLY MISS') {
      analysis.additionalPrompts.push({
        id: 'adherence_frequent_miss',
        severity: 'medium',
        text: _t('cds.adherence.frequentMiss'),
        nextSteps: [
          _t('cds.adherence.frequentMissStep1'),
          _t('cds.adherence.frequentMissStep2'),
          _t('cds.adherence.frequentMissStep3')
        ]
      });
    } else {
      analysis.additionalPrompts.push({
        id: 'adherence_occasional_miss',
        severity: 'low',
        text: _t('cds.adherence.occasionalMiss'),
        nextSteps: [
          _t('cds.adherence.occasionalMissStep1'),
          _t('cds.adherence.occasionalMissStep2')
        ]
      });
    }
  }

  /**
   * COMPREHENSIVE POLYTHERAPY RATIONALITY MATRIX
   * Evaluates drug combinations based on mechanism synergy and interaction risk
   * Version 1.3.0
   */
  applyPolytherapyRationalityChecks(analysis, patientContext) {
    const medications = patientContext.regimen?.medications || [];
    if (medications.length < 2) return; // Only for polytherapy
    
    // Mechanism classification for all epilepsy drugs
    const drugMechanisms = {
      'carbamazepine': ['sodium_channel_blocker', 'enzyme_inducer'],
      'phenytoin': ['sodium_channel_blocker', 'enzyme_inducer'],
      'oxcarbazepine': ['sodium_channel_blocker', 'weak_enzyme_inducer'],
      'lamotrigine': ['sodium_channel_blocker', 'glutamate_inhibitor'],
      'levetiracetam': ['sv2a_modulator', 'unique_mechanism'],
      'valproate': ['gaba_enhancer', 'broad_spectrum', 'enzyme_inhibitor'],
      'clobazam': ['gaba_enhancer', 'benzodiazepine', 'sedating'],
      'phenobarbital': ['gaba_enhancer', 'enzyme_inducer', 'sedating'],
      'topiramate': ['sodium_channel_blocker', 'gaba_enhancer', 'glutamate_inhibitor'],
      'gabapentin': ['gaba_analog', 'calcium_channel_modulator'],
      'pregabalin': ['gaba_analog', 'calcium_channel_modulator']
    };
    
    // Classify active medications
    const activeDrugs = medications.map(med => {
      const name = (med.name || '').toString().toLowerCase();
      const matchedDrug = Object.keys(drugMechanisms).find(drug => name.includes(drug));
      return {
        name: med.name,
        normalized: matchedDrug || 'unknown',
        mechanisms: matchedDrug ? drugMechanisms[matchedDrug] : []
      };
    }).filter(d => d.mechanisms.length > 0);
    
    // RATIONALITY SCORING MATRIX
    // Scores: 5 = Excellent synergy, 4 = Good, 3 = Acceptable, 2 = Questionable, 1 = Non-rational
    const combinationRatings = {
      // EXCELLENT COMBINATIONS (Score 5)
      'levetiracetam+lamotrigine': { score: 5, risk: 'low', reason: 'Complementary mechanisms, no PK interactions' },
      'levetiracetam+valproate': { score: 5, risk: 'low', reason: 'Broad spectrum + unique mechanism, minimal interactions' },
      'levetiracetam+clobazam': { score: 5, risk: 'low', reason: 'Different mechanisms, good focal + generalized coverage' },
      'lamotrigine+clobazam': { score: 5, risk: 'low', reason: 'Sodium channel + GABAergic, complementary' },
      
      // GOOD COMBINATIONS (Score 4)
      'valproate+lamotrigine': { score: 4, risk: 'medium', reason: 'Synergistic but requires lamotrigine dose reduction (VPA inhibits metabolism)', interaction: 'Reduce lamotrigine to 50% of usual dose' },
      'levetiracetam+topiramate': { score: 4, risk: 'low', reason: 'Different primary mechanisms, may have additive cognitive effects' },
      'valproate+clobazam': { score: 4, risk: 'medium', reason: 'Both GABAergic but different subtypes, watch for sedation' },
      
      // ACCEPTABLE COMBINATIONS (Score 3)
      'carbamazepine+clobazam': { score: 3, risk: 'medium', reason: 'Different mechanisms but enzyme induction affects clobazam levels', interaction: 'May need higher clobazam doses' },
      'phenytoin+valproate': { score: 3, risk: 'high', reason: 'VPA displaces phenytoin from protein binding', interaction: 'Monitor free phenytoin levels, risk of toxicity' },
      'carbamazepine+valproate': { score: 3, risk: 'medium', reason: 'Opposing metabolic effects, complex interaction', interaction: 'Both may need dose adjustments' },
      
      // QUESTIONABLE COMBINATIONS (Score 2)
      'clobazam+phenobarbital': { score: 2, risk: 'high', reason: 'Both GABAergic and sedating, high risk of oversedation and tolerance' },
      'lamotrigine+carbamazepine': { score: 2, risk: 'high', reason: 'Both sodium channel blockers, enzyme induction reduces lamotrigine levels significantly', interaction: 'Lamotrigine may need 2x dose increase' },
      
      // NON-RATIONAL COMBINATIONS (Score 1)
      'carbamazepine+phenytoin': { score: 1, risk: 'high', reason: 'Both sodium channel blockers + enzyme inducers, no synergy, high neurotoxicity risk' },
      'carbamazepine+oxcarbazepine': { score: 1, risk: 'high', reason: 'Near-identical mechanisms, redundant and increases side effects' },
      'phenytoin+lamotrigine': { score: 1, risk: 'high', reason: 'Both sodium channel blockers, phenytoin induces lamotrigine metabolism', interaction: 'Requires very high lamotrigine doses' }
    };
    
    // Evaluate all pairwise combinations
    for (let i = 0; i < activeDrugs.length; i++) {
      for (let j = i + 1; j < activeDrugs.length; j++) {
        const drug1 = activeDrugs[i];
        const drug2 = activeDrugs[j];
        const pairKey = [drug1.normalized, drug2.normalized].sort().join('+');
        const rating = combinationRatings[pairKey];
        
        if (rating) {
          // Specific documented combination
          if (rating.score <= 2) {
            analysis.warnings.push({
              id: `polytherapy_${rating.score === 1 ? 'non_rational' : 'questionable'}_${drug1.normalized}_${drug2.normalized}`,
              severity: rating.score === 1 ? 'high' : 'medium',
              text: `${rating.score === 1 ? _t('cds.polytherapy.nonRational') : _t('cds.polytherapy.questionable')}: ${drug1.name} + ${drug2.name} (${_t('cds.polytherapy.score', { score: rating.score })})`,
              rationale: rating.reason,
              nextSteps: [
                rating.interaction ? rating.interaction : _t('cds.polytherapy.reviewCombination'),
                rating.score === 1 ? _t('cds.polytherapy.consolidateToSingle') : _t('cds.polytherapy.monitorAdverseEffects'),
                _t('cds.polytherapy.consultSpecialist')
              ],
              category: 'polytherapy_rationality',
              ruleId: 'polytherapy_matrix_v1_3'
            });
          } else if (rating.score >= 4 && rating.interaction) {
            // Good combinations with specific dosing guidance
            analysis.prompts.push({
              id: `polytherapy_good_${drug1.normalized}_${drug2.normalized}`,
              severity: 'info',
              text: `${_t('cds.polytherapy.rationalPolytherapy')}: ${drug1.name} + ${drug2.name} (${_t('cds.polytherapy.score', { score: rating.score })}) - ${_t('cds.polytherapy.dosingAdjustmentRequired')}`,
              rationale: rating.reason,
              nextSteps: [
                rating.interaction,
                _t('cds.polytherapy.monitorEfficacy'),
                _t('cds.polytherapy.documentRationale')
              ],
              category: 'polytherapy_guidance',
              ruleId: 'polytherapy_matrix_v1_3'
            });
          }
        } else {
          // Undocumented combination - check mechanism overlap
          const sharedMechanisms = drug1.mechanisms.filter(m => drug2.mechanisms.includes(m));
          
          if (sharedMechanisms.includes('sodium_channel_blocker')) {
            analysis.warnings.push({
              id: `polytherapy_sodium_channel_overlap_${drug1.normalized}_${drug2.normalized}`,
              severity: 'high',
              text: `${_t('cds.polytherapy.nonRational')}: ${_t('cds.polytherapy.multipleSodiumChannel', { drug1: drug1.name, drug2: drug2.name })}`,
              rationale: _t('cds.polytherapy.sodiumChannelRationale'),
              nextSteps: [
                _t('cds.polytherapy.consolidateSodiumChannel'),
                _t('cds.polytherapy.addDifferentMechanism'),
                _t('cds.polytherapy.taperRedundant')
              ],
              category: 'polytherapy_rationality',
              ruleId: 'mechanism_overlap_sodium_channel'
            });
          } else if (sharedMechanisms.includes('gaba_enhancer') && 
                     (drug1.mechanisms.includes('sedating') || drug2.mechanisms.includes('sedating'))) {
            analysis.prompts.push({
              id: `polytherapy_gaba_overlap_${drug1.normalized}_${drug2.normalized}`,
              severity: 'medium',
              text: `${_t('cds.polytherapy.cautionGaba', { drug1: drug1.name, drug2: drug2.name })}`,
              rationale: _t('cds.polytherapy.gabaOverlapRationale'),
              nextSteps: [
                _t('cds.polytherapy.monitorSedation'),
                _t('cds.polytherapy.assessFallsElderly'),
                _t('cds.polytherapy.considerAlternativeMechanism')
              ],
              category: 'polytherapy_safety',
              ruleId: 'mechanism_overlap_gaba'
            });
          }
        }
      }
    }
    
    // Check for triple therapy - generally requires specialist oversight
    if (activeDrugs.length >= 3) {
      analysis.prompts.push({
        id: 'polytherapy_triple_therapy',
        severity: 'medium',
        text: `${_t('cds.polytherapy.tripleTherapy', { drugs: activeDrugs.map(d => d.name).join(', ') })}`,
        rationale: _t('cds.polytherapy.tripleTherapyRationale'),
        nextSteps: [
          _t('cds.polytherapy.tripleTherapyStep1'),
          _t('cds.polytherapy.tripleTherapyStep2'),
          _t('cds.polytherapy.tripleTherapyStep3'),
          _t('cds.polytherapy.tripleTherapyStep4')
        ],
        category: 'polytherapy_complexity',
        ruleId: 'triple_therapy_alert'
      });
    }
  }

  // NOTE: Psychosocial screening (NDDI-E) moved to separate module (js/psychosocial-screening.js)
  // This keeps CDS focused on clinical decision support, not mental health screening tools

  /**
   * Collect NDDI-E screening responses from the UI
   * @returns {Object} Screening data ready for backend submission
   */
  collectNDDIEScreeningData() {
    const responses = {};
    const questions = 6;
    let totalScore = 0;
    let allAnswered = true;
    let suicidalityFlag = false;
    
    // Collect responses from radio buttons
    for (let i = 0; i < questions; i++) {
      const selectedRadio = document.querySelector(`input[name="screen_q${i}"]:checked`);
      if (selectedRadio) {
        const answer = selectedRadio.value;
        responses[`q${i + 1}`] = answer;
        
        // Calculate score (Never=1, Rarely=2, Sometimes=3, Often=4, Always=5)
        const scoreMap = { 'Never': 1, 'Rarely': 2, 'Sometimes': 3, 'Often': 4, 'Always': 5 };
        totalScore += scoreMap[answer] || 0;
        
        // Check Q4 for suicidality (index 3)
        if (i === 3 && ['Sometimes', 'Often', 'Always'].includes(answer)) {
          suicidalityFlag = true;
        }
      } else {
        allAnswered = false;
      }
    }
    
    if (!allAnswered) {
      return null; // Not all questions answered
    }
    
    return {
      screeningDate: new Date().toISOString(),
      totalScore: totalScore,
      responses: responses,
      suicidalityFlag: suicidalityFlag,
      referralInitiated: totalScore > 13 || suicidalityFlag,
      completed: true
    };
  }

  /**
   * Save NDDI-E screening data to follow-up record
   * This should be called when submitting follow-up data
   * @param {Object} followUpData - Follow-up data object to augment
   * @returns {Object} Augmented follow-up data with screening fields
   */
  addNDDIEToFollowUpData(followUpData) {
    const screeningData = this.collectNDDIEScreeningData();
    
    if (!screeningData) {
      return followUpData; // No screening completed
    }
    
    // Add screening fields to follow-up submission
    return {
      ...followUpData,
      NDDIEScreeningDate: screeningData.screeningDate,
      NDDIETotalScore: screeningData.totalScore,
      NDDIEResponses: JSON.stringify(screeningData.responses),
      NDDIESuicidalityFlag: screeningData.suicidalityFlag,
      PsychReferralInitiated: screeningData.referralInitiated
    };
  }

  /**
   * Generate treatment recommendations based on patient context
   * @param {Object} patientContext - Patient context from transformFollowUpDataToPatientContext
   * @param {Array} doseFindings - Dose analysis results
   * @returns {Object} Treatment recommendations
   */
  generateTreatmentRecommendations(patientContext, doseFindings) {
    const recommendations = {
      monotherapySuggestion: null,
      addonSuggestion: null,
      regimenChanges: [],
      specialConsiderations: [],
      // Provide a flat list compatible with UI components that expect an array
      recommendationsList: []
    };

    const medications = patientContext.regimen?.medications || [];
    const epilepsyType = patientContext.epilepsy?.epilepsyType || 'unknown';
    const reproductivePotential = patientContext.demographics?.reproductivePotential;
    const failedTwoAdequateTrials = patientContext.clinicalFlags?.failedTwoAdequateTrials;

  // Safety guardrails - highest priority
  // Robust detection: use reproductivePotential flag if available, otherwise infer from age & gender
  const inferredReproductive = reproductivePotential || ((patientContext.demographics?.gender || '').toString().toLowerCase() === 'female' && (patientContext.demographics?.age || 0) >= 12 && (patientContext.demographics?.age || 0) <= 50);
    const medNamesLower = medications.map(m => (m.name || '').toString().toLowerCase());
    const hasValproate = medNamesLower.some(name => name.includes('valpro') || name.includes('valproate') || name.includes('sodium valproate') || name.includes('valproic'));
    if (inferredReproductive && hasValproate) {
      const sc = {
        name: _t('cds.treatment.valproateReproductiveSafety'),
        type: 'safety',
        severity: 'high',
        text: _t('cds.safety.valproateContraindicated'),
        rationale: _t('cds.safety.valproateContraindicatedRationale')
      };
      recommendations.specialConsiderations.push(sc);
      recommendations.recommendationsList.push({
        name: _t('cds.treatment.avoidValproateReproductive'),
        severity: 'high',
        text: sc.text,
        rationale: sc.rationale,
        nextSteps: [_t('cds.treatment.reviewValproateUsage'), _t('cds.treatment.discussAlternativeAgents'), _t('cds.treatment.providePregnancyPrevention')]
      });
    }

    // Polytherapy optimization
  if (medications.length > 1) {
      recommendations.specialConsiderations.push({
        name: _t('cds.polytherapy.optimizationName'),
        type: 'optimization',
        severity: 'medium',
        text: _t('cds.polytherapy.optimizationText')
      });
      recommendations.recommendationsList.push({
        name: _t('cds.polytherapy.optimizationName'),
        severity: 'medium',
        text: _t('cds.polytherapy.optimizationReviewText'),
        nextSteps: [_t('cds.polytherapy.assessSeizureControl'), _t('cds.polytherapy.considerWithdrawalTrial'), _t('cds.polytherapy.optimizeDoseFirstLine')]
      });

      // Check for potentially problematic combinations
      const drugNames = medications.map(m => (m.name || '').toLowerCase());
      if (drugNames.includes('carbamazepine') && drugNames.includes('valproate')) {
        const inter = {
          name: _t('cds.polytherapy.cbzVpaInteractionName'),
          type: 'interaction',
          severity: 'high',
          text: _t('cds.polytherapy.cbzVpaInteractionText')
        };
        recommendations.specialConsiderations.push(inter);
        recommendations.recommendationsList.push({
          name: inter.name,
          severity: 'high',
          text: inter.text,
          nextSteps: [_t('cds.polytherapy.checkVpaLevels'), _t('cds.polytherapy.adjustDoses'), _t('cds.polytherapy.considerAlternativeCombination')]
        });
      }
    }

    // Monotherapy suggestions for new patients or monotherapy optimization
  if (medications.length === 0 || medications.length === 1) {
      let suggestedDrug = null;

      if (epilepsyType === 'focal' || epilepsyType === 'unknown') {
        suggestedDrug = reproductivePotential ? 'levetiracetam' : 'carbamazepine';
      } else if (epilepsyType === 'generalized') {
        suggestedDrug = reproductivePotential ? 'levetiracetam' : 'valproate';
      }

      if (suggestedDrug) {
        recommendations.monotherapySuggestion = suggestedDrug;
        recommendations.recommendationsList.push({
          name: _t('cds.treatment.monotherapySuggestion'),
          severity: 'info',
          text: _t('cds.treatment.considerMonotherapy', { drug: suggestedDrug }),
          nextSteps: [_t('cds.treatment.startAtGuidelineDose', { drug: suggestedDrug })]
        });
      }
    }

    // Add-on suggestions for drug-resistant cases
  if (failedTwoAdequateTrials && medications.length >= 1) {
      const currentDrugs = medications.map(m => (m.name || '').toLowerCase());

      if (!currentDrugs.includes('levetiracetam')) {
        recommendations.addonSuggestion = 'levetiracetam';
        recommendations.recommendationsList.push({
          name: _t('cds.treatment.addOnSuggestion'),
          severity: 'info',
          text: _t('cds.treatment.considerLevetiracetamAddon'),
          nextSteps: [_t('cds.treatment.startLowDoseTitrate'), _t('cds.treatment.monitorBehavioralSideEffects')]
        });
      } else if (!currentDrugs.includes('clobazam')) {
        recommendations.addonSuggestion = 'clobazam';
        recommendations.recommendationsList.push({
          name: _t('cds.treatment.addOnSuggestion'),
          severity: 'info',
          text: _t('cds.treatment.considerClobazamAddon'),
          nextSteps: [_t('cds.treatment.startClobazamMonitorSedation'), _t('cds.treatment.considerDoseTaper')]
        });
      }
    }

    // Dose optimization recommendations
    const inadequateDoses = doseFindings.filter(f =>
      f.findings.includes('below_mg_per_kg') || f.findings.includes('above_mg_per_kg') ||
      f.findings.includes('excessive_dose'));

    if (inadequateDoses.length > 0) {
      // Provide specific dose adjustments for each inadequate finding
      inadequateDoses.forEach(f => {
        const drug = f.medication || f.drug || f.drugKey || f.name || 'unknown';
        const recText = f.recommendedTargetDailyMg ? _t('cds.dose.adjustDrug', { drug: drug, target: f.recommendedTargetDailyMg, mgKg: f.recommendedTargetMgPerKg }) : _t('cds.dose.reviewAndAdjust');
        recommendations.regimenChanges.push({
          type: 'dose_adjustment',
          drug: drug,
          currentDailyMg: f.dailyMg || f.currentDose || null,
          recommendedDailyMg: f.recommendedTargetDailyMg || null,
          recommendation: recText
        });
        recommendations.recommendationsList.push({
          name: _t('cds.dose.adjustmentFor', { drug: drug }),
          severity: f.severity || 'medium',
          text: recText,
          rationale: f.message || f.recommendation || '',
          nextSteps: [_t('cds.dose.discussDoseChange'), _t('cds.dose.repeatAssessment'), _t('cds.dose.monitorEfficacy')]
        });
      });
    }

    // Also populate a lightweight plan summary for the UI
    recommendations.plan = {
      monotherapySuggestion: recommendations.monotherapySuggestion,
      addonSuggestion: recommendations.addonSuggestion,
      referral: recommendations.specialConsiderations.some(sc => sc.type === 'safety' && sc.severity === 'high') ? _t('cds.treatment.considerSpecialistReferral') : null
    };

    return recommendations;
  }
}

// Make CDSIntegration class globally available
window.CDSIntegration = CDSIntegration;

// Initialize global CDS integration instance
window.cdsIntegration = new CDSIntegration();

// Expose helpers for Node-based tests (after class definition)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseMedicationStringHelper,
    CDSIntegration,
    parseMedicationString: function(medString) { return parseMedicationStringHelper(medString); }
  };
}
