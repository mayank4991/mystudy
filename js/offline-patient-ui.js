/**
 * Offline Patient Creation UI Manager
 * Displays pending offline patients and provides retry/edit interfaces
 * 
 * Features:
 * - Show list of pending offline patient creations
 * - Display sync status (pending, syncing, synced, failed)
 * - Retry button for failed creations (with edit capability)
 * - Edit form for changing data before retry
 * - Delete/discard option for failed patients
 * 
 * Author: Offline Enhancement Suite
 * Date: Feb 8, 2026
 */

class OfflinePatientUIManager {
    constructor() {
        this.DB_NAME = 'EpicareOfflineDB';
        this.PATIENT_STORE = 'offlinePatients';
        this.SYNC_QUEUE_STORE = 'syncQueue';
        this.MODAL_ID = 'offlinePatientModal';
    }

    /**
     * Show modal with pending offline patients
     * Allows user to view, edit, retry, or delete failed patient creations
     * 
     * @returns {Promise<void>}
     */
    async showPendingPatientModal() {
        try {
            const pendingPatients = await window.OfflinePatientCreationManager.getPendingOfflinePatients();
            
            if (pendingPatients.length === 0) {
                showNotification('No offline patients pending sync', 'info');
                return;
            }
            
            // Create modal
            const modalHTML = `
                <div class="modal fade" id="${this.MODAL_ID}" tabindex="-1" role="dialog">
                    <div class="modal-dialog modal-lg" role="document">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">
                                    <i class="fas fa-user-plus"></i> Offline Patient Creations (${pendingPatients.length})
                                </h5>
                                <button type="button" class="close" data-dismiss="modal">
                                    <span>&times;</span>
                                </button>
                            </div>
                            <div class="modal-body" id="offlinePatientList">
                                ${this._generatePatientListHTML(pendingPatients)}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove old modal if exists
            const existingModal = document.getElementById(this.MODAL_ID);
            if (existingModal) {
                existingModal.remove();
            }
            
            // Insert new modal
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            // Show modal
            const modal = document.getElementById(this.MODAL_ID);
            $(modal).modal('show');
            
            // Attach event listeners
            this._attachEventListeners();
            
        } catch (err) {
            console.error('[OfflinePatientUI] Error showing modal:', err);
            showNotification('Error loading offline patients', 'error');
        }
    }

    /**
     * Generate HTML for patient list
     * @private
     */
    _generatePatientListHTML(patients) {
        const html = patients.map(patient => {
            const status = patient.offlineStatus || 'pending';
            const statusBadge = this._getStatusBadge(status);
            const syncAttempts = patient.syncAttempts || 0;
            const createdAt = patient.createdAt ? new Date(patient.createdAt).toLocaleString() : 'Unknown';
            
            const actionButtons = this._getActionButtons(patient.ID, status);
            
            return `
                <div class="card mb-3 border-${this._getStatusColor(status)}">
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-8">
                                <h6 class="card-title">
                                    ${patient.PatientName}
                                    ${statusBadge}
                                </h6>
                                <p class="text-muted mb-2">
                                    <small>
                                        <strong>Temp ID:</strong> ${patient.ID}<br>
                                        <strong>Phone:</strong> ${patient.Phone}<br>
                                        <strong>Created:</strong> ${createdAt}<br>
                                        <strong>Sync Attempts:</strong> ${syncAttempts}/3
                                        ${patient.lastSyncError ? `<br><strong style="color: #dc3545;">Error:</strong> ${patient.lastSyncError}` : ''}
                                    </small>
                                </p>
                            </div>
                            <div class="col-md-4">
                                ${actionButtons}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        return `<div id="patientListContainer">${html}</div>`;
    }

    /**
     * Get status badge HTML
     * @private
     */
    _getStatusBadge(status) {
        const badges = {
            pending: '<span class="badge badge-info">⏳ Pending</span>',
            syncing: '<span class="badge badge-primary">🔄 Syncing</span>',
            synced: '<span class="badge badge-success">✅ Synced</span>',
            failed: '<span class="badge badge-danger">❌ Failed</span>'
        };
        return badges[status] || '<span class="badge badge-secondary">Unknown</span>';
    }

    /**
     * Get status color for card border
     * @private
     */
    _getStatusColor(status) {
        const colors = {
            pending: 'info',
            syncing: 'primary',
            synced: 'success',
            failed: 'danger'
        };
        return colors[status] || 'secondary';
    }

    /**
     * Get action buttons based on status
     * @private
     */
    _getActionButtons(patientID, status) {
        const buttons = [];
        
        if (status === 'failed' || status === 'pending') {
            buttons.push(`
                <button class="btn btn-sm btn-primary mb-2 w-100 retry-patient" data-patient-id="${patientID}">
                    <i class="fas fa-redo"></i> Retry
                </button>
            `);
            buttons.push(`
                <button class="btn btn-sm btn-warning mb-2 w-100 edit-patient" data-patient-id="${patientID}">
                    <i class="fas fa-edit"></i> Edit
                </button>
            `);
        }
        
        if (status === 'failed') {
            buttons.push(`
                <button class="btn btn-sm btn-danger w-100 delete-patient" data-patient-id="${patientID}">
                    <i class="fas fa-trash"></i> Delete
                </button>
            `);
        }
        
        return `<div class="btn-group-vertical w-100">${buttons.join('')}</div>`;
    }

    /**
     * Attach event listeners to action buttons
     * @private
     */
    _attachEventListeners() {
        // Retry buttons
        document.querySelectorAll('.retry-patient').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const patientID = e.target.closest('button').dataset.patientId;
                await this.retryPatient(patientID);
            });
        });
        
        // Edit buttons
        document.querySelectorAll('.edit-patient').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const patientID = e.target.closest('button').dataset.patientId;
                await this.editPatient(patientID);
            });
        });
        
        // Delete buttons
        document.querySelectorAll('.delete-patient').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const patientID = e.target.closest('button').dataset.patientId;
                await this.deletePatient(patientID);
            });
        });
    }

    /**
     * Retry patient creation sync
     * 
     * @param {string} patientID - Temporary patient ID
     */
    async retryPatient(patientID) {
        try {
            showLoading('Retrying patient creation...');
            
            const result = await window.OfflinePatientCreationManager.retryPatientSync(
                patientID,
                null,
                window.currentUserName
            );
            
            hideLoading();
            
            if (result.success) {
                showNotification(result.message, 'success');
                // Refresh modal
                $(`#${this.MODAL_ID}`).modal('hide');
                setTimeout(() => this.showPendingPatientModal(), 500);
            } else {
                showNotification(result.message, 'error');
            }
        } catch (err) {
            hideLoading();
            console.error('[OfflinePatientUI] Error retrying patient:', err);
            showNotification('Error retrying patient creation', 'error');
        }
    }

    /**
     * Edit patient data and retry
     * 
     * @param {string} patientID - Temporary patient ID
     */
    async editPatient(patientID) {
        try {
            const db = await this._openDB();
            const tx = db.transaction(['offlinePatients'], 'readonly');
            const store = tx.objectStore('offlinePatients');
            const patient = await store.get(patientID);
            
            if (!patient) {
                showNotification('Patient not found', 'error');
                return;
            }
            
            // Create edit modal
            const editModalHTML = `
                <div class="modal fade" id="editPatientModal" tabindex="-1" role="dialog">
                    <div class="modal-dialog modal-lg" role="document">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Edit Offline Patient</h5>
                                <button type="button" class="close" data-dismiss="modal">
                                    <span>&times;</span>
                                </button>
                            </div>
                            <div class="modal-body">
                                <form id="editPatientForm">
                                    <div class="form-row">
                                        <div class="form-group col-md-6">
                                            <label>Patient Name *</label>
                                            <input type="text" name="PatientName" value="${patient.PatientName || ''}" class="form-control" required>
                                        </div>
                                        <div class="form-group col-md-6">
                                            <label>Father Name</label>
                                            <input type="text" name="FatherName" value="${patient.FatherName || ''}" class="form-control">
                                        </div>
                                    </div>
                                    
                                    <div class="form-row">
                                        <div class="form-group col-md-4">
                                            <label>Age *</label>
                                            <input type="number" name="Age" value="${patient.Age || ''}" class="form-control" required>
                                        </div>
                                        <div class="form-group col-md-4">
                                            <label>Gender *</label>
                                            <select name="Gender" class="form-control" required>
                                                <option value="">Select...</option>
                                                <option value="Male" ${patient.Gender === 'Male' ? 'selected' : ''}>Male</option>
                                                <option value="Female" ${patient.Gender === 'Female' ? 'selected' : ''}>Female</option>
                                                <option value="Other" ${patient.Gender === 'Other' ? 'selected' : ''}>Other</option>
                                            </select>
                                        </div>
                                        <div class="form-group col-md-4">
                                            <label>Phone *</label>
                                            <input type="tel" name="Phone" value="${patient.Phone || ''}" class="form-control" required>
                                        </div>
                                    </div>
                                    
                                    <div class="form-row">
                                        <div class="form-group col-md-6">
                                            <label>Diagnosis *</label>
                                            <input type="text" name="Diagnosis" value="${patient.Diagnosis || ''}" class="form-control" required>
                                        </div>
                                        <div class="form-group col-md-6">
                                            <label>PHC *</label>
                                            <input type="text" name="PHC" value="${patient.PHC || ''}" class="form-control" required>
                                        </div>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label>Address</label>
                                        <input type="text" name="Address" value="${patient.Address || ''}" class="form-control">
                                    </div>
                                    
                                    <div class="alert alert-info">
                                        <small><strong>Note:</strong> Duplicate check will be performed again on sync with updated data.</small>
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                                <button type="button" class="btn btn-primary" id="saveEditButton">Save & Retry</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove old modal if exists
            const existingEditModal = document.getElementById('editPatientModal');
            if (existingEditModal) {
                existingEditModal.remove();
            }
            
            document.body.insertAdjacentHTML('beforeend', editModalHTML);
            const editModal = document.getElementById('editPatientModal');
            
            // Save handler
            document.getElementById('saveEditButton').addEventListener('click', async () => {
                try {
                    const formData = new FormData(document.getElementById('editPatientForm'));
                    const updatedData = Object.fromEntries(formData);
                    
                    showLoading('Saving changes and retrying...');
                    
                    const result = await window.OfflinePatientCreationManager.retryPatientSync(
                        patientID,
                        updatedData,
                        window.currentUserName
                    );
                    
                    hideLoading();
                    
                    if (result.success) {
                        $(editModal).modal('hide');
                        showNotification('Patient data updated. Will retry sync.', 'success');
                        // Refresh main modal
                        $(`#${this.MODAL_ID}`).modal('hide');
                        setTimeout(() => this.showPendingPatientModal(), 500);
                    } else {
                        showNotification(result.message, 'error');
                    }
                } catch (err) {
                    hideLoading();
                    console.error('[OfflinePatientUI] Error saving edit:', err);
                    showNotification('Error saving changes', 'error');
                }
            });
            
            $(editModal).modal('show');
            
        } catch (err) {
            console.error('[OfflinePatientUI] Error editing patient:', err);
            showNotification('Error loading patient data for edit', 'error');
        }
    }

    /**
     * Delete/discard offline patient
     * 
     * @param {string} patientID - Temporary patient ID
     */
    async deletePatient(patientID) {
        const confirmed = confirm(
            'Are you sure you want to delete this offline patient creation?\n\n' +
            'This will discard the temporary record and it will not be synced.'
        );
        
        if (!confirmed) return;
        
        try {
            showLoading('Deleting patient...');
            
            const db = await this._openDB();
            
            // Delete from offline patients
            const patientTx = db.transaction(['offlinePatients'], 'readwrite');
            const patientStore = patientTx.objectStore('offlinePatients');
            await patientStore.delete(patientID);
            
            // Delete from sync queue
            const syncTx = db.transaction(['syncQueue'], 'readwrite');
            const syncStore = syncTx.objectStore('syncQueue');
            const allQueue = await syncStore.getAll();
            
            for (const item of allQueue) {
                if (item.entityID === patientID && item.action === 'createPatient') {
                    await syncStore.delete(item.id);
                }
            }
            
            hideLoading();
            showNotification('Offline patient deleted', 'success');
            
            // Refresh modal
            $(`#${this.MODAL_ID}`).modal('hide');
            setTimeout(() => this.showPendingPatientModal(), 500);
            
        } catch (err) {
            hideLoading();
            console.error('[OfflinePatientUI] Error deleting patient:', err);
            showNotification('Error deleting patient', 'error');
        }
    }

    /**
     * Open IndexedDB connection
     * @private
     */
    async _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, 4);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
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
window.OfflinePatientUIManager = new OfflinePatientUIManager();
