/**
 * Offline Patient Creation Manager
 * Handles offline patient creation with duplicate detection, validation, queuing, and sync merge
 * 
 * Features:
 * - Local duplicate detection (phone/name in cache and queued)
 * - Online duplicate detection during sync (name + father name + phone)
 * - Complete field validation for offline patients
 * - Temporary ID generation and management
 * - Sync queue integration with CRITICAL priority
 * - Retry/edit capability for failed syncs
 * - Audit logging for all offline patient creations
 * 
 * Author: Offline Enhancement Suite
 * Date: Feb 8, 2026
 */

class OfflinePatientCreationManager {
    constructor() {
        this.DB_NAME = 'EpicareOfflineDB';
        this.PATIENT_STORE = 'offlinePatients';
        this.SYNC_QUEUE_STORE = 'syncQueue';
        this.TEMP_ID_PREFIX = 'TEMP';
        this.MAX_RETRY_ATTEMPTS = 3;
        this.VALIDATION_RULES = {
            PatientName: { required: true, pattern: /^[a-zA-Z\s]{2,50}$/, message: 'Patient name 2-50 characters, letters only' },
            FatherName: { required: false, pattern: /^[a-zA-Z\s]{2,50}$/, message: 'Father name 2-50 characters, letters only' },
            Age: { required: true, pattern: /^\d{1,3}$/, min: 0, max: 120, message: 'Age 0-120 years' },
            Gender: { required: true, pattern: /^(Male|Female|Other)$/, message: 'Select valid gender' },
            Phone: { required: true, pattern: /^\d{10}$/, message: '10-digit phone number required' },
            Diagnosis: { required: true, pattern: /^.{3,50}$/, message: 'Diagnosis 3-50 characters' },
            Address: { required: false, pattern: /^.{5,100}$/, message: 'Address 5-100 characters' },
            PHC: { required: true, message: 'PHC selection required' },
            Weight: { required: false, pattern: /^\d{1,3}(\.\d{1,2})?$/, min: 5, max: 250, message: 'Weight 5-250 kg' },
            BPSystolic: { required: false, pattern: /^\d{2,3}$/, min: 60, max: 200, message: 'BP Systolic 60-200 mmHg' },
            BPDiastolic: { required: false, pattern: /^\d{2,3}$/, min: 40, max: 130, message: 'BP Diastolic 40-130 mmHg' }
        };
    }

    /**
     * Check for duplicate patients locally (in cache and queued)
     * Looks for existing patient by phone number or name match
     * 
     * @param {Object} patientData - Patient data to check
     * @param {string} userRole - Current user role
     * @param {string} userPHC - User's assigned PHC
     * @returns {Promise<Object>} { isDuplicate: boolean, duplicatePatient: Object|null, duplicateSource: string }
     */
    async checkLocalDuplicate(patientData, userRole, userPHC) {
        try {
            const db = await this._openDB();
            const tx = db.transaction([this.PATIENT_STORE, this.SYNC_QUEUE_STORE], 'readonly');
            
            const phoneToCheck = patientData.Phone.toString().trim();
            const nameToCheck = patientData.PatientName.toLowerCase().trim();
            const fatherNameToCheck = (patientData.FatherName || '').toLowerCase().trim();
            
            // Check offline patients cache
            const patientStore = tx.objectStore(this.PATIENT_STORE);
            const allCachedPatients = await patientStore.getAll();
            
            for (const cached of allCachedPatients) {
                if (cached.Phone && cached.Phone.toString().trim() === phoneToCheck) {
                    return {
                        isDuplicate: true,
                        duplicatePatient: cached,
                        duplicateSource: 'cached',
                        reason: `Phone ${phoneToCheck} already exists in offline cache`
                    };
                }
                
                // Also check name + father name combination
                if (cached.PatientName && cached.PatientName.toLowerCase().trim() === nameToCheck) {
                    if (fatherNameToCheck && cached.FatherName && cached.FatherName.toLowerCase().trim() === fatherNameToCheck) {
                        return {
                            isDuplicate: true,
                            duplicatePatient: cached,
                            duplicateSource: 'cached',
                            reason: `Patient ${nameToCheck} (Father: ${fatherNameToCheck}) already exists in offline cache`
                        };
                    }
                }
            }
            
            // Check queued patients (not yet synced)
            const syncQueue = tx.objectStore(this.SYNC_QUEUE_STORE);
            const queuedCreations = await syncQueue.getAll();
            
            for (const queued of queuedCreations) {
                if (queued.action === 'createPatient' && queued.data) {
                    if (queued.data.Phone && queued.data.Phone.toString().trim() === phoneToCheck) {
                        return {
                            isDuplicate: true,
                            duplicatePatient: queued.data,
                            duplicateSource: 'queued',
                            reason: `Phone ${phoneToCheck} is queued for creation (not yet synced)`
                        };
                    }
                    
                    if (queued.data.PatientName && queued.data.PatientName.toLowerCase().trim() === nameToCheck) {
                        if (fatherNameToCheck && queued.data.FatherName && queued.data.FatherName.toLowerCase().trim() === fatherNameToCheck) {
                            return {
                                isDuplicate: true,
                                duplicatePatient: queued.data,
                                duplicateSource: 'queued',
                                reason: `Patient ${nameToCheck} (Father: ${fatherNameToCheck}) is queued for creation`
                            };
                        }
                    }
                }
            }
            
            return { isDuplicate: false, duplicatePatient: null, duplicateSource: null };
        } catch (err) {
            console.error('[OfflinePatientCreation] Error checking local duplicate:', err);
            return { isDuplicate: false, duplicatePatient: null, error: err.message };
        }
    }

    /**
     * Validate patient data against defined rules
     * Comprehensive validation for all required and optional fields
     * 
     * @param {Object} patientData - Patient data to validate
     * @returns {Object} { isValid: boolean, errors: Array<string> }
     */
    validatePatientData(patientData) {
        const errors = [];
        
        for (const [field, rules] of Object.entries(this.VALIDATION_RULES)) {
            const value = patientData[field];
            
            // Check required
            if (rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
                errors.push(`${field} is required`);
                continue;
            }
            
            // Skip optional empty fields
            if (!rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
                continue;
            }
            
            // Check pattern
            if (rules.pattern && !rules.pattern.test(value)) {
                errors.push(rules.message || `${field} format invalid`);
            }
            
            // Check min/max for numbers
            if (rules.min !== undefined && Number(value) < rules.min) {
                errors.push(`${field} must be >= ${rules.min}`);
            }
            if (rules.max !== undefined && Number(value) > rules.max) {
                errors.push(`${field} must be <= ${rules.max}`);
            }
        }
        
        // Additional validation: Age reasonableness
        if (patientData.Age) {
            const age = Number(patientData.Age);
            if (age < 1 || age > 120) {
                errors.push('Age must be between 1 and 120 years');
            }
        }
        
        // Additional validation: BP values if provided
        if (patientData.BPSystolic && patientData.BPDiastolic) {
            const systolic = Number(patientData.BPSystolic);
            const diastolic = Number(patientData.BPDiastolic);
            if (systolic <= diastolic) {
                errors.push('Systolic BP must be greater than Diastolic BP');
            }
        }
        
        // Additional validation: Weight reasonableness
        if (patientData.Weight) {
            const weight = Number(patientData.Weight);
            if (weight < 5 || weight > 250) {
                errors.push('Weight must be between 5 and 250 kg');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Generate unique temporary patient ID
     * Format: TEMP_${timestamp}_${userRole}
     * 
     * @param {string} userRole - Current user role
     * @returns {string} Temporary patient ID
     */
    generateTempPatientID(userRole) {
        const timestamp = Date.now();
        const rolePrefix = userRole.substring(0, 3).toUpperCase();
        return `${this.TEMP_ID_PREFIX}_${timestamp}_${rolePrefix}`;
    }

    /**
     * Create offline patient with all validations
     * Steps:
     * 1. Validate patient data
     * 2. Check for local duplicates
     * 3. Generate temporary ID
     * 4. Store in IndexedDB
     * 5. Queue for sync with CRITICAL priority
     * 6. Log to audit trail
     * 
     * @param {Object} patientData - Complete patient data
     * @param {string} userRole - Current user role (master_admin, phc_admin)
     * @param {string} userPHC - User's assigned PHC
     * @param {string} userName - Current user name
     * @returns {Promise<Object>} { success: boolean, tempPatientID: string, message: string, warnings: Array }
     */
    async createOfflinePatient(patientData, userRole, userPHC, userName) {
        try {
            // Step 1: Validate all fields
            const validation = this.validatePatientData(patientData);
            if (!validation.isValid) {
                return {
                    success: false,
                    message: 'Validation failed',
                    errors: validation.errors
                };
            }
            
            // Step 2: Check for local duplicates
            const duplicateCheck = await this.checkLocalDuplicate(patientData, userRole, userPHC);
            if (duplicateCheck.isDuplicate) {
                return {
                    success: false,
                    message: `Patient creation blocked - duplicate detected (${duplicateCheck.duplicateSource})`,
                    reason: duplicateCheck.reason
                };
            }
            
            // Step 3: Generate temporary ID
            const tempPatientID = this.generateTempPatientID(userRole);
            
            // Step 4: Store in IndexedDB
            const offlinePatient = {
                ...patientData,
                ID: tempPatientID,
                isOffline: true,
                offlineStatus: 'pending', // pending, syncing, synced, failed
                createdAt: new Date().toISOString(),
                createdBy: userName,
                createdByRole: userRole,
                createdByPHC: userPHC,
                syncAttempts: 0,
                lastSyncAttempt: null,
                lastSyncError: null,
                serverID: null // Will be populated when sync succeeds
            };
            
            const db = await this._openDB();
            const tx = db.transaction([this.PATIENT_STORE], 'readwrite');
            const store = tx.objectStore(this.PATIENT_STORE);
            await store.add(offlinePatient);
            
            // Step 5: Queue for sync with CRITICAL priority (1)
            const syncQueueItem = {
                id: `${tempPatientID}_${Date.now()}`,
                action: 'createPatient',
                entityType: 'Patient',
                entityID: tempPatientID,
                data: patientData,
                priority: 1, // CRITICAL
                timestamp: new Date().toISOString(),
                status: 'pending',
                retryCount: 0,
                maxRetries: 3,
                createdBy: userName,
                createdByRole: userRole,
                createdByPHC: userPHC,
                offline: true,
                synced: false
            };
            
            const txSync = db.transaction([this.SYNC_QUEUE_STORE], 'readwrite');
            const syncStore = txSync.objectStore(this.SYNC_QUEUE_STORE);
            await syncStore.add(syncQueueItem);
            
            // Step 6: Log to audit trail
            if (window.OfflineAuditLogger) {
                await window.OfflineAuditLogger.logOfflineAction(
                    'createPatient',
                    'Patient',
                    tempPatientID,
                    patientData,
                    userRole,
                    userName,
                    'Note: Will be validated for duplicates on sync (name + father name + phone)'
                );
            }
            
            // Update sync queue display
            if (window.updateSyncQueueDisplay) {
                window.updateSyncQueueDisplay();
            }
            
            return {
                success: true,
                tempPatientID: tempPatientID,
                message: `Patient created offline. Phone will be checked for duplicates on sync.`,
                warnings: ['This is an offline creation. Will be synced when online.']
            };
        } catch (err) {
            console.error('[OfflinePatientCreation] Error creating offline patient:', err);
            return {
                success: false,
                message: 'Error creating offline patient',
                error: err.message
            };
        }
    }

    /**
     * Retry failed patient creation sync
     * Allow user to edit data and requeue for sync
     * 
     * @param {string} tempPatientID - Temporary patient ID
     * @param {Object} updatedData - Updated patient data (optional, for edit)
     * @param {string} userName - Current user name
     * @returns {Promise<Object>} { success: boolean, message: string }
     */
    async retryPatientSync(tempPatientID, updatedData, userName) {
        try {
            const db = await this._openDB();
            
            // Get current offline patient record
            const patientTx = db.transaction([this.PATIENT_STORE], 'readonly');
            const patientStore = patientTx.objectStore(this.PATIENT_STORE);
            const offlinePatient = await patientStore.get(tempPatientID);
            
            if (!offlinePatient) {
                return {
                    success: false,
                    message: `Patient record not found: ${tempPatientID}`
                };
            }
            
            // Update patient data if provided (user edited)
            if (updatedData) {
                const validation = this.validatePatientData(updatedData);
                if (!validation.isValid) {
                    return {
                        success: false,
                        message: 'Validation failed for edited data',
                        errors: validation.errors
                    };
                }
                
                // Update in IndexedDB
                const updateTx = db.transaction([this.PATIENT_STORE], 'readwrite');
                const updateStore = updateTx.objectStore(this.PATIENT_STORE);
                const updated = {
                    ...offlinePatient,
                    ...updatedData,
                    offlineStatus: 'pending',
                    syncAttempts: 0,
                    lastSyncError: null
                };
                await updateStore.put(updated);
            }
            
            // Reset sync queue item for this patient
            const syncTx = db.transaction([this.SYNC_QUEUE_STORE], 'readwrite');
            const syncStore = syncTx.objectStore(this.SYNC_QUEUE_STORE);
            const allQueue = await syncStore.getAll();
            
            for (const item of allQueue) {
                if (item.entityID === tempPatientID && item.action === 'createPatient') {
                    const retried = {
                        ...item,
                        status: 'pending',
                        retryCount: 0,
                        updatedAt: new Date().toISOString(),
                        updatedBy: userName
                    };
                    if (updatedData) {
                        retried.data = updatedData;
                    }
                    await syncStore.put(retried);
                }
            }
            
            // Update sync queue display
            if (window.updateSyncQueueDisplay) {
                window.updateSyncQueueDisplay();
            }
            
            return {
                success: true,
                message: 'Patient creation queued for retry'
            };
        } catch (err) {
            console.error('[OfflinePatientCreation] Error retrying sync:', err);
            return {
                success: false,
                message: 'Error retrying sync',
                error: err.message
            };
        }
    }

    /**
     * Check online for duplicate patients during sync
     * Called by service worker when syncing createPatient action
     * Checks: name + father name + phone
     * 
     * @param {Object} patientData - Patient data
     * @returns {Promise<Object>} { hasDuplicate: boolean, duplicatePatient: Object|null, message: string }
     */
    async checkOnlineDuplicate(patientData) {
        try {
            const response = await fetch(API_CONFIG.MAIN_SCRIPT_URL, {
                method: 'POST',
                body: new URLSearchParams({
                    action: 'checkPatientDuplicate',
                    phone: patientData.Phone || '',
                    name: patientData.PatientName || '',
                    fatherName: patientData.FatherName || ''
                })
            });
            
            if (!response.ok) {
                return {
                    hasDuplicate: false,
                    message: 'Could not verify duplicates online (server error)',
                    skipped: true
                };
            }
            
            const result = await response.json();
            return {
                hasDuplicate: result.exists || false,
                duplicatePatient: result.existingPatient || null,
                message: result.message || ''
            };
        } catch (err) {
            console.error('[OfflinePatientCreation] Error checking online duplicate:', err);
            return {
                hasDuplicate: false,
                message: 'Could not verify duplicates online (network error)',
                skipped: true,
                error: err.message
            };
        }
    }

    /**
     * Handle sync merge when patient creation succeeds
     * Replace temporary ID with server-generated ID everywhere
     * Update offline patient record, sync queue, audit log
     * 
     * @param {string} tempPatientID - Temporary patient ID
     * @param {Object} serverResponse - Server response with real patient ID
     * @returns {Promise<Object>} { success: boolean, message: string, serverID: string }
     */
    async mergeSyncResult(tempPatientID, serverResponse) {
        try {
            const serverID = serverResponse.ID || serverResponse.data?.ID;
            if (!serverID) {
                return {
                    success: false,
                    message: 'Server response missing patient ID'
                };
            }
            
            const db = await this._openDB();
            
            // Update offline patient record
            const patientTx = db.transaction([this.PATIENT_STORE], 'readwrite');
            const patientStore = patientTx.objectStore(this.PATIENT_STORE);
            const offlinePatient = await patientStore.get(tempPatientID);
            
            if (offlinePatient) {
                const updated = {
                    ...offlinePatient,
                    serverID: serverID,
                    offlineStatus: 'synced',
                    syncedAt: new Date().toISOString()
                };
                
                // Store under real ID as well for future references
                await patientStore.add({
                    ...serverResponse.data || {},
                    isOffline: true,
                    serverID: serverID,
                    tempID: tempPatientID,
                    offlineStatus: 'synced'
                }).catch(() => {}); // Ignore if already exists
                
                await patientStore.put(updated);
            }
            
            // Update sync queue item
            const syncTx = db.transaction([this.SYNC_QUEUE_STORE], 'readwrite');
            const syncStore = syncTx.objectStore(this.SYNC_QUEUE_STORE);
            const allQueue = await syncStore.getAll();
            
            for (const item of allQueue) {
                if (item.entityID === tempPatientID && item.action === 'createPatient') {
                    const merged = {
                        ...item,
                        status: 'synced',
                        synced: true,
                        serverID: serverID,
                        syncedAt: new Date().toISOString()
                    };
                    await syncStore.put(merged);
                }
            }
            
            // Update audit log
            if (window.OfflineAuditLogger) {
                await window.OfflineAuditLogger.logOfflineAction(
                    'createPatient_synced',
                    'Patient',
                    serverID,
                    { tempID: tempPatientID, serverID: serverID },
                    'system',
                    'SyncProcess',
                    `Successfully synced offline patient creation. Temp ID ${tempPatientID} → Server ID ${serverID}`
                );
            }
            
            return {
                success: true,
                message: `Patient creation synced successfully. Server ID: ${serverID}`,
                serverID: serverID
            };
        } catch (err) {
            console.error('[OfflinePatientCreation] Error merging sync result:', err);
            return {
                success: false,
                message: 'Error finalizing patient sync',
                error: err.message
            };
        }
    }

    /**
     * Handle sync failure for patient creation
     * Increment retry count, store error message
     * 
     * @param {string} tempPatientID - Temporary patient ID
     * @param {string} errorMessage - Error message from sync attempt
     * @returns {Promise<Object>} { success: boolean, retryable: boolean, message: string }
     */
    async handleSyncFailure(tempPatientID, errorMessage) {
        try {
            const db = await this._openDB();
            
            // Update offline patient record
            const patientTx = db.transaction([this.PATIENT_STORE], 'readwrite');
            const patientStore = patientTx.objectStore(this.PATIENT_STORE);
            const offlinePatient = await patientStore.get(tempPatientID);
            
            if (offlinePatient) {
                const updated = {
                    ...offlinePatient,
                    syncAttempts: (offlinePatient.syncAttempts || 0) + 1,
                    lastSyncAttempt: new Date().toISOString(),
                    lastSyncError: errorMessage,
                    offlineStatus: offlinePatient.syncAttempts >= this.MAX_RETRY_ATTEMPTS ? 'failed' : 'pending'
                };
                await patientStore.put(updated);
            }
            
            // Update sync queue item
            const syncTx = db.transaction([this.SYNC_QUEUE_STORE], 'readwrite');
            const syncStore = syncTx.objectStore(this.SYNC_QUEUE_STORE);
            const allQueue = await syncStore.getAll();
            
            let isRetryable = true;
            for (const item of allQueue) {
                if (item.entityID === tempPatientID && item.action === 'createPatient') {
                    const newRetryCount = (item.retryCount || 0) + 1;
                    isRetryable = newRetryCount < this.MAX_RETRY_ATTEMPTS;
                    
                    const updated = {
                        ...item,
                        retryCount: newRetryCount,
                        status: isRetryable ? 'pending' : 'failed',
                        lastError: errorMessage,
                        lastErrorAt: new Date().toISOString()
                    };
                    await syncStore.put(updated);
                }
            }
            
            // Log failure to audit
            if (window.OfflineAuditLogger) {
                await window.OfflineAuditLogger.logOfflineAction(
                    'createPatient_failed',
                    'Patient',
                    tempPatientID,
                    { error: errorMessage },
                    'system',
                    'SyncProcess',
                    `Sync failed. Attempts: ${offlinePatient?.syncAttempts || 1}/${this.MAX_RETRY_ATTEMPTS}`
                );
            }
            
            return {
                success: true,
                retryable: isRetryable,
                message: isRetryable ? 'Will retry later' : 'Max retries reached. User can edit and retry.',
                syncAttempts: offlinePatient?.syncAttempts || 1
            };
        } catch (err) {
            console.error('[OfflinePatientCreation] Error handling sync failure:', err);
            return {
                success: false,
                message: 'Error handling sync failure',
                error: err.message
            };
        }
    }

    /**
     * Get list of offline patients pending sync
     * Used for display in UI
     * 
     * @returns {Promise<Array>} Array of offline patients
     */
    async getPendingOfflinePatients() {
        try {
            const db = await this._openDB();
            const tx = db.transaction([this.PATIENT_STORE], 'readonly');
            const store = tx.objectStore(this.PATIENT_STORE);
            const allPatients = await store.getAll();
            
            return allPatients.filter(p => p.isOffline && p.offlineStatus !== 'synced');
        } catch (err) {
            console.error('[OfflinePatientCreation] Error getting pending patients:', err);
            return [];
        }
    }

    /**
     * Open IndexedDB connection
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    async _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, 4);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create stores if they don't exist
                if (!db.objectStoreNames.contains(this.PATIENT_STORE)) {
                    db.createObjectStore(this.PATIENT_STORE, { keyPath: 'ID' });
                }
                if (!db.objectStoreNames.contains(this.SYNC_QUEUE_STORE)) {
                    db.createObjectStore(this.SYNC_QUEUE_STORE, { keyPath: 'id' });
                }
            };
        });
    }
}

// Initialize as singleton
window.OfflinePatientCreationManager = new OfflinePatientCreationManager();
