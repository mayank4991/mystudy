/**
 * offline-encryption.js
 * End-to-end encryption for offline cached data
 * Encrypts sensitive patient data stored in IndexedDB and localStorage
 */

// =====================================================
// OFFLINE DATA ENCRYPTION MANAGER
// =====================================================

class OfflineDataEncryption {
    /**
     * Simple XOR-based encryption for offline data (client-side only)
     * For production, consider using TweetNaCl.js or libsodium.js
     * 
     * NOTE: This is NOT cryptographically secure for sensitive data.
     * It's primarily to prevent casual inspection of localStorage/IndexedDB.
     * For true security, implement server-side encryption as well.
     */
    
    static ENCRYPTION_KEY_STORAGE = 'epicare_encryption_key';
    
    /**
     * Initialize or retrieve the encryption key for this device
     * Key is derived from session token and device fingerprint
     */
    static async getEncryptionKey() {
        let key = sessionStorage.getItem(this.ENCRYPTION_KEY_STORAGE);
        
        if (!key) {
            // Derive key from session token + device fingerprint
            const sessionToken = window.getSessionToken ? window.getSessionToken() : '';
            const fingerprint = await this._getDeviceFingerprint();
            key = this._deriveKey(sessionToken, fingerprint);
            sessionStorage.setItem(this.ENCRYPTION_KEY_STORAGE, key);
        }
        
        return key;
    }
    
    static async _getDeviceFingerprint() {
        // Simple device fingerprint (navigator properties)
        const fp = [
            navigator.userAgent,
            navigator.language,
            new Date().getTimezoneOffset(),
            screen.width + 'x' + screen.height
        ].join('|');
        
        // Hash the fingerprint
        return await this._simpleHash(fp);
    }
    
    static _deriveKey(token, fingerprint) {
        // Combine token and fingerprint into a simple key
        const combined = token + fingerprint;
        return combined.split('').reduce((acc, char) => {
            return ((acc << 5) - acc) + char.charCodeAt(0);
        }, 0).toString(36);
    }
    
    static async _simpleHash(text) {
        // For environments with crypto API
        if (window.crypto && window.crypto.subtle) {
            try {
                const encoder = new TextEncoder();
                const data = encoder.encode(text);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            } catch (e) {
                // Fallback
            }
        }
        
        // Fallback simple hash
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }
    
    /**
     * Encrypt sensitive data before storing
     */
    static async encryptData(data, key = null) {
        if (!key) {
            key = await this.getEncryptionKey();
        }
        
        const dataString = JSON.stringify(data);
        const encrypted = this._xorEncrypt(dataString, key);
        
        return {
            encrypted: encrypted,
            timestamp: Date.now(),
            version: 1
        };
    }
    
    /**
     * Decrypt data after retrieving
     */
    static async decryptData(encryptedObj, key = null) {
        if (!key) {
            key = await this.getEncryptionKey();
        }
        
        if (!encryptedObj || !encryptedObj.encrypted) {
            return null;
        }
        
        try {
            const decrypted = this._xorDecrypt(encryptedObj.encrypted, key);
            return JSON.parse(decrypted);
        } catch (err) {
            window.Logger.warn('Failed to decrypt data:', err);
            return null;
        }
    }
    
    /**
     * Simple XOR encryption (NOT secure, for obfuscation only)
     */
    static _xorEncrypt(text, key) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(
                text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
            );
        }
        return btoa(result); // Base64 encode
    }
    
    static _xorDecrypt(encoded, key) {
        const text = atob(encoded); // Base64 decode
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(
                text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
            );
        }
        return result;
    }
    
    /**
     * Store encrypted patient data
     */
    static async storeEncryptedPatient(patient) {
        try {
            const key = await this.getEncryptionKey();
            const encrypted = await this.encryptData(patient, key);
            
            const db = await this._openDB();
            const transaction = db.transaction(['encryptedData'], 'readwrite');
            const store = transaction.objectStore('encryptedData');
            
            return new Promise((resolve, reject) => {
                const req = store.put({
                    key: `patient_${patient.PatientID}`,
                    encrypted: encrypted,
                    patientId: patient.PatientID
                });
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to store encrypted patient:', err);
            throw err;
        }
    }
    
    /**
     * Retrieve decrypted patient data
     */
    static async getEncryptedPatient(patientId) {
        try {
            const key = await this.getEncryptionKey();
            const db = await this._openDB();
            const transaction = db.transaction(['encryptedData'], 'readonly');
            const store = transaction.objectStore('encryptedData');
            
            return new Promise((resolve, reject) => {
                const req = store.get(`patient_${patientId}`);
                req.onsuccess = async () => {
                    const record = req.result;
                    if (record) {
                        const decrypted = await this.decryptData(record.encrypted, key);
                        resolve(decrypted);
                    } else {
                        resolve(null);
                    }
                };
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to get encrypted patient:', err);
            return null;
        }
    }
    
    /**
     * Clear encryption key on logout
     */
    static clearEncryptionKey() {
        try {
            sessionStorage.removeItem(this.ENCRYPTION_KEY_STORAGE);
            window.Logger.debug('Encryption key cleared on logout');
        } catch (err) {
            window.Logger.warn('Failed to clear encryption key:', err);
        }
    }
    
    /**
     * Clear all encrypted data
     */
    static async clearEncryptedData() {
        try {
            const db = await this._openDB();
            const transaction = db.transaction(['encryptedData'], 'readwrite');
            const store = transaction.objectStore('encryptedData');
            
            return new Promise((resolve, reject) => {
                const req = store.clear();
                req.onsuccess = () => {
                    window.Logger.debug('All encrypted data cleared');
                    resolve();
                };
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            window.Logger.warn('Failed to clear encrypted data:', err);
        }
    }
    
    static async _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('EpicareOfflineDB', 4);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('encryptedData')) {
                    const store = db.createObjectStore('encryptedData', { keyPath: 'key' });
                    store.createIndex('patientId', 'patientId');
                }
            };
        });
    }
}

// =====================================================
// HOOKS FOR LOGOUT & LOGIN
// =====================================================

/**
 * Clear encryption key on logout (integrate with logout function)
 */
if (typeof window !== 'undefined') {
    window.OfflineDataEncryption = OfflineDataEncryption;
    
    // Hook into logout if available
    const originalLogout = window.logout;
    if (typeof originalLogout === 'function') {
        window.logout = function(options = {}) {
            // Clear encryption key before logout
            if (typeof window.OfflineDataEncryption !== 'undefined') {
                window.OfflineDataEncryption.clearEncryptionKey();
            }
            
            // Call original logout
            return originalLogout.call(this, options);
        };
    }
}
