/**
 * Offline Form Handler
 * Provides form auto-save, draft recovery, and offline mode indicators
 * 
 * Features:
 * - Auto-save form drafts every 30 seconds
 * - Detect offline/online state and update UI
 * - Recover form draft on page reload
 * - Clear draft after successful submission
 * - Display offline mode indicator on forms
 * - Visual feedback for draft save status
 * 
 * Author: Offline Enhancement Suite
 * Date: Feb 15, 2026
 */

class OfflineFormHandler {
    constructor() {
        this.DB_NAME = 'EpicareOfflineDB';
        this.FORM_DRAFTS_STORE = 'formDrafts';
        this.AUTO_SAVE_INTERVAL = 30000; // 30 seconds
        this.DRAFT_EXPIRY_DAYS = 7;
        this.autoSaveIntervals = new Map();
        this.draftStatus = {};
        
        this.init();
    }
    
    /**
     * Initialize offline form handler
     */
    async init() {
        // Create IndexedDB store if needed
        await this._ensureDBReady();
        
        // Listen for online/offline events
        window.addEventListener('online', () => this._handleOnline());
        window.addEventListener('offline', () => this._handleOffline());
        
        // Check initial state
        if (!navigator.onLine) {
            this._handleOffline();
        } else {
            this._handleOnline();
        }
        
        window.Logger && window.Logger.debug('[OfflineFormHandler] Initialized');
    }
    
    /**
     * Register a form for auto-save and offline handling
     * @param {string} formId - ID of the form element
     * @param {Object} options - Configuration options
     */
    registerForm(formId, options = {}) {
        const form = document.getElementById(formId);
        if (!form) {
            window.Logger && window.Logger.warn('[OfflineFormHandler] Form not found:', formId);
            return;
        }
        
        const formConfig = {
            formId: formId,
            includeFields: options.includeFields || null, // null = all fields
            excludeFields: options.excludeFields || ['sessionToken', 'csrf'],
            onSaveCallback: options.onSaveCallback || null,
            onRecoverCallback: options.onRecoverCallback || null,
            clearDraftOnSubmit: options.clearDraftOnSubmit !== false,
            showIndicator: options.showIndicator !== false
        };
        
        // Add offline indicator if requested
        if (formConfig.showIndicator) {
            this._addOfflineIndicator(form, formId);
        }
        
        // Try to recover draft
        this._recoverDraft(formId, formConfig);
        
        // Start auto-save
        this._startAutoSave(formId, formConfig);
        
        // Clear draft on form submission
        form.addEventListener('submit', (e) => {
            if (formConfig.clearDraftOnSubmit) {
                this.clearDraft(formId);
            }
        });
        
        window.Logger && window.Logger.debug('[OfflineFormHandler] Form registered:', formId);
    }
    
    /**
     * Manually save form draft
     * @param {string} formId - Form ID to save
     * @returns {Promise<boolean>} Success status
     */
    async saveDraft(formId) {
        try {
            const form = document.getElementById(formId);
            if (!form) return false;
            
            const formData = this._extractFormData(form, formId);
            const draftKey = `draft_${formId}`;
            
            const db = await this._openDB();
            const tx = db.transaction([this.FORM_DRAFTS_STORE], 'readwrite');
            const store = tx.objectStore(this.FORM_DRAFTS_STORE);
            
            await store.put({
                id: draftKey,
                formId: formId,
                data: formData,
                timestamp: new Date().toISOString(),
                expiryDate: new Date(Date.now() + this.DRAFT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()
            });
            
            // Update UI indicator
            this._updateSaveIndicator(formId, 'saved');
            
            window.Logger && window.Logger.debug('[OfflineFormHandler] Draft saved:', formId);
            return true;
        } catch (err) {
            window.Logger && window.Logger.error('[OfflineFormHandler] Error saving draft:', err);
            this._updateSaveIndicator(formId, 'error');
            return false;
        }
    }
    
    /**
     * Recover form draft
     * @param {string} formId - Form ID to recover
     * @param {Object} config - Form configuration
     * @returns {Promise<Object|null>} Draft data or null
     */
    async _recoverDraft(formId, config) {
        try {
            const draftKey = `draft_${formId}`;
            const db = await this._openDB();
            const tx = db.transaction([this.FORM_DRAFTS_STORE], 'readonly');
            const store = tx.objectStore(this.FORM_DRAFTS_STORE);
            
            const draft = await store.get(draftKey);
            
            if (draft) {
                // Check if draft has expired
                if (new Date(draft.expiryDate) < new Date()) {
                    window.Logger && window.Logger.debug('[OfflineFormHandler] Draft expired:', formId);
                    await this.clearDraft(formId);
                    return null;
                }
                
                window.Logger && window.Logger.debug('[OfflineFormHandler] Draft recovered:', formId);
                
                // Populate form with draft data
                const form = document.getElementById(formId);
                if (form && draft.data && typeof draft.data === 'object') {
                    this._populateFormFromDraft(form, draft.data);
                    this._showDraftRecoveryNotification(formId, draft.timestamp);
                    
                    // Call callback if provided
                    if (config.onRecoverCallback && typeof config.onRecoverCallback === 'function') {
                        config.onRecoverCallback(draft.data);
                    }
                }
                
                return draft.data;
            }
            
            return null;
        } catch (err) {
            window.Logger && window.Logger.warn('[OfflineFormHandler] Error recovering draft:', err);
            return null;
        }
    }
    
    /**
     * Clear form draft
     * @param {string} formId - Form ID
     * @returns {Promise<boolean>} Success status
     */
    async clearDraft(formId) {
        try {
            const draftKey = `draft_${formId}`;
            const db = await this._openDB();
            const tx = db.transaction([this.FORM_DRAFTS_STORE], 'readwrite');
            const store = tx.objectStore(this.FORM_DRAFTS_STORE);
            
            await store.delete(draftKey);
            
            window.Logger && window.Logger.debug('[OfflineFormHandler] Draft cleared:', formId);
            return true;
        } catch (err) {
            window.Logger && window.Logger.error('[OfflineFormHandler] Error clearing draft:', err);
            return false;
        }
    }
    
    /**
     * Start auto-save interval for form
     * @private
     */
    _startAutoSave(formId, config) {
        // Clear any existing interval
        if (this.autoSaveIntervals.has(formId)) {
            clearInterval(this.autoSaveIntervals.get(formId));
        }
        
        // Set up new interval
        const interval = setInterval(async () => {
            const form = document.getElementById(formId);
            if (form && document.visibilityState === 'visible') {
                // Only auto-save when tab is visible to reduce resource usage
                const success = await this.saveDraft(formId);
                
                if (config.onSaveCallback && typeof config.onSaveCallback === 'function') {
                    config.onSaveCallback(success);
                }
            }
        }, this.AUTO_SAVE_INTERVAL);
        
        this.autoSaveIntervals.set(formId, interval);
    }
    
    /**
     * Extract form data into object
     * @private
     */
    _extractFormData(form, formId) {
        const formData = new FormData(form);
        const data = {};
        
        // Get reference config for this form
        const config = this._getFormConfig(formId) || {};
        const excludeFields = config.excludeFields || [];
        const includeFields = config.includeFields || null;
        
        for (const [key, value] of formData.entries()) {
            // Skip excluded fields
            if (excludeFields.includes(key)) continue;
            
            // Skip if includeFields specified and field not in list
            if (includeFields && !includeFields.includes(key)) continue;
            
            // Skip hidden fields by default
            const field = form.elements[key];
            if (field && field.type === 'hidden') continue;
            
            data[key] = value;
        }
        
        return data;
    }
    
    /**
     * Populate form from draft data
     * @private
     */
    _populateFormFromDraft(form, draftData) {
        try {
            // Safely handle null/undefined draft data (typeof null === 'object', so check both)
            if (draftData == null || typeof draftData !== 'object' || Array.isArray(draftData)) {
                window.Logger && window.Logger.warn('[OfflineFormHandler] Invalid draft data received:', typeof draftData);
                return;
            }
            const entries = Object.entries(draftData);
            if (entries.length === 0) {
                window.Logger && window.Logger.debug('[OfflineFormHandler] Draft data is empty, skipping population');
                return;
            }
            for (const [fieldName, value] of entries) {
                const field = form.elements[fieldName];
                if (!field) continue;
                
                if (field.type === 'checkbox') {
                    field.checked = value === 'on' || value === true;
                } else if (field.type === 'radio') {
                    const radio = form.querySelector(`input[name="${fieldName}"][value="${value}"]`);
                    if (radio) radio.checked = true;
                } else if (field.type === 'select-multiple') {
                    const values = Array.isArray(value) ? value : [value];
                    for (const opt of field.options) {
                        opt.selected = values.includes(opt.value);
                    }
                } else {
                    field.value = value;
                }
                
                // Trigger change event for dependent fields
                field.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            window.Logger && window.Logger.debug('[OfflineFormHandler] Form populated from draft');
        } catch (err) {
            window.Logger && window.Logger.warn('[OfflineFormHandler] Error populating form:', err);
        }
    }
    
    /**
     * Add offline indicator to form
     * @private
     */
    _addOfflineIndicator(form, formId) {
        // Check if indicator already exists
        if (document.getElementById(`${formId}-offline-indicator`)) {
            return;
        }
        
        const indicator = document.createElement('div');
        indicator.id = `${formId}-offline-indicator`;
        indicator.className = 'form-offline-indicator offline-hidden';
        indicator.innerHTML = `
            <div class="offline-indicator-content">
                <i class="fas fa-wifi-slash"></i>
                <span class="offline-indicator-text">OFFLINE MODE</span>
                <span class="offline-indicator-status">Form will be saved and submitted when online</span>
            </div>
        `;
        
        // Insert at top of form
        form.insertBefore(indicator, form.firstChild);
        
        // Add auto-save status indicator
        const saveStatus = document.createElement('div');
        saveStatus.id = `${formId}-save-status`;
        saveStatus.className = 'form-save-status save-status-hidden';
        saveStatus.innerHTML = `
            <i class="fas fa-circle-notch fa-spin"></i>
            <span>Saving...</span>
        `;
        
        form.appendChild(saveStatus);
        
        this.draftStatus[formId] = {
            indicator: indicator,
            saveStatus: saveStatus,
            lastSaveTime: null
        };
    }
    
    /**
     * Update save indicator status
     * @private
     */
    _updateSaveIndicator(formId, status) {
        const statusEl = document.getElementById(`${formId}-save-status`);
        if (!statusEl) return;
        
        statusEl.className = 'form-save-status';
        
        switch (status) {
            case 'saving':
                statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><span>Saving...</span>';
                statusEl.classList.remove('save-status-hidden');
                break;
            case 'saved':
                statusEl.innerHTML = '<i class="fas fa-check" style="color: #27ae60;"></i><span style="color: #27ae60;">Saved</span>';
                statusEl.classList.remove('save-status-hidden');
                setTimeout(() => {
                    statusEl.classList.add('save-status-hidden');
                }, 3000);
                break;
            case 'error':
                statusEl.innerHTML = '<i class="fas fa-exclamation-circle" style="color: #e74c3c;"></i><span style="color: #e74c3c;">Save failed</span>';
                statusEl.classList.remove('save-status-hidden');
                break;
        }
    }
    
    /**
     * Show draft recovery notification
     * @private
     */
    _showDraftRecoveryNotification(formId, timestamp) {
        const time = new Date(timestamp).toLocaleTimeString();
        const message = `Draft recovered from ${time}`;
        
        if (typeof showNotification === 'function') {
            showNotification(message, 'info');
        } else if (typeof showToast === 'function') {
            showToast('info', message);
        }
    }
    
    /**
     * Handle online event
     * @private
     */
    _handleOnline() {
        // Update all form indicators
        document.querySelectorAll('.form-offline-indicator').forEach(el => {
            el.classList.add('offline-hidden');
        });
        
        window.Logger && window.Logger.debug('[OfflineFormHandler] Online - hiding offline indicators');
    }
    
    /**
     * Handle offline event
     * @private
     */
    _handleOffline() {
        // Show all form indicators
        document.querySelectorAll('.form-offline-indicator').forEach(el => {
            el.classList.remove('offline-hidden');
        });
        
        window.Logger && window.Logger.debug('[OfflineFormHandler] Offline - showing offline indicators');
    }
    
    /**
     * Get stored form configuration
     * @private
     */
    _getFormConfig(formId) {
        return this.draftStatus[formId];
    }
    
    /**
     * Ensure IndexedDB is ready
     * @private
     */
    async _ensureDBReady() {
        try {
            const db = await this._openDB();
            db.close();
        } catch (err) {
            window.Logger && window.Logger.warn('[OfflineFormHandler] Error ensuring DB ready:', err);
        }
    }
    
    /**
     * Open IndexedDB
     * Creates ALL required object stores for the Epicare offline system.
     * This ensures consistent database schema regardless of which module initializes first.
     * @private
     */
    _openDB() {
        return new Promise((resolve, reject) => {
            // Version 4: Consolidated all object stores from different offline modules
            const request = indexedDB.open(this.DB_NAME, 4);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Form drafts store (used by offline-form-handler.js)
                if (!db.objectStoreNames.contains(this.FORM_DRAFTS_STORE)) {
                    db.createObjectStore(this.FORM_DRAFTS_STORE, { keyPath: 'id' });
                }
                
                // Sync queue store (used by offline-sync.js)
                if (!db.objectStoreNames.contains('syncQueue')) {
                    db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
                }
                
                // Offline patients store (used by offline-sync.js, offline-enhanced.js, offline-patient-ui.js)
                if (!db.objectStoreNames.contains('offlinePatients')) {
                    db.createObjectStore('offlinePatients', { keyPath: 'key' });
                }
                
                // Offline versions store (used by offline-enhanced.js for version tracking)
                if (!db.objectStoreNames.contains('offlineVersions')) {
                    const versionStore = db.createObjectStore('offlineVersions', { keyPath: 'versionId' });
                    versionStore.createIndex('entityId', 'entityId');
                    versionStore.createIndex('entityType', 'entityType');
                    versionStore.createIndex('timestamp', 'timestamp');
                    versionStore.createIndex('synced', 'synced');
                }
                
                // Offline follow-ups store (used by offline-patient-creation.js)
                if (!db.objectStoreNames.contains('offlineFollowUps')) {
                    db.createObjectStore('offlineFollowUps', { keyPath: 'id', autoIncrement: true });
                }
                
                // Audit log store (used by offline-enhanced.js OfflineAuditLogger)
                if (!db.objectStoreNames.contains('auditLog')) {
                    const auditStore = db.createObjectStore('auditLog', { keyPath: 'id' });
                    auditStore.createIndex('timestamp', 'timestamp');
                    auditStore.createIndex('username', 'username');
                    auditStore.createIndex('action', 'action');
                    auditStore.createIndex('synced', 'synced');
                }
                
                window.Logger && window.Logger.debug('[OfflineFormHandler] Database schema upgraded to version 4');
            };
        });
    }
}

// Initialize globally
window.OfflineFormHandler = new OfflineFormHandler();
