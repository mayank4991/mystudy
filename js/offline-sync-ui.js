/**
 * offline-sync-ui.js
 * User interface for offline sync queue management
 * Allows users to view, prioritize, and manually sync queued items
 */

// =====================================================
// OFFLINE SYNC QUEUE UI MANAGER
// =====================================================

class OfflineSyncQueueUI {
    static MODAL_ID = 'offlineSyncQueueModal';
    static QUEUE_CONTAINER_ID = 'syncQueueContainer';
    
    /**
     * Create and show offline sync queue management modal
     */
    static async showSyncQueueModal() {
        let modal = document.getElementById(this.MODAL_ID);
        
        if (!modal) {
            modal = this._createSyncQueueModal();
            document.body.appendChild(modal);
        }
        
        // Refresh queue data
        await this.refreshQueueDisplay();
        modal.style.display = 'flex';
    }
    
    static _createSyncQueueModal() {
        const modal = document.createElement('div');
        modal.id = this.MODAL_ID;
        modal.className = 'modal offline-sync-modal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            justify-content: center;
            align-items: center;
        `;
        
        const content = document.createElement('div');
        content.className = 'modal-content offline-sync-content';
        content.style.cssText = `
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            max-width: 800px;
            width: 90%;
            max-height: 80vh;
            overflow: auto;
            padding: 20px;
        `;
        
        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: var(--primary-color);">Offline Sync Queue</h2>
                <button id="closeSyncQueueModal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
            </div>
            
            <div id="syncQueueStats" style="margin-bottom: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 6px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <strong>Queued Items:</strong> <span id="queueCount">0</span>
                    </div>
                    <div>
                        <strong>Status:</strong> <span id="syncStatus" style="color: #ff9800;">⏳ Pending</span>
                    </div>
                    <div>
                        <strong>Total Retries:</strong> <span id="totalRetries">0</span>
                    </div>
                    <div>
                        <strong>Last Sync:</strong> <span id="lastSyncTime">Never</span>
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <button id="syncNowBtn" class="btn btn-primary" style="flex: 1;">
                        <i class="fas fa-sync"></i> Sync Now
                    </button>
                    <button id="clearQueueBtn" class="btn btn-secondary" style="flex: 1;">
                        <i class="fas fa-trash"></i> Clear Queue
                    </button>
                    <button id="refreshQueueBtn" class="btn btn-secondary" style="flex: 1;">
                        <i class="fas fa-redo"></i> Refresh
                    </button>
                </div>
            </div>
            
            <div id="${this.QUEUE_CONTAINER_ID}" style="border: 1px solid #ddd; border-radius: 6px; max-height: 400px; overflow-y: auto;">
                <div style="padding: 20px; text-align: center; color: #999;">
                    <i class="fas fa-spinner fa-spin"></i> Loading queue...
                </div>
            </div>
            
            <div id="auditLogSection" style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 20px;">
                <h3 style="margin-top: 0;">Offline Activity Audit Log</h3>
                <div id="auditLogContainer" style="border: 1px solid #ddd; border-radius: 6px; max-height: 300px; overflow-y: auto; padding: 10px;">
                    <div style="padding: 10px; text-align: center; color: #999;">
                        <i class="fas fa-spinner fa-spin"></i> Loading audit log...
                    </div>
                </div>
            </div>
        `;
        
        modal.appendChild(content);
        
        // Attach event listeners
        document.getElementById('closeSyncQueueModal').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        document.getElementById('syncNowBtn').addEventListener('click', async () => {
            await this.triggerManualSync();
            await this.refreshQueueDisplay();
        });
        
        document.getElementById('clearQueueBtn').addEventListener('click', () => {
            this.showClearQueueConfirmation();
        });
        
        document.getElementById('refreshQueueBtn').addEventListener('click', async () => {
            await this.refreshQueueDisplay();
        });
        
        // Close modal on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        return modal;
    }
    
    static async refreshQueueDisplay() {
        try {
            const queue = await this._getQueueItems();
            const auditLog = await this._getAuditLog();
            
            this._displayQueueItems(queue);
            this._displayAuditLog(auditLog);
            this._updateStats(queue, auditLog);
        } catch (err) {
            window.Logger.error('Failed to refresh queue display:', err);
            this._showError('Failed to load queue data');
        }
    }
    
    static _displayQueueItems(queue) {
        const container = document.getElementById(this.QUEUE_CONTAINER_ID);
        
        if (!queue || queue.length === 0) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #999;">
                    <i class="fas fa-check-circle" style="font-size: 30px; color: #4caf50;"></i>
                    <p>Sync queue is empty - all data is synced!</p>
                </div>
            `;
            return;
        }
        
        const html = queue.map((item, index) => {
            const actionLabel = this._getActionLabel(item.action);
            const retryColor = item.retryCount > 0 ? '#ff9800' : '#4caf50';
            const statusIcon = item.retryCount > 0 ? '⚠️' : '⏳';
            
            return `
                <div class="queue-item" style="
                    padding: 15px;
                    border-bottom: 1px solid #eee;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background-color: ${item.retryCount > 2 ? '#fff3e0' : 'white'};
                " data-item-id="${item.id}">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <span style="font-weight: bold; font-size: 14px;">${actionLabel}</span>
                            <span style="color: ${retryColor}; font-size: 12px;">
                                ${statusIcon} Retry ${item.retryCount}/${item.maxRetries}
                            </span>
                            <span style="background-color: #e3f2fd; padding: 2px 8px; border-radius: 4px; font-size: 11px; color: #1976d2;">
                                Priority ${item.queuePriority || 'N/A'}
                            </span>
                        </div>
                        <div style="font-size: 12px; color: #666;">
                            ${new Date(item.timestamp).toLocaleString()}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="retry-btn" data-item-id="${item.id}" title="Retry this item" style="
                            padding: 6px 12px;
                            background-color: #2196f3;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                        ">
                            <i class="fas fa-redo"></i> Retry
                        </button>
                        <button class="delete-btn" data-item-id="${item.id}" title="Remove from queue" style="
                            padding: 6px 12px;
                            background-color: #f44336;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                        ">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
        
        // Attach event listeners for individual items
        container.querySelectorAll('.retry-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const itemId = e.currentTarget.dataset.itemId;
                await this._retryQueueItem(itemId);
                await this.refreshQueueDisplay();
            });
        });
        
        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const itemId = e.currentTarget.dataset.itemId;
                if (confirm('Remove this item from queue? It will not be synced.')) {
                    await this._deleteQueueItem(itemId);
                    await this.refreshQueueDisplay();
                }
            });
        });
    }
    
    static _displayAuditLog(auditLog) {
        const container = document.getElementById('auditLogContainer');
        
        if (!auditLog || auditLog.length === 0) {
            container.innerHTML = '<div style="padding: 10px; text-align: center; color: #999;">No offline activities logged yet</div>';
            return;
        }
        
        const html = auditLog.slice(0, 10).reverse().map(log => {
            const syncStatus = log.synced ? '✅ Synced' : '⏳ Pending';
            const syncColor = log.synced ? '#4caf50' : '#ff9800';
            
            return `
                <div style="
                    padding: 10px;
                    border-bottom: 1px solid #eee;
                    font-size: 12px;
                ">
                    <div style="display: flex; justify-content: space-between;">
                        <strong>${log.action}</strong>
                        <span style="color: ${syncColor};">${syncStatus}</span>
                    </div>
                    <div style="color: #999; margin-top: 3px;">
                        ${new Date(log.timestamp).toLocaleString()} - ${log.username} (${log.userRole})
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
    }
    
    static _updateStats(queue, auditLog) {
        document.getElementById('queueCount').textContent = queue.length;
        
        const totalRetries = queue.reduce((sum, item) => sum + item.retryCount, 0);
        document.getElementById('totalRetries').textContent = totalRetries;
        
        const status = queue.length === 0 ? 
            '<span style="color: #4caf50;">✅ All Synced</span>' :
            '<span style="color: #ff9800;">⏳ Pending Sync</span>';
        document.getElementById('syncStatus').innerHTML = status;
        
        // Get last sync time from localStorage
        const lastSyncTime = localStorage.getItem('lastOfflineSyncTime');
        if (lastSyncTime) {
            document.getElementById('lastSyncTime').textContent = 
                new Date(parseInt(lastSyncTime)).toLocaleString();
        }
    }
    
    static _getActionLabel(action) {
        const labels = {
            'createPatient': '➕ Create Patient',
            'updatePatient': '✏️ Update Patient',
            'completeFollowUp': '✓ Complete Follow-up',
            'createSeizureEvent': '🔴 Create Seizure Event',
            'updateDrug': '💊 Update Drug'
        };
        return labels[action] || action;
    }
    
    static async triggerManualSync() {
        // Message service worker to manually process queue
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'MANUAL_SYNC'
            });
            
            this._showSuccess('Sync triggered manually');
            localStorage.setItem('lastOfflineSyncTime', Date.now().toString());
        }
    }
    
    static async _getQueueItems() {
        return new Promise((resolve) => {
            const db = indexedDB.open('EpicareOfflineDB', 4);
            db.onsuccess = () => {
                const transaction = db.result.transaction(['syncQueue'], 'readonly');
                const store = transaction.objectStore('syncQueue');
                const req = store.getAll();
                req.onsuccess = () => {
                    const items = req.result || [];
                    items.sort((a, b) => (a.queuePriority || 4) - (b.queuePriority || 4));
                    resolve(items);
                };
                req.onerror = () => resolve([]);
            };
            db.onerror = () => resolve([]);
        });
    }
    
    static async _getAuditLog() {
        if (window.OfflineAuditLogger) {
            try {
                return await window.OfflineAuditLogger.getAuditLog({ synced: false });
            } catch (err) {
                window.Logger.warn('Failed to get audit log:', err);
                return [];
            }
        }
        return [];
    }
    
    static async _retryQueueItem(itemId) {
        // Reset retry count to 0 to retry immediately
        const db = indexedDB.open('EpicareOfflineDB', 4);
        db.onsuccess = () => {
            const transaction = db.result.transaction(['syncQueue'], 'readwrite');
            const store = transaction.objectStore('syncQueue');
            const req = store.get(parseInt(itemId));
            req.onsuccess = () => {
                const item = req.result;
                if (item) {
                    item.retryCount = 0;
                    store.put(item);
                    this.triggerManualSync();
                }
            };
        };
    }
    
    static async _deleteQueueItem(itemId) {
        const db = indexedDB.open('EpicareOfflineDB', 4);
        db.onsuccess = () => {
            const transaction = db.result.transaction(['syncQueue'], 'readwrite');
            const store = transaction.objectStore('syncQueue');
            store.delete(parseInt(itemId));
        };
    }
    
    static showClearQueueConfirmation() {
        if (confirm('Are you sure you want to clear all queued items? They will not be synced.')) {
            this._clearAllQueue();
        }
    }
    
    static async _clearAllQueue() {
        const db = indexedDB.open('EpicareOfflineDB', 4);
        db.onsuccess = () => {
            const transaction = db.result.transaction(['syncQueue'], 'readwrite');
            const store = transaction.objectStore('syncQueue');
            store.clear();
            this._showSuccess('Queue cleared');
            this.refreshQueueDisplay();
        };
    }
    
    static _showError(message) {
        if (typeof showNotification === 'function') {
            showNotification(message, 'error');
        } else {
            alert(message);
        }
    }
    
    static _showSuccess(message) {
        if (typeof showNotification === 'function') {
            showNotification(message, 'success');
        } else {
            alert(message);
        }
    }
}

// =====================================================
// EXPORT
// =====================================================

if (typeof window !== 'undefined') {
    window.OfflineSyncQueueUI = OfflineSyncQueueUI;
}
