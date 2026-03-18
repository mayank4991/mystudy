/**
 * offline-enhanced.js
 * Comprehensive offline functionality with conflict resolution, version tracking, 
 * role-based access control, and audit logging for the Epilepsy Management System
 */

// =====================================================
// OFFLINE CONFLICT RESOLVER
// =====================================================

class OfflineConflictResolver {
    /**
     * Detect and resolve conflicts between offline and server versions
     * Uses auto-merge for simple fields, shows diff for complex ones
     */
    
    static detectConflict(offlineVersion, serverVersion) {
        if (!serverVersion || !offlineVersion) return null;
        
        const conflict = {
            detected: false,
            conflictedFields: [],
            autoMergeableFields: [],
            requiresUserReview: []
        };
        
        for (const [key, offlineValue] of Object.entries(offlineVersion)) {
            if (key.startsWith('_')) continue; // Skip internal fields
            
            const serverValue = serverVersion[key];
            if (serverValue === undefined) continue;
            
            // Check if values differ
            const valuesDiffer = JSON.stringify(offlineValue) !== JSON.stringify(serverValue);
            if (!valuesDiffer) continue;
            
            conflict.detected = true;
            conflict.conflictedFields.push(key);
            
            // Classify as auto-mergeable or requires review
            if (this._isAutoMergeable(key, offlineValue, serverValue, offlineVersion, serverVersion)) {
                conflict.autoMergeableFields.push({
                    field: key,
                    offline: offlineValue,
                    server: serverValue,
                    mergeStrategy: this._getMergeStrategy(key, offlineVersion, serverVersion)
                });
            } else {
                conflict.requiresUserReview.push({
                    field: key,
                    offline: offlineValue,
                    server: serverValue,
                    type: this._getFieldType(key)
                });
            }
        }
        
        return conflict.detected ? conflict : null;
    }
    
    static _isAutoMergeable(fieldName, offlineValue, serverValue, offlineObj, serverObj) {
        // Simple scalar values with clear timestamps can be auto-merged
        const isSimpleScalar = typeof offlineValue !== 'object' || offlineValue === null;
        if (!isSimpleScalar) return false;
        
        // Fields that should never auto-merge
        const noAutoMerge = ['Status', 'PatientID', 'id', '_id', 'Username'];
        if (noAutoMerge.includes(fieldName)) return false;
        
        // Fields that can auto-merge (last-write-wins for timestamps)
        const autoMergeFields = ['Notes', 'Comments', 'PhoneNumber', 'Email', 'Address', 'LastReviewDate'];
        if (autoMergeFields.includes(fieldName)) return true;
        
        return false;
    }
    
    static _getMergeStrategy(fieldName, offlineObj, serverObj) {
        // If offline has newer timestamp, use offline; else use server
        const offlineTime = offlineObj._offlineEditTime || 0;
        const serverTime = serverObj._lastModified || 0;
        
        return offlineTime > serverTime ? 'offline' : 'server';
    }
    
    static _getFieldType(fieldName) {
        const types = {
            'Status': 'status',
            'Dosage': 'numeric',
            'Date': 'date',
            'Notes': 'text',
            'Code': 'code'
        };
        
        for (const [key, type] of Object.entries(types)) {
            if (fieldName.includes(key)) return type;
        }
        return 'unknown';
    }
    
    static autoMerge(offlineVersion, serverVersion, conflictData) {
        const merged = { ...serverVersion };
        
        for (const mergeableField of conflictData.autoMergeableFields) {
            const { field, mergeStrategy } = mergeableField;
            if (mergeStrategy === 'offline') {
                merged[field] = offlineVersion[field];
            }
            // If 'server', keep server value (already set)
        }
        
        // Preserve important metadata
        merged._conflictResolved = true;
        merged._conflictResolvedAt = new Date().toISOString();
        merged._conflictStrategy = 'auto-merge';
        merged._mergedFields = conflictData.autoMergeableFields.map(f => f.field);
        
        return merged;
    }
    
    static createDiffView(conflictData) {
        return {
            timestamp: new Date().toISOString(),
            conflicts: conflictData.requiresUserReview.map(conflict => ({
                field: conflict.field,
                offline: conflict.offline,
                server: conflict.server,
                type: conflict.type,
                action: 'requires-review'
            }))
        };
    }
}

// =====================================================
// OFFLINE VERSION TRACKER
// =====================================================

class OfflineVersionTracker {
    /**
     * Track versions of all offline-edited entities for conflict detection
     */
    static async trackEntityVersion(entityType, entityId, data, action) {
        const db = await this._openDB();
        const timestamp = Date.now();
        const versionId = `${entityType}_${entityId}_${timestamp}`;
        
        const versionRecord = {
            versionId,
            entityType,
            entityId,
            data: { ...data },
            action, // 'create', 'update', 'delete'
            timestamp,
            _offlineEditTime: timestamp,
            _lastModified: data._lastModified || timestamp,
            synced: false,
            conflictStatus: 'none'
        };
        
        try {
            const transaction = db.transaction(['offlineVersions'], 'readwrite');
            const store = transaction.objectStore('offlineVersions');
            await new Promise((resolve, reject) => {
                const req = store.add(versionRecord);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
            
            window.Logger.debug('Version tracked:', versionId);
            return versionId;
        } catch (err) {
            window.Logger.error('Failed to track version:', err);
            throw err;
        }
    }
    
    static async getVersionHistory(entityType, entityId) {
        const db = await this._openDB();
        const index = db.transaction(['offlineVersions']).objectStore('offlineVersions').index('entityId');
        
        return new Promise((resolve, reject) => {
            const req = index.getAll(entityId);
            req.onsuccess = () => resolve(req.result.filter(v => v.entityType === entityType));
            req.onerror = () => reject(req.error);
        });
    }
    
    static async markVersionSynced(versionId, serverData) {
        const db = await this._openDB();
        const transaction = db.transaction(['offlineVersions'], 'readwrite');
        const store = transaction.objectStore('offlineVersions');
        
        return new Promise((resolve, reject) => {
            const getReq = store.get(versionId);
            getReq.onsuccess = () => {
                const record = getReq.result;
                if (record) {
                    record.synced = true;
                    record.syncedAt = new Date().toISOString();
                    record.serverData = serverData;
                    const putReq = store.put(record);
                    putReq.onsuccess = () => resolve();
                    putReq.onerror = () => reject(putReq.error);
                } else {
                    resolve();
                }
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }
    
    static async _openDB() {
        return new Promise((resolve, reject) => {
            // Version 4: Consolidated schema - stores are created by offline-form-handler.js
            const req = indexedDB.open('EpicareOfflineDB', 4);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('offlineVersions')) {
                    const store = db.createObjectStore('offlineVersions', { keyPath: 'versionId' });
                    store.createIndex('entityId', 'entityId');
                    store.createIndex('entityType', 'entityType');
                    store.createIndex('timestamp', 'timestamp');
                    store.createIndex('synced', 'synced');
                }
            };
        });
    }
}

// =====================================================
// OFFLINE PATIENT CACHE MANAGER
// =====================================================

class OfflinePatientCacheManager {
    static CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    static MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
    static CACHE_KEY_PREFIX = 'patient_cache_';
    
    /**
     * Cache patient list with role-based filtering on login
     * Only cache data user has access to based on role
     */
    static async cachePatientListOnLogin(patients, userRole, userPHC) {
        if (!Array.isArray(patients)) return;
        
        const filteredPatients = this._filterByRole(patients, userRole, userPHC);
        const cacheData = {
            patients: filteredPatients,
            timestamp: Date.now(),
            role: userRole,
            phc: userPHC,
            version: 1
        };
        
        try {
            // Store in IndexedDB for size efficiency
            const db = await this._openDB();
            
            // Check if required object store exists before attempting transaction
            if (!Array.from(db.objectStoreNames).includes('offlinePatients')) {
                window.Logger.debug('IndexedDB not fully initialized yet - offline patient cache will be available on next refresh');
                return;
            }
            
            const transaction = db.transaction(['offlinePatients'], 'readwrite');
            const store = transaction.objectStore('offlinePatients');
            
            await new Promise((resolve, reject) => {
                const req = store.put({
                    key: 'patientList',
                    data: cacheData,
                    size: JSON.stringify(cacheData).length
                });
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
            
            window.Logger.debug(`Cached ${filteredPatients.length} patients for offline use`);
        } catch (err) {
            window.Logger.debug('Offline patient caching unavailable during initialization:', err.name);
        }
    }
    
    static _filterByRole(patients, userRole, userPHC) {
        // Different roles get different offline data scope
        switch (userRole) {
            case 'phc':
            case 'phc_admin':
                // PHC staff: Only their assigned PHC patients
                return patients.filter(p => p.PHC === userPHC);
            case 'master_admin':
                // Master admin: All patients (reduced data - no sensitive fields)
                return patients.map(p => this._stripSensitiveFields(p));
            case 'viewer':
                // Viewer: Limited to already-viewed patients
                return patients.slice(0, 20); // Only recent
            default:
                return [];
        }
    }
    
    static _stripSensitiveFields(patient) {
        // Remove PII for master_admin offline view
        const stripped = { ...patient };
        delete stripped.PhoneNumber;
        delete stripped.Email;
        delete stripped.Address;
        delete stripped.EmergencyContact;
        return stripped;
    }
    
    static async getCachedPatientList() {
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['offlinePatients'], 'readonly');
            const store = transaction.objectStore('offlinePatients');
            
            return new Promise((resolve, reject) => {
                const req = store.get('patientList');
                req.onsuccess = () => {
                    const record = req.result;
                    if (record && this._isCacheValid(record.data)) {
                        resolve(record.data.patients);
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to retrieve cached patient list:', err);
            return null;
        }
    }
    
    static async cachePatientDetail(patient) {
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['offlinePatients'], 'readwrite');
            const store = transaction.objectStore('offlinePatients');
            
            await new Promise((resolve, reject) => {
                const req = store.put({
                    key: `patient_${patient.PatientID}`,
                    data: { patient, timestamp: Date.now() },
                    size: JSON.stringify(patient).length
                });
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to cache patient detail:', err);
        }
    }
    
    static async getCachedPatient(patientId) {
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['offlinePatients'], 'readonly');
            const store = transaction.objectStore('offlinePatients');
            
            return new Promise((resolve, reject) => {
                const req = store.get(`patient_${patientId}`);
                req.onsuccess = () => {
                    const record = req.result;
                    if (record && this._isCacheValid(record.data)) {
                        resolve(record.data.patient);
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to retrieve cached patient:', err);
            return null;
        }
    }
    
    static _isCacheValid(cacheData) {
        if (!cacheData || !cacheData.timestamp) return false;
        const age = Date.now() - cacheData.timestamp;
        return age < this.CACHE_DURATION;
    }
    
    static async _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('EpicareOfflineDB', 4);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('offlinePatients')) {
                    const store = db.createObjectStore('offlinePatients', { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp');
                    store.createIndex('size', 'size');
                }
            };
        });
    }
}

// =====================================================
// OFFLINE AUDIT LOGGER
// =====================================================

class OfflineAuditLogger {
    /**
     * Log all offline edits with role-based tracking
     * Required for compliance and audit trails
     */
    static async logOfflineAction(action, entityType, entityId, data, userRole, username) {
        const auditRecord = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            action,
            entityType,
            entityId,
            data: this._sanitizeForAudit(data, userRole),
            userRole,
            username,
            offline: true,
            synced: false,
            syncedAt: null
        };
        
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['auditLog'], 'readwrite');
            const store = transaction.objectStore('auditLog');
            
            await new Promise((resolve, reject) => {
                const req = store.add(auditRecord);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
            
            return auditRecord.id;
        } catch (err) {
            window.Logger.error('Failed to log offline action:', err);
            throw err;
        }
    }
    
    static _sanitizeForAudit(data, userRole) {
        // Log data changes but strip sensitive PII for non-admin roles
        if (userRole !== 'master_admin') {
            const sanitized = { ...data };
            delete sanitized.PhoneNumber;
            delete sanitized.Email;
            delete sanitized.EmergencyContact;
            return sanitized;
        }
        return data;
    }
    
    static async getAuditLog(filters = {}) {
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['auditLog'], 'readonly');
            const store = transaction.objectStore('auditLog');
            
            return new Promise((resolve, reject) => {
                let req;
                if (filters.username) {
                    const index = store.index('username');
                    req = index.getAll(filters.username);
                } else {
                    req = store.getAll();
                }
                
                req.onsuccess = () => {
                    let records = req.result;
                    
                    // Apply additional filters
                    if (filters.action) records = records.filter(r => r.action === filters.action);
                    if (filters.entityType) records = records.filter(r => r.entityType === filters.entityType);
                    if (filters.synced !== undefined) records = records.filter(r => r.synced === filters.synced);
                    
                    resolve(records);
                };
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to retrieve audit log:', err);
            return [];
        }
    }
    
    static async markAuditSynced(auditId, syncResult) {
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['auditLog'], 'readwrite');
            const store = transaction.objectStore('auditLog');
            
            return new Promise((resolve, reject) => {
                const getReq = store.get(auditId);
                getReq.onsuccess = () => {
                    const record = getReq.result;
                    if (record) {
                        record.synced = true;
                        record.syncedAt = new Date().toISOString();
                        record.syncResult = syncResult;
                        const putReq = store.put(record);
                        putReq.onsuccess = () => resolve();
                        putReq.onerror = () => reject(putReq.error);
                    } else {
                        resolve();
                    }
                };
                getReq.onerror = () => reject(getReq.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to mark audit as synced:', err);
        }
    }
    
    static async _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('EpicareOfflineDB', 4);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('auditLog')) {
                    const store = db.createObjectStore('auditLog', { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp');
                    store.createIndex('username', 'username');
                    store.createIndex('action', 'action');
                    store.createIndex('synced', 'synced');
                }
            };
        });
    }
}

// =====================================================
// SYNC QUEUE PRIORITIZER
// =====================================================

class SyncQueuePrioritizer {
    /**
     * Prioritize sync queue items - new patients first, then follow-ups
     * Respects role-based capabilities
     */
    static PRIORITY_LEVELS = {
        CRITICAL: 1,      // New patient creation
        HIGH: 2,          // Patient updates
        MEDIUM: 3,        // Follow-up submissions
        LOW: 4            // Other actions
    };
    
    static getPriority(action, data = {}) {
        if (action === 'createPatient') return this.PRIORITY_LEVELS.CRITICAL;
        if (action === 'updatePatient') return this.PRIORITY_LEVELS.HIGH;
        if (action === 'completeFollowUp') return this.PRIORITY_LEVELS.MEDIUM;
        if (action === 'updateDrug') return this.PRIORITY_LEVELS.MEDIUM;
        
        return this.PRIORITY_LEVELS.LOW;
    }
    
    static async reorderQueue(userRole) {
        // Reorder queued items by priority
        // Filter by role - some roles can't sync certain actions
        const allowedActions = this._getAllowedActionsForRole(userRole);
        
        // Get all queued items
        const queuedItems = await this._getSyncQueue();
        
        // Filter and sort
        const sorted = queuedItems
            .filter(item => allowedActions.includes(item.action))
            .sort((a, b) => {
                const priorityA = this.getPriority(a.action, a.body);
                const priorityB = this.getPriority(b.action, b.body);
                return priorityA - priorityB;
            });
        
        // Update queue with new order
        await this._updateQueueOrder(sorted);
        return sorted;
    }
    
    static _getAllowedActionsForRole(userRole) {
        const roleActions = {
            'phc': ['completeFollowUp', 'createSeizureEvent'],
            'phc_admin': ['completeFollowUp', 'createSeizureEvent', 'updatePatient'],
            'master_admin': ['createPatient', 'updatePatient', 'completeFollowUp', 'createSeizureEvent'],
            'viewer': ['completeFollowUp']
        };
        
        return roleActions[userRole] || [];
    }
    
    static async _getSyncQueue() {
        return new Promise((resolve) => {
            const db = indexedDB.open('EpicareOfflineDB', 4);
            db.onsuccess = () => {
                const transaction = db.result.transaction(['syncQueue'], 'readonly');
                const store = transaction.objectStore('syncQueue');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve([]);
            };
            db.onerror = () => resolve([]);
        });
    }
    
    static async _updateQueueOrder(sortedItems) {
        return new Promise((resolve) => {
            const db = indexedDB.open('EpicareOfflineDB', 4);
            db.onsuccess = () => {
                const transaction = db.result.transaction(['syncQueue'], 'readwrite');
                const store = transaction.objectStore('syncQueue');
                
                // Re-insert with new order (priority field)
                let completed = 0;
                sortedItems.forEach((item, index) => {
                    item.queuePriority = index;
                    const req = store.put(item);
                    req.onsuccess = () => {
                        completed++;
                        if (completed === sortedItems.length) resolve();
                    };
                });
            };
        });
    }
}

// =====================================================
// ENHANCED SYNC RETRY MANAGER
// =====================================================

class EnhancedSyncRetryManager {
    /**
     * Exponential backoff with jitter for retries
     * Different max retries per action type and role
     */
    static RETRY_CONFIG = {
        createPatient: { maxRetries: 3, baseDelay: 2000 },
        updatePatient: { maxRetries: 5, baseDelay: 1000 },
        completeFollowUp: { maxRetries: 5, baseDelay: 1000 },
        createSeizureEvent: { maxRetries: 5, baseDelay: 1000 },
        default: { maxRetries: 5, baseDelay: 1000 }
    };
    
    static calculateNextRetryDelay(action, retryCount) {
        const config = this.RETRY_CONFIG[action] || this.RETRY_CONFIG.default;
        
        if (retryCount >= config.maxRetries) {
            return null; // Max retries exceeded
        }
        
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
        const exponential = config.baseDelay * Math.pow(2, retryCount);
        const capped = Math.min(exponential, 30000);
        
        // Add jitter (±20%)
        const jitter = capped * (0.8 + Math.random() * 0.4);
        
        return Math.round(jitter);
    }
    
    static shouldRetry(action, retryCount) {
        const config = this.RETRY_CONFIG[action] || this.RETRY_CONFIG.default;
        return retryCount < config.maxRetries;
    }
    
    static async scheduleRetry(item, delay) {
        return new Promise(resolve => {
            setTimeout(() => resolve(), delay);
        });
    }
}

// =====================================================
// EXPORT CLASSES
// =====================================================

if (typeof window !== 'undefined') {
    window.OfflineConflictResolver = OfflineConflictResolver;
    window.OfflineVersionTracker = OfflineVersionTracker;
    window.OfflinePatientCacheManager = OfflinePatientCacheManager;
    window.OfflineAuditLogger = OfflineAuditLogger;
    window.SyncQueuePrioritizer = SyncQueuePrioritizer;
    window.EnhancedSyncRetryManager = EnhancedSyncRetryManager;
}
