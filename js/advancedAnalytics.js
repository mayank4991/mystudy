/**
 * Advanced Analytics Module
 * Comprehensive clinical and operational analytics with Chart.js visualizations
 */

// API_CONFIG is available globally

// Chart instances for cleanup
let chartInstances = {};

// Current filters
let currentFilters = {
    phc: 'All',
    startDate: null,
    endDate: null,
    patientId: null
};

/**
 * Initialize advanced analytics
 */
async function initAdvancedAnalytics() {
    window.Logger.debug('Initializing advanced analytics...');
    
    try {
        // Setup modal event listeners
        setupModalEventListeners();
        
        // Load facilities for filter dropdown
        await loadPhcOptions();
        
        // Set default date range (last 6 months)
        setDefaultDateRange();
        
        // Initialize custom report modules
        initializeCustomReportModules();
        
        // Load initial data
        await loadAllAnalytics();
        
        window.Logger.debug('Advanced analytics initialized successfully');
    } catch (error) {
        window.Logger.error('Failed to initialize advanced analytics:', error);
        showNotification('Failed to load analytics. Please try again.', 'error');
    }
}

/**
 * Initialize custom report modules
 */
function initializeCustomReportModules() {
    try {
        // Initialize custom reports module
        if (window.CustomReports) {
            window.CustomReports.init();
        }
        
        // Setup event handler for query builder toggling
        setupQueryBuilderToggle();
        
        window.Logger.debug('Custom report modules initialized');
    } catch (error) {
        window.Logger.error('Error initializing custom report modules:', error);
    }
}

/**
 * Setup query builder toggle between quick reports and advanced builder
 */
function setupQueryBuilderToggle() {
    // Note: This will be enhanced to allow users to toggle between 
    // quick reports and advanced query builder without affecting existing charts
}

/**
 * Setup modal event listeners
 */
function setupModalEventListeners() {
    const modal = document.getElementById('advancedAnalyticsModal');
    const openBtn = document.getElementById('openAdvancedAnalyticsBtn');
    const closeBtn = document.getElementById('advancedAnalyticsClose');
    
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            modal.style.display = 'flex';
            loadAllAnalytics();
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    // Close on outside click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    // Filter event listeners
    const phcFilter = document.getElementById('advancedPhcFilter');
    const startDateFilter = document.getElementById('analyticsStartDate');
    const endDateFilter = document.getElementById('analyticsEndDate');
    
    if (phcFilter) {
        phcFilter.addEventListener('change', (e) => {
            currentFilters.phc = e.target.value;
            loadAllAnalytics();
        });
    }
    
    if (startDateFilter) {
        startDateFilter.addEventListener('change', (e) => {
            currentFilters.startDate = e.target.value;
            loadAllAnalytics();
        });
    }
    
    if (endDateFilter) {
        endDateFilter.addEventListener('change', (e) => {
            currentFilters.endDate = e.target.value;
            loadAllAnalytics();
        });
    }
}

/**
 * Load facility options for filter dropdown
 */
async function loadPhcOptions() {
    try {
        const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?action=getActivePHCNames&t=${Date.now()}`);
        const result = await response.json();
        
        if (result.status === 'success') {
            const select = document.getElementById('advancedPhcFilter');
                if (select) {
                    select.innerHTML = `<option value="All">${window.EpicareI18n ? window.EpicareI18n.translate('dropdown.allFacilities') : EpicareI18n.translate('dropdown.allFacilities')}</option>`;
                result.data.forEach(phc => {
                    const option = document.createElement('option');
                    option.value = phc;
                    option.textContent = phc;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        window.Logger.error('Failed to load PHC options:', error);
    }
}

/**
 * Set default date range to last 6 months
 */
function setDefaultDateRange() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);
    
    currentFilters.startDate = startDate.toISOString().split('T')[0];
    currentFilters.endDate = endDate.toISOString().split('T')[0];
    
    const startInput = document.getElementById('analyticsStartDate');
    const endInput = document.getElementById('analyticsEndDate');
    
    if (startInput) startInput.value = currentFilters.startDate;
    if (endInput) endInput.value = currentFilters.endDate;
}

/**
 * Load all analytics data
 */
async function loadAllAnalytics() {
    try {
        showLoadingState();
        
        // Load data in parallel using allSettled to prevent one failure from blocking all charts
        const results = await Promise.allSettled([
            loadSeizureFrequencyAnalytics(),
            loadMedicationAdherenceAnalytics(),
            loadReferralAnalytics(),
            loadPatientOutcomesAnalytics(),
            loadPatientStatusAnalytics(),
            loadAgeDistributionAnalytics(),
            loadAgeOfOnsetDistributionAnalytics()
        ]);
        
        // Helper to get data or null if failed
        const getData = (result, name) => {
            if (result.status === 'fulfilled') {
                window.Logger.debug(`✓ ${name} loaded:`, result.value);
                return result.value;
            }
            window.Logger.error(`✗ Failed to load ${name}:`, result.reason);
            return null; // Render functions handle null/empty data gracefully
        };

        // Render charts with data logging
        window.Logger.debug('=== Advanced Analytics Data Loading ===');
        renderSeizureFrequencyChart(getData(results[0], 'Seizure Frequency'));
        renderMedicationAdherenceChart(getData(results[1], 'Medication Adherence'));
        renderReferralAnalyticsChart(getData(results[2], 'Referral Analytics'));
        renderPatientOutcomesChart(getData(results[3], 'Patient Outcomes'));
        renderPatientStatusAnalyticsChart(getData(results[4], 'Patient Status'));
        renderAgeDistributionChart(getData(results[5], 'Age Distribution'));
        renderAgeOfOnsetDistributionChart(getData(results[6], 'Age of Onset'));
        window.Logger.debug('=== Analytics Loading Complete ===');
        
        // Render follow-up status table
        renderFollowUpStatusTable();
        
        // Render analytics summary
        renderAnalyticsSummary();
        
    } catch (error) {
        window.Logger.error('Error loading analytics:', error);
            showNotification(window.EpicareI18n ? window.EpicareI18n.translate('analytics.loadFailed') : 'Failed to load analytics data', 'error');
    } finally {
        hideLoadingState();
    }
}

/**
 * Load seizure frequency analytics
 */
async function loadSeizureFrequencyAnalytics() {
    const params = new URLSearchParams({
        action: 'getSeizureFrequencyAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Seizure Frequency Raw Response:', result);
    
    if (result.status === 'success') {
        // Backend returns: { status: 'success', data: { status: 'success', data: [...] } }
        // Extract the actual data array
        let extractedData = null;
        
        // Try nested extraction first (data.data)
        if (result.data && result.data.data && Array.isArray(result.data.data)) {
            extractedData = result.data.data;
        } 
        // Then try direct array
        else if (Array.isArray(result.data)) {
            extractedData = result.data;
        } 
        // Fallback
        else if (result.data) {
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Seizure Frequency Extracted Data:', extractedData);
        return extractedData || [];
    } else {
        window.Logger.error('[Analytics] Seizure Frequency Error:', result.message);
        throw new Error(result.message || 'Failed to load seizure frequency data');
    }
}

/**
 * Load medication adherence analytics
 */
async function loadMedicationAdherenceAnalytics() {
    const params = new URLSearchParams({
        action: 'getMedicationAdherenceAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Medication Adherence Raw Response:', result);
    
    if (result.status === 'success') {
        let extractedData = null;
        if (result.data && result.data.status === 'success' && result.data.data) {
            extractedData = result.data.data;
        } else if (result.data) {
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Medication Adherence Extracted Data:', extractedData);
        return extractedData || {};
    } else {
        window.Logger.error('[Analytics] Medication Adherence Error:', result.message);
        throw new Error(result.message || 'Failed to load medication adherence data');
    }
}

/**
 * Load referral analytics
 */
async function loadReferralAnalytics() {
    const params = new URLSearchParams({
        action: 'getReferralAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Referral Analytics Raw Response:', result);
    
    if (result.status === 'success') {
        let extractedData = null;
        if (result.data && result.data.status === 'success' && result.data.data) {
            extractedData = result.data.data;
        } else if (result.data) {
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Referral Analytics Extracted Data:', extractedData);
        return extractedData || { monthlyTrends: [], overallStats: {} };
    } else {
        window.Logger.error('[Analytics] Referral Analytics Error:', result.message);
        throw new Error(result.message || 'Failed to load referral analytics data');
    }
}

/**
 * Load patient outcomes analytics
 */
async function loadPatientOutcomesAnalytics() {
    const params = new URLSearchParams({
        action: 'getPatientOutcomesAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Patient Outcomes Raw Response:', result);
    
    if (result.status === 'success') {
        let extractedData = null;
        if (result.data && result.data.status === 'success' && result.data.data) {
            extractedData = result.data.data;
        } else if (result.data) {
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Patient Outcomes Extracted Data:', extractedData);
        return extractedData || { seizureControl: {}, workStatus: {} };
    } else {
        window.Logger.error('[Analytics] Patient Outcomes Error:', result.message);
        throw new Error(result.message || 'Failed to load patient outcomes data');
    }
}

/**
 * Load patient status analytics
 */
async function loadPatientStatusAnalytics() {
    const params = new URLSearchParams({
        action: 'getPatientStatusAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Patient Status Raw Response:', result);
    
    if (result.status === 'success') {
        let extractedData = null;
        
        // Backend returns: { status: 'success', data: { status: 'success', data: {...} } }
        // For patient status, we want the data object (statusCounts)
        if (result.data && result.data.data && typeof result.data.data === 'object' && !Array.isArray(result.data.data)) {
            // result.data.data is the statusCounts object
            extractedData = result.data.data;
        } else if (result.data && result.data.statusCounts) {
            extractedData = result.data.statusCounts;
        } else if (typeof result.data === 'object' && !Array.isArray(result.data)) {
            // Try to use result.data directly if it's an object
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Patient Status Extracted Data:', extractedData);
        return extractedData || {};
    } else {
        window.Logger.error('[Analytics] Patient Status Error:', result.message);
        throw new Error(result.message || 'Failed to load patient status data');
    }
}

/**
 * Load age distribution analytics
 */
async function loadAgeDistributionAnalytics() {
    const params = new URLSearchParams({
        action: 'getAgeDistributionAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Age Distribution Raw Response:', result);
    
    if (result.status === 'success') {
        let extractedData = null;
        if (result.data && result.data.status === 'success' && result.data.data) {
            extractedData = result.data.data;
        } else if (result.data && Array.isArray(result.data)) {
            extractedData = result.data;
        } else if (result.data) {
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Age Distribution Extracted Data:', extractedData);
        return extractedData || [];
    } else {
        window.Logger.error('[Analytics] Age Distribution Error:', result.message);
        throw new Error(result.message || 'Failed to load age distribution data');
    }
}

/**
 * Load age of onset distribution analytics
 */
async function loadAgeOfOnsetDistributionAnalytics() {
    const params = new URLSearchParams({
        action: 'getAgeOfOnsetDistributionAnalytics',
        ...currentFilters,
        t: Date.now()
    });
    
    const response = await fetch(`${API_CONFIG.MAIN_SCRIPT_URL}?${params}`);
    const result = await response.json();
    
    window.Logger.debug('[Analytics] Age of Onset Distribution Raw Response:', result);
    
    if (result.status === 'success') {
        let extractedData = null;
        if (result.data && result.data.status === 'success' && result.data.data) {
            extractedData = result.data.data;
        } else if (result.data && Array.isArray(result.data)) {
            extractedData = result.data;
        } else if (result.data) {
            extractedData = result.data;
        }
        
        window.Logger.debug('[Analytics] Age of Onset Distribution Extracted Data:', extractedData);
        return extractedData || [];
    } else {
        window.Logger.error('[Analytics] Age of Onset Distribution Error:', result.message);
        throw new Error(result.message || 'Failed to load age of onset distribution data');
    }
}

/**
 * Render seizure frequency chart
 */
function renderSeizureFrequencyChart(data) {
    const ctx = document.getElementById('seizureFrequencyChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Handle case where data might be undefined or empty
    if (!data || !Array.isArray(data) || data.length === 0) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = window.EpicareI18n ? window.EpicareI18n.translate('analytics.noSeizureData') : 'No seizure frequency data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.seizureFrequency) {
        chartInstances.seizureFrequency.destroy();
        // Remove Chart.js monitor elements
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    const labels = data.map(item => item.month);
    const datasets = [
        {
            label: 'Seizure Free (0)',
            data: data.map(item => item.seizureData['Seizure Free'] || 0),
            backgroundColor: 'rgba(34, 197, 94, 0.7)',
            borderColor: 'rgba(34, 197, 94, 1)',
            borderWidth: 2,
            fill: false,
            tension: 0.3
        },
        {
            label: 'Rare (1-2)',
            data: data.map(item => item.seizureData['Rare (1-2)'] || 0),
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 2,
            fill: false,
            tension: 0.3
        },
        {
            label: 'Occasional (3-5)',
            data: data.map(item => item.seizureData['Occasional (3-5)'] || 0),
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderColor: 'rgba(245, 158, 11, 1)',
            borderWidth: 2,
            fill: false,
            tension: 0.3
        },
        {
            label: 'Frequent (6-10)',
            data: data.map(item => item.seizureData['Frequent (6-10)'] || 0),
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderColor: 'rgba(239, 68, 68, 1)',
            borderWidth: 2,
            fill: false,
            tension: 0.3
        },
        {
            label: 'Very Frequent (>10)',
            data: data.map(item => item.seizureData['Very Frequent (>10)'] || 0),
            backgroundColor: 'rgba(153, 27, 27, 0.7)',
            borderColor: 'rgba(153, 27, 27, 1)',
            borderWidth: 2,
            fill: false,
            tension: 0.3
        }
    ];
    
    // Also add average seizure count as a secondary line if available
    if (data.some(item => item.avgSeizureCount > 0)) {
        datasets.push({
            label: 'Avg Seizure Count',
            data: data.map(item => item.avgSeizureCount || 0),
            backgroundColor: 'rgba(107, 114, 128, 0.3)',
            borderColor: 'rgba(107, 114, 128, 1)',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
            yAxisID: 'y1'
        });
    }
    
    chartInstances.seizureFrequency = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                        text: window.EpicareI18n ? window.EpicareI18n.translate('analytics.seizureTrendsTitle') : 'Seizure Frequency Trends Over Time'
                },
                legend: {
                    position: 'top'
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    font: {
                        size: 10,
                        weight: 'bold'
                    },
                    color: '#333'
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Month'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Number of Patients'
                    },
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                },
                y1: {
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Avg Seizure Count'
                    },
                    beginAtZero: true,
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

/**
 * Render medication adherence chart
 */
function renderMedicationAdherenceChart(data) {
    const ctx = document.getElementById('medicationAdherenceChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Handle case where data might be undefined or empty
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = window.EpicareI18n ? window.EpicareI18n.translate('analytics.noAdherenceData') : 'No medication adherence data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.medicationAdherence) {
        chartInstances.medicationAdherence.destroy();
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    const labels = Object.keys(data);
    const chartData = Object.values(data).map(item => item.count);
    const colors = [
        'rgba(34, 197, 94, 0.8)',   // Good adherence - green
        'rgba(245, 158, 11, 0.8)',  // Partial adherence - yellow
        'rgba(239, 68, 68, 0.8)',   // Poor adherence - red
        'rgba(59, 130, 246, 0.8)',  // Other - blue
        'rgba(147, 51, 234, 0.8)'   // Additional - purple
    ];
    
    chartInstances.medicationAdherence = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: chartData,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Medication Adherence Distribution'
                },
                legend: {
                    position: 'bottom'
                },
                datalabels: {
                    display: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    borderRadius: 4,
                    borderColor: '#999',
                    borderWidth: 1,
                    color: '#333',
                    font: {
                        size: 11,
                        weight: 'bold'
                    },
                    formatter: function(value) {
                        return value;
                    }
                }
            }
        }
    });
}

/**
 * Render referral analytics chart
 */
function renderReferralAnalyticsChart(data) {
    const ctx = document.getElementById('referralAnalyticsChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.referralAnalytics) {
        chartInstances.referralAnalytics.destroy();
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    // Backend returns { monthlyTrends: [...], overallStats: {...} }
    let monthlyData = null;
    if (data && data.monthlyTrends && Array.isArray(data.monthlyTrends)) {
        monthlyData = data.monthlyTrends;
    }
    
    // Handle case where data might be undefined or empty
    if (!monthlyData || monthlyData.length === 0) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = 'No referral analytics data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    const labels = monthlyData.map(item => item.month);
    const referralCounts = monthlyData.map(item => item.totalReferrals);
    
    chartInstances.referralAnalytics = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Referrals',
                data: referralCounts,
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Referral Trends Over Time'
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    font: {
                        size: 11,
                        weight: 'bold'
                    },
                    color: '#333'
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Month'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Number of Referrals'
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

/**
 * Render patient outcomes chart
 */
function renderPatientOutcomesChart(data) {
    const ctx = document.getElementById('patientOutcomesChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.patientOutcomes) {
        chartInstances.patientOutcomes.destroy();
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    // Backend returns { seizureControl: {...}, workStatus: {...}, sideEffects: {...}, totalRecords }
    let seizureControlData = null;
    if (data && data.seizureControl && typeof data.seizureControl === 'object' && Object.keys(data.seizureControl).length > 0) {
        seizureControlData = data.seizureControl;
    }
    
    // Handle case where data might be undefined or empty
    if (!seizureControlData) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = 'No patient outcomes data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    // Focus on seizure control data
    const labels = Object.keys(seizureControlData);
    const chartData = Object.values(seizureControlData);
    
    const colors = [
        'rgba(34, 197, 94, 0.8)',   // Seizure Free - green
        'rgba(59, 130, 246, 0.8)',  // Rarely - blue
        'rgba(245, 158, 11, 0.8)',  // Monthly - yellow
        'rgba(239, 68, 68, 0.8)',   // Weekly - red
        'rgba(153, 27, 27, 0.8)'    // Daily - dark red
    ];
    
    chartInstances.patientOutcomes = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: chartData,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Patient Seizure Control Outcomes'
                },
                legend: {
                    position: 'bottom'
                },
                datalabels: {
                    display: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    borderRadius: 4,
                    borderColor: '#999',
                    borderWidth: 1,
                    color: '#333',
                    font: {
                        size: 11,
                        weight: 'bold'
                    },
                    formatter: function(value) {
                        return value;
                    }
                }
            }
        }
    });
}

/**
 * Render patient status analytics chart
 */
function renderPatientStatusAnalyticsChart(data) {
    const ctx = document.getElementById('patientStatusAnalyticsChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.patientStatusAnalytics) {
        chartInstances.patientStatusAnalytics.destroy();
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    // Handle case where data might be undefined or empty
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = 'No patient status data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    const labels = Object.keys(data);
    const chartData = Object.values(data).map(item => item.count);
    const colors = [
        'rgba(34, 197, 94, 0.8)',   // Active - green
        'rgba(245, 158, 11, 0.8)',  // Draft - yellow
        'rgba(239, 68, 68, 0.8)',   // Inactive - red
        'rgba(59, 130, 246, 0.8)',  // Other - blue
    ];
    
    chartInstances.patientStatusAnalytics = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: chartData,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Patient Status Distribution'
                },
                legend: {
                    position: 'bottom'
                },
                datalabels: {
                    display: true,
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    borderRadius: 4,
                    borderColor: '#999',
                    borderWidth: 1,
                    color: '#333',
                    font: {
                        size: 11,
                        weight: 'bold'
                    },
                    formatter: function(value) {
                        return value;
                    }
                }
            }
        }
    });
}

/**
 * Render age distribution chart
 */
function renderAgeDistributionChart(data) {
    const ctx = document.getElementById('ageDistributionChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.ageDistribution) {
        chartInstances.ageDistribution.destroy();
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    // Handle case where data might be undefined or empty
    if (!data || !Array.isArray(data) || data.length === 0) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = 'No age distribution data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    const labels = data.map(item => item.ageGroup);
    const chartData = data.map(item => item.count);
    
    // Calculate normal distribution curve
    const mean = data.reduce((sum, item) => sum + (item.midpoint * item.count), 0) / data.reduce((sum, item) => sum + item.count, 0);
    const stdDev = Math.sqrt(data.reduce((sum, item) => sum + (Math.pow(item.midpoint - mean, 2) * item.count), 0) / data.reduce((sum, item) => sum + item.count, 0));
    
    const normalCurve = labels.map((_, index) => {
        const x = data[index].midpoint;
        return (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2)) * data.reduce((sum, item) => sum + item.count, 0) * 0.1;
    });
    
    chartInstances.ageDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Patient Count',
                data: chartData,
                backgroundColor: 'rgba(16, 185, 129, 0.7)',
                borderColor: 'rgba(16, 185, 129, 1)',
                borderWidth: 2,
                yAxisID: 'y'
            }, {
                label: 'Normal Distribution',
                data: normalCurve,
                type: 'line',
                backgroundColor: 'rgba(245, 158, 11, 0.3)',
                borderColor: 'rgba(245, 158, 11, 1)',
                borderWidth: 2,
                fill: false,
                pointRadius: 0,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Age Distribution with Normal Curve'
                },
                legend: {
                    position: 'top'
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    font: {
                        size: 9,
                        weight: 'bold'
                    },
                    color: '#333'
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Age Groups'
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Number of Patients'
                    },
                    beginAtZero: true
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Normal Distribution Density'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

/**
 * Render age of onset distribution chart
 */
function renderAgeOfOnsetDistributionChart(data) {
    const ctx = document.getElementById('ageOfOnsetDistributionChart');
    if (!ctx) return;
    
    const container = ctx.parentElement;
    let noDataMsg = container.querySelector('.no-data-message');

    // Destroy existing chart and remove Chart.js monitor nodes
    if (chartInstances.ageOfOnsetDistribution) {
        chartInstances.ageOfOnsetDistribution.destroy();
        const parent = ctx.parentElement;
        if (parent) {
            parent.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
        }
    }
    
    // Handle case where data might be undefined or empty
    if (!data || !Array.isArray(data) || data.length === 0) {
        ctx.style.display = 'none';
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message text-center p-4';
            noDataMsg.innerHTML = 'No age of onset data available';
            container.appendChild(noDataMsg);
        } else {
            noDataMsg.style.display = 'block';
        }
        return;
    }
    
    // Data exists
    ctx.style.display = 'block';
    if (noDataMsg) noDataMsg.style.display = 'none';
    
    const labels = data.map(item => item.ageGroup);
    const chartData = data.map(item => item.count);
    
    // Calculate normal distribution curve
    const mean = data.reduce((sum, item) => sum + (item.midpoint * item.count), 0) / data.reduce((sum, item) => sum + item.count, 0);
    const stdDev = Math.sqrt(data.reduce((sum, item) => sum + (Math.pow(item.midpoint - mean, 2) * item.count), 0) / data.reduce((sum, item) => sum + item.count, 0));
    
    const normalCurve = labels.map((_, index) => {
        const x = data[index].midpoint;
        return (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2)) * data.reduce((sum, item) => sum + item.count, 0) * 0.1;
    });
    
    chartInstances.ageOfOnsetDistribution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Patient Count',
                data: chartData,
                backgroundColor: 'rgba(245, 158, 11, 0.7)',
                borderColor: 'rgba(245, 158, 11, 1)',
                borderWidth: 2,
                yAxisID: 'y'
            }, {
                label: 'Normal Distribution',
                data: normalCurve,
                type: 'line',
                backgroundColor: 'rgba(239, 68, 68, 0.3)',
                borderColor: 'rgba(239, 68, 68, 1)',
                borderWidth: 2,
                fill: false,
                pointRadius: 0,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Age of Onset Distribution with Normal Curve'
                },
                legend: {
                    position: 'top'
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    font: {
                        size: 9,
                        weight: 'bold'
                    },
                    color: '#333'
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Age Groups'
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Number of Patients'
                    },
                    beginAtZero: true
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Normal Distribution Density'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

/**
 * Render analytics summary with actionable insights
 */
function renderAnalyticsSummary() {
    try {
        const summaryElement = document.getElementById('analyticsSummary');
        if (!summaryElement) {
            window.Logger.warn('analyticsSummary element not found');
            return;
        }

        // Get all active patients for counts
        const allPatients = getActivePatients();
        const followUps = window.followUpsData || window.allFollowUps || [];
        const now = new Date();
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        
        // Count recent follow-ups (from actual follow-up data)
        let recentFollowUps = 0;
        let totalFollowUps = followUps.length;
        
        // Count seizure control from follow-up data (numeric SeizureFrequency)
        let seizureFreeFollowUps = 0;
        let rareSeizureFollowUps = 0; // 1-2
        let frequentSeizureFollowUps = 0; // 6+
        let totalFollowUpsWithSeizureData = 0;
        let totalSeizureCount = 0;
        
        // Adherence from follow-ups
        let goodAdherenceCount = 0;
        let poorAdherenceCount = 0;
        let stoppedMedsCount = 0;
        let totalAdherenceRecords = 0;
        
        followUps.forEach(fu => {
            const fuDate = new Date(fu.FollowUpDate || fu.DateOfFollowUp || fu.SubmissionDate || fu.followUpDate || '');
            if (!isNaN(fuDate.getTime()) && fuDate >= sixMonthsAgo) {
                recentFollowUps++;
            }
            
            // Seizure frequency (numeric count from follow-up form)
            const seizureCount = parseInt(fu.SeizureFrequency, 10);
            if (!isNaN(seizureCount)) {
                totalFollowUpsWithSeizureData++;
                totalSeizureCount += seizureCount;
                if (seizureCount === 0) seizureFreeFollowUps++;
                else if (seizureCount <= 2) rareSeizureFollowUps++;
                else if (seizureCount >= 6) frequentSeizureFollowUps++;
            }
            
            // Treatment adherence
            const adherence = (fu.TreatmentAdherence || '').toLowerCase();
            if (adherence) {
                totalAdherenceRecords++;
                if (adherence.includes('always')) {
                    goodAdherenceCount++;
                } else if (adherence.includes('occasionally miss')) {
                    goodAdherenceCount++;
                } else if (adherence.includes('frequently miss')) {
                    poorAdherenceCount++;
                } else if (adherence.includes('stopped')) {
                    stoppedMedsCount++;
                }
            }
        });
        
        // Patients without follow-up in last 3 months (at-risk)
        const patientsWithRecentFollowUp = new Set();
        followUps.forEach(fu => {
            const fuDate = new Date(fu.FollowUpDate || fu.DateOfFollowUp || fu.SubmissionDate || '');
            if (!isNaN(fuDate.getTime()) && fuDate >= threeMonthsAgo) {
                patientsWithRecentFollowUp.add(String(fu.PatientID || fu.patientId || '').trim());
            }
        });
        const patientsLostToFollowUp = allPatients.filter(p => {
            const pid = String(p.ID || p.Id || p.PatientID || '').trim();
            return pid && !patientsWithRecentFollowUp.has(pid);
        }).length;
        
        // Calculate percentages
        const seizureControlRate = totalFollowUpsWithSeizureData > 0 
            ? Math.round((seizureFreeFollowUps / totalFollowUpsWithSeizureData) * 100) : 0;
        const adherenceRate = totalAdherenceRecords > 0 
            ? Math.round((goodAdherenceCount / totalAdherenceRecords) * 100) : 0;
        const avgSeizures = totalFollowUpsWithSeizureData > 0 
            ? (totalSeizureCount / totalFollowUpsWithSeizureData).toFixed(1) : '0';
        const lostToFollowUpPct = allPatients.length > 0 
            ? Math.round((patientsLostToFollowUp / allPatients.length) * 100) : 0;
        
        // Color helpers
        const getSeizureColor = (rate) => rate >= 60 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444';
        const getAdherenceColor = (rate) => rate >= 70 ? '#10b981' : rate >= 50 ? '#f59e0b' : '#ef4444';
        const getLostColor = (pct) => pct <= 20 ? '#10b981' : pct <= 40 ? '#f59e0b' : '#ef4444';

        // Create summary HTML with actionable insights
        const summaryHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px;">
                <div style="padding: 14px; background: white; border-radius: 8px; border-left: 4px solid #3b82f6; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                    <div style="font-weight: 700; color: #3b82f6; font-size: 1.5em;">${allPatients.length}</div>
                    <div style="font-size: 0.8em; color: #666;">Total Active Patients</div>
                </div>
                
                <div style="padding: 14px; background: white; border-radius: 8px; border-left: 4px solid ${getSeizureColor(seizureControlRate)}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                    <div style="font-weight: 700; color: ${getSeizureColor(seizureControlRate)}; font-size: 1.5em;">${seizureControlRate}%</div>
                    <div style="font-size: 0.8em; color: #666;">Seizure Free Rate</div>
                    <div style="font-size: 0.75em; color: #999;">${seizureFreeFollowUps} of ${totalFollowUpsWithSeizureData} follow-ups</div>
                </div>
                
                <div style="padding: 14px; background: white; border-radius: 8px; border-left: 4px solid ${getAdherenceColor(adherenceRate)}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                    <div style="font-weight: 700; color: ${getAdherenceColor(adherenceRate)}; font-size: 1.5em;">${adherenceRate}%</div>
                    <div style="font-size: 0.8em; color: #666;">Good Adherence Rate</div>
                    <div style="font-size: 0.75em; color: #999;">${goodAdherenceCount} of ${totalAdherenceRecords} records</div>
                </div>
                
                <div style="padding: 14px; background: white; border-radius: 8px; border-left: 4px solid #8b5cf6; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                    <div style="font-weight: 700; color: #8b5cf6; font-size: 1.5em;">${recentFollowUps}</div>
                    <div style="font-size: 0.8em; color: #666;">Follow-ups (6 months)</div>
                    <div style="font-size: 0.75em; color: #999;">${totalFollowUps} total records</div>
                </div>
                
                <div style="padding: 14px; background: white; border-radius: 8px; border-left: 4px solid ${getLostColor(lostToFollowUpPct)}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                    <div style="font-weight: 700; color: ${getLostColor(lostToFollowUpPct)}; font-size: 1.5em;">${patientsLostToFollowUp}</div>
                    <div style="font-size: 0.8em; color: #666;">Lost to Follow-up</div>
                    <div style="font-size: 0.75em; color: #999;">${lostToFollowUpPct}% — no visit in 3 months</div>
                </div>
                
                <div style="padding: 14px; background: white; border-radius: 8px; border-left: 4px solid #06b6d4; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                    <div style="font-weight: 700; color: #06b6d4; font-size: 1.5em;">${avgSeizures}</div>
                    <div style="font-size: 0.8em; color: #666;">Avg Seizures/Visit</div>
                    <div style="font-size: 0.75em; color: #999;">${frequentSeizureFollowUps} frequent (6+)</div>
                </div>
            </div>
            
            ${stoppedMedsCount > 0 ? `
            <div style="padding: 10px 14px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b; margin-bottom: 8px; font-size: 0.85em;">
                <strong style="color: #92400e;">Action Required:</strong> <span style="color: #78350f;">${stoppedMedsCount} patient(s) have stopped medicines — use "Patients Who Stopped Medicines" report below for detailed list.</span>
            </div>` : ''}
            
            ${lostToFollowUpPct > 30 ? `
            <div style="padding: 10px 14px; background: #fee2e2; border-radius: 6px; border-left: 4px solid #ef4444; margin-bottom: 8px; font-size: 0.85em;">
                <strong style="color: #991b1b;">Alert:</strong> <span style="color: #7f1d1d;">${lostToFollowUpPct}% of patients have not been followed up in 3 months. Consider targeted outreach.</span>
            </div>` : ''}
            
            ${frequentSeizureFollowUps > 0 ? `
            <div style="padding: 10px 14px; background: #ede9fe; border-radius: 6px; border-left: 4px solid #8b5cf6; margin-bottom: 8px; font-size: 0.85em;">
                <strong style="color: #5b21b6;">Clinical Note:</strong> <span style="color: #4c1d95;">${frequentSeizureFollowUps} follow-ups recorded frequent seizures (6+). Review dosage adequacy for these patients.</span>
            </div>` : ''}
        `;

        summaryElement.innerHTML = summaryHTML;
    } catch (error) {
        window.Logger.error('Error rendering analytics summary:', error);
        const summaryElement = document.getElementById('analyticsSummary');
        if (summaryElement) {
            summaryElement.innerHTML = '<div style="color: #666;">Unable to load summary statistics</div>';
        }
    }
}

/**
 * Show loading state
 */
function showLoadingState() {
    const charts = ['seizureFrequencyChart', 'medicationAdherenceChart', 'referralAnalyticsChart', 'patientOutcomesChart', 'patientStatusAnalyticsChart', 'ageDistributionChart', 'ageOfOnsetDistributionChart'];
    
    charts.forEach(chartId => {
        const container = document.getElementById(chartId);
        if (container && container.parentElement) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'analytics-loading';
            loadingDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${EpicareI18n.translate('analytics.loading')}`;
            loadingDiv.style.cssText = 'text-align: center; padding: 2rem; color: #666;';
            
            container.style.display = 'none';
            container.parentElement.appendChild(loadingDiv);
        }
    });
}

/**
 * Hide loading state
 */
function hideLoadingState() {
    const loadingElements = document.querySelectorAll('.analytics-loading');
    loadingElements.forEach(el => el.remove());
    
    // We do not force display:block here anymore. 
    // The render functions are responsible for showing the canvas if data exists.
}

/**
 * Export chart as image
 */
function exportChartAsImage(chartId, filename) {
    const chart = chartInstances[chartId];
    if (chart) {
        const url = chart.toBase64Image();
        const link = document.createElement('a');
        link.download = filename + '.png';
        link.href = url;
        link.click();
    }
}

/**
 * Export analytics data as CSV
 */
async function exportAnalyticsCSV() {
    try {
        showLoadingState();
        
        const allPatients = getActivePatients();
        const followUps = window.followUpsData || window.allFollowUps || [];
        const now = new Date();
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
        
        // Build analytics from follow-up data (using numeric seizure counts)
        let recentFollowUps = 0;
        let seizureFreeCount = 0;
        let rareCount = 0;       // 1-2
        let occasionalCount = 0;  // 3-5
        let frequentCount = 0;    // 6-10
        let veryFrequentCount = 0; // >10
        let goodAdherence = 0;
        let poorAdherence = 0;
        let stoppedMeds = 0;
        let unknownAdherence = 0;
        let totalWithSeizureData = 0;
        
        followUps.forEach(fu => {
            const fuDate = new Date(fu.FollowUpDate || fu.DateOfFollowUp || fu.SubmissionDate || fu.followUpDate || '');
            if (!isNaN(fuDate.getTime()) && fuDate >= sixMonthsAgo) {
                recentFollowUps++;
            }
            
            const seizureCount = parseInt(fu.SeizureFrequency, 10);
            if (!isNaN(seizureCount)) {
                totalWithSeizureData++;
                if (seizureCount === 0) seizureFreeCount++;
                else if (seizureCount <= 2) rareCount++;
                else if (seizureCount <= 5) occasionalCount++;
                else if (seizureCount <= 10) frequentCount++;
                else veryFrequentCount++;
            }
            
            const adherence = (fu.TreatmentAdherence || '').toLowerCase();
            if (adherence.includes('always')) {
                goodAdherence++;
            } else if (adherence.includes('occasionally miss')) {
                goodAdherence++;
            } else if (adherence.includes('frequently miss')) {
                poorAdherence++;
            } else if (adherence.includes('stopped')) {
                stoppedMeds++;
            } else if (adherence) {
                unknownAdherence++;
            }
        });
        
        // Build analytics summary data
        const rows = [];
        rows.push(['EpiCare Analytics Export', new Date().toLocaleString()]);
        rows.push([]);
        rows.push(['SUMMARY STATISTICS']);
        rows.push(['Metric', 'Value']);
        rows.push(['Total Active Patients', allPatients.length]);
        rows.push(['Total Follow-ups', followUps.length]);
        rows.push(['Recent Follow-ups (6 months)', recentFollowUps]);
        
        // Seizure control from follow-up data
        rows.push([]);
        rows.push(['SEIZURE CONTROL (from follow-up records)']);
        rows.push(['Category', 'Count', 'Percentage']);
        rows.push(['Seizure Free (0)', seizureFreeCount, totalWithSeizureData > 0 ? Math.round((seizureFreeCount/totalWithSeizureData)*100) + '%' : 'N/A']);
        rows.push(['Rare (1-2)', rareCount, totalWithSeizureData > 0 ? Math.round((rareCount/totalWithSeizureData)*100) + '%' : 'N/A']);
        rows.push(['Occasional (3-5)', occasionalCount, totalWithSeizureData > 0 ? Math.round((occasionalCount/totalWithSeizureData)*100) + '%' : 'N/A']);
        rows.push(['Frequent (6-10)', frequentCount, totalWithSeizureData > 0 ? Math.round((frequentCount/totalWithSeizureData)*100) + '%' : 'N/A']);
        rows.push(['Very Frequent (>10)', veryFrequentCount, totalWithSeizureData > 0 ? Math.round((veryFrequentCount/totalWithSeizureData)*100) + '%' : 'N/A']);
        
        // Medication adherence from follow-up data
        rows.push([]);
        rows.push(['MEDICATION ADHERENCE (from follow-up records)']);
        rows.push(['Good Adherence (Always take / Occasionally miss)', goodAdherence]);
        rows.push(['Poor Adherence (Frequently miss)', poorAdherence]);
        rows.push(['Completely Stopped Medicines', stoppedMeds]);
        rows.push(['Unknown/Other', unknownAdherence]);
        
        // Extract current filter values from UI
        const phcFilter = document.getElementById('advancedPhcFilter')?.value || 'All';
        const startDate = document.getElementById('analyticsStartDate')?.value || '';
        const endDate = document.getElementById('analyticsEndDate')?.value || '';
        
        rows.push([]);
        rows.push(['FILTERS APPLIED']);
        rows.push(['Facility', phcFilter]);
        rows.push(['Start Date', startDate]);
        rows.push(['End Date', endDate]);
        
        // Detailed patient list
        rows.push([]);
        rows.push(['PATIENT DETAILS']);
        rows.push(['Name', 'Patient ID', 'Phone', 'Facility', 'Age', 'Gender', 'Status', 'Last Follow-up']);
        
        allPatients.forEach(patient => {
            const lastFollowUp = patient.FollowUps && patient.FollowUps.length > 0 
                ? new Date(patient.FollowUps[patient.FollowUps.length - 1].DateOfFollowUp || patient.FollowUps[patient.FollowUps.length - 1].followUpDate || patient.FollowUps[patient.FollowUps.length - 1].FollowUpDate).toLocaleDateString()
                : 'Never';
            
            rows.push([
                patient.PatientName || patient.name || '',
                patient.PatientID || patient.ID || patient.uid || '',
                patient.Phone || patient.phone || patient.PhoneNumber || patient.MobileNumber || '',
                patient.PHC || patient.Facility || patient.facilityName || '',
                patient.Age || '',
                patient.Gender || patient.gender || '',
                patient.Status || 'Active',
                lastFollowUp
            ]);
        });
        
        hideLoadingState();
        
        // Convert to CSV format
        const csv = rows.map(row => 
            row.map(cell => {
                // Escape quotes and wrap in quotes if contains comma or quote
                const cellStr = String(cell || '');
                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return '"' + cellStr.replace(/"/g, '""') + '"';
                }
                return cellStr;
            }).join(',')
        ).join('\n');
        
        // Create blob and download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `epicare-analytics-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        window.Logger.info('Analytics CSV exported successfully');
        showNotification(window.EpicareI18n ? window.EpicareI18n.translate('analytics.csvExported') : 'Analytics exported as CSV', 'success');
        
    } catch (error) {
        window.Logger.error('Error exporting CSV:', error);
        hideLoadingState();
        showNotification(window.EpicareI18n ? window.EpicareI18n.translate('analytics.csvExportFailed') : 'Failed to export CSV: ' + error.message, 'error');
    }
}

// showNotification is now defined in utils.js and available globally
// Removed duplicate definition to avoid code duplication

// Export functions for global access
window.exportChartAsImage = exportChartAsImage;
window.exportAnalyticsCSV = exportAnalyticsCSV;

// Make functions globally available
window.initAdvancedAnalytics = initAdvancedAnalytics; 
window.loadAnalytics = loadAllAnalytics;
window.showLoadingState = showLoadingState;
window.hideLoadingState = hideLoadingState;
window.applyFilters = applyFilters;
window.destroyCharts = destroyCharts;

// Also export a function to apply filters (called from script.js)
function applyFilters() {
    loadAllAnalytics();
}

// Export function to destroy charts for cleanup
function destroyCharts() {
    Object.entries(chartInstances).forEach(([key, chart]) => {
        if (chart && typeof chart.destroy === 'function') {
            chart.destroy();
            // Remove Chart.js monitor elements for each chart
            let ctx = null;
            switch (key) {
                case 'seizureFrequency':
                    ctx = document.getElementById('seizureFrequencyChart');
                    break;
                case 'medicationAdherence':
                    ctx = document.getElementById('medicationAdherenceChart');
                    break;
                case 'referralAnalytics':
                    ctx = document.getElementById('referralAnalyticsChart');
                    break;
                case 'patientOutcomes':
                    ctx = document.getElementById('patientOutcomesChart');
                    break;
                case 'patientStatusAnalytics':
                    ctx = document.getElementById('patientStatusAnalyticsChart');
                    break;
                case 'ageDistribution':
                    ctx = document.getElementById('ageDistributionChart');
                    break;
                case 'ageOfOnsetDistribution':
                    ctx = document.getElementById('ageOfOnsetDistributionChart');
                    break;
            }
            if (ctx && ctx.parentElement) {
                ctx.parentElement.querySelectorAll('.chartjs-size-monitor, .chartjs-render-monitor').forEach(el => el.remove());
            }
        }
    });
    chartInstances = {};
}

/**
 * Render Follow-Up Status by Block Table
 */
function renderFollowUpStatusTable() {
    try {
        window.Logger.debug('Rendering Follow-Up Status Table...');
        
        const tbody = document.getElementById('followUpStatusTableBody');
        const dateRangeEl = document.getElementById('followUpTableDateRange');
        
        if (!tbody) {
            window.Logger.error('Follow-up status table body not found');
            return;
        }
        
        // Get patients and follow-ups data
        const rawPatients = window.allPatients || window.patientsData || [];
        const followUps = window.followUpsData || window.allFollowUps || [];
        
        if (!Array.isArray(rawPatients) || rawPatients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #999;">No patient data available</td></tr>';
            return;
        }
        
        // Filter out Draft, Inactive, and non-epilepsy patients (consistent with export functions)
        const NON_EPILEPSY = (typeof NON_EPILEPSY_DIAGNOSES !== 'undefined' && Array.isArray(NON_EPILEPSY_DIAGNOSES))
            ? NON_EPILEPSY_DIAGNOSES
            : ['fds', 'functional disorder', 'functional neurological disorder', 'uncertain', 'unknown', 'other', 'not epilepsy', 'non-epileptic', 'psychogenic', 'conversion disorder', 'anxiety', 'depression', 'syncope', 'vasovagal', 'cardiac', 'migraine', 'headache', 'behavioral', 'attention seeking', 'malingering'];
        
        let patients = rawPatients.filter(p => {
            const status = (p.PatientStatus || '').toString().trim();
            if (status === 'Draft' || status === 'Inactive') return false;
            if (NON_EPILEPSY.includes((p.Diagnosis || '').toString().trim().toLowerCase())) return false;
            return true;
        });
        
        // Apply PHC filter if set
        const phcFilter = currentFilters.phc;
        if (phcFilter && phcFilter !== 'All' && phcFilter !== '') {
            patients = patients.filter(p => {
                const pPhc = (p.PHC || p.phc || '').toString().trim().toLowerCase();
                return pPhc === phcFilter.toString().trim().toLowerCase();
            });
        }
        
        if (patients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #999;">No active epilepsy patients found for selected filters</td></tr>';
            return;
        }
        
        // Apply date filter if set
        let filteredFollowUps = followUps;
        let dateRangeText = '';
        
        // Helper: robust follow-up date parsing
        const parseFollowUpDate = (fu) => {
            const candidates = [fu.FollowUpDate, fu.followUpDate, fu.SubmissionDate, fu.submissionDate, fu.Date, fu.date, fu.Timestamp, fu.timestamp, fu.createdAt, fu.CreatedAt];
            for (const cand of candidates) {
                if (cand === null || cand === undefined) continue;
                // Numeric timestamp
                if (typeof cand === 'number' && !isNaN(cand)) {
                    const d = new Date(Number(cand));
                    if (!isNaN(d.getTime())) return d;
                }
                const s = String(cand).trim();
                if (/^\d+$/.test(s)) {
                    const d = new Date(Number(s));
                    if (!isNaN(d.getTime())) return d;
                }
                try {
                    const d = (typeof parseFlexibleDate === 'function') ? parseFlexibleDate(s) : new Date(s);
                    if (d && !isNaN(d.getTime())) return d;
                } catch (e) {
                    // ignore and try next
                }
            }
            return null;
        };

        if (currentFilters.startDate || currentFilters.endDate) {
            const startDate = currentFilters.startDate ? new Date(currentFilters.startDate) : null;
            const endDate = currentFilters.endDate ? new Date(currentFilters.endDate) : null;

            let parsedCount = 0, unparsedCount = 0;
            filteredFollowUps = followUps.filter(fu => {
                const d = parseFollowUpDate(fu);
                if (!d) { unparsedCount++; return false; }
                parsedCount++;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });

            const formatDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
            if (startDate && endDate) {
                dateRangeText = ` (${formatDate(startDate)} to ${formatDate(endDate)})`;
            } else if (startDate) {
                dateRangeText = ` (from ${formatDate(startDate)})`;
            } else if (endDate) {
                dateRangeText = ` (to ${formatDate(endDate)})`;
            }

            window.Logger.debug('[FollowUpTable] Date filter applied - parsed:', parsedCount, 'unparsed:', unparsedCount);
        } else {
            // Default to current month if no filter
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            let parsedCount = 0, unparsedCount = 0;
            filteredFollowUps = followUps.filter(fu => {
                const d = parseFollowUpDate(fu);
                if (!d) { unparsedCount++; return false; }
                parsedCount++;
                return d >= firstDay && d <= lastDay;
            });

            dateRangeText = ` (${firstDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${lastDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })})`;

            window.Logger.debug('[FollowUpTable] Default month filter - parsed:', parsedCount, 'unparsed:', unparsedCount);
        }

        if (dateRangeEl) {
            dateRangeEl.textContent = dateRangeText;
        }

        window.Logger.debug('[FollowUpTable] Total follow-ups before filtering:', followUps.length);
        window.Logger.debug('[FollowUpTable] Filtered follow-ups for date range:', filteredFollowUps.length);
        window.Logger.debug('[FollowUpTable] Sample filtered follow-up:', filteredFollowUps[0]);
        
        // Group patients by PHC/Block
        const blockStats = {};
        
        patients.forEach(patient => {
            const block = (patient.PHC || patient.phc || 'Unknown').trim();
            
            if (!blockStats[block]) {
                blockStats[block] = {
                    totalPatients: 0,
                    patientsWithFollowups: new Set()
                };
            }
            
            blockStats[block].totalPatients++;
        });
        
        // Count unique patients with at least one follow-up per block for the month
        const patientFollowupSet = {}; // { block: Set(patientId) }
        let matchedCount = 0; // Count follow-ups that were successfully matched to patients
        filteredFollowUps.forEach(fu => {
            const patientId = String(fu.PatientID || fu.patientId || fu.PatientId || '').trim();
            if (!patientId) {
                window.Logger.debug('[FollowUpTable] Follow-up missing PatientID:', fu);
                return;
            }
            // Find the patient's block - normalize patient IDs for comparison
            const patient = patients.find(p => {
                const pId = String(p.ID || p.Id || p.patientId || p.PatientID || '').trim();
                return pId === patientId;
            });
            if (!patient) {
                window.Logger.debug('[FollowUpTable] No patient found for follow-up PatientID:', patientId);
                return;
            }
            matchedCount++; // Increment matched count
            const block = (patient.PHC || patient.phc || 'Unknown').trim();
            if (!patientFollowupSet[block]) {
                patientFollowupSet[block] = new Set();
            }
            patientFollowupSet[block].add(patientId);
        });

        // Now update blockStats with unique patient follow-ups
        Object.keys(blockStats).forEach(block => {
            if (patientFollowupSet[block]) {
                blockStats[block].patientsWithFollowups = patientFollowupSet[block];
            } else {
                blockStats[block].patientsWithFollowups = new Set();
            }
        });
        
        window.Logger.debug('[FollowUpTable] Matched follow-ups to patients:', matchedCount, 'out of', filteredFollowUps.length);
        
        // Convert to array and calculate stats
        const blockData = Object.entries(blockStats).map(([block, stats]) => {
            const totalPatients = stats.totalPatients;
            const followupCount = stats.patientsWithFollowups.size;
            const percentage = totalPatients > 0 ? Math.round((followupCount / totalPatients) * 100) : 0;
            const gap = totalPatients - followupCount;
            
            return {
                block,
                totalPatients,
                followupCount,
                percentage,
                gap
            };
        });
        
        // Sort by percentage (descending)
        blockData.sort((a, b) => b.percentage - a.percentage);
        
        // Generate table rows with color-coded percentages
        const getPercentageColor = (pct) => {
            if (pct >= 70) return '#d4edda'; // Green
            if (pct >= 55) return '#d1ecf1'; // Light blue
            if (pct >= 47) return '#fff3cd'; // Yellow
            if (pct >= 35) return '#ffe5cc'; // Light orange
            if (pct >= 20) return '#f8d7da'; // Light red
            return '#f5c6cb'; // Red
        };
        
        let rows = '';
        let totalPatients = 0;
        let totalFollowups = 0;
        
        blockData.forEach((data, index) => {
            totalPatients += data.totalPatients;
            totalFollowups += data.followupCount;
            
            const bgColor = getPercentageColor(data.percentage);
            rows += `
                <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 10px 8px; text-align: left; border: 1px solid #ddd;">${index + 1}</td>
                    <td style="padding: 10px 8px; text-align: left; border: 1px solid #ddd; font-weight: 500;">${data.block}</td>
                    <td style="padding: 10px 8px; text-align: center; border: 1px solid #ddd;">${data.totalPatients}</td>
                    <td style="padding: 10px 8px; text-align: center; border: 1px solid #ddd;">${data.followupCount}</td>
                    <td style="padding: 10px 8px; text-align: center; border: 1px solid #ddd; background: ${bgColor}; font-weight: 600;">${data.percentage}</td>
                    <td style="padding: 10px 8px; text-align: center; border: 1px solid #ddd;">${data.gap}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = rows || '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #999;">No data available for selected period</td></tr>';
        
        // Update totals
        const totalPercentage = totalPatients > 0 ? Math.round((totalFollowups / totalPatients) * 100) : 0;
        const totalGap = totalPatients - totalFollowups;
        
        document.getElementById('followUpTotalPatients').textContent = totalPatients;
        document.getElementById('followUpTotalFollowups').textContent = totalFollowups;
        document.getElementById('followUpTotalPercentage').textContent = totalPercentage;
        document.getElementById('followUpTotalGap').textContent = totalGap;
        
        window.Logger.debug('Follow-Up Status Table rendered successfully');
    } catch (error) {
        window.Logger.error('Error rendering follow-up status table:', error);
        const tbody = document.getElementById('followUpStatusTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: #dc3545;">Error loading data</td></tr>';
        }
    }
}

/**
 * Export Follow-Up Status Table as CSV
 */
function exportFollowUpStatusTableCSV() {
    try {
        const table = document.getElementById('followUpStatusTable');
        const dateRange = document.getElementById('followUpTableDateRange')?.textContent || '';
        
        if (!table) {
            showNotification('Table not found', 'error');
            return;
        }
        
        let csv = `Epilepsy Patient Follow-Up Status by Block${dateRange}\n\n`;
        
        // Headers
        const headers = ['Rank', 'Name of Block', 'No. of Patients', 'No. of Follow-ups', '%', 'Gap'];
        csv += headers.join(',') + '\n';
        
        // Data rows
        const tbody = table.querySelector('tbody');
        const rows = tbody.querySelectorAll('tr');
        
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length === 6) {
                const rowData = Array.from(cells).map(cell => {
                    const text = cell.textContent.trim();
                    return text.includes(',') ? `"${text}"` : text;
                });
                csv += rowData.join(',') + '\n';
            }
        });
        
        // Totals
        const tfoot = table.querySelector('tfoot');
        if (tfoot) {
            const totalRow = tfoot.querySelector('tr');
            const totalCells = totalRow.querySelectorAll('td');
            if (totalCells.length >= 4) {
                csv += '\nTotal,';
                csv += totalCells[1].textContent.trim() + ',';
                csv += totalCells[2].textContent.trim() + ',';
                csv += totalCells[3].textContent.trim() + ',';
                csv += totalCells[4].textContent.trim() + '\n';
            }
        }
        
        // Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        const now = new Date();
        const filename = `follow-up-status-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showNotification('Table exported successfully', 'success');
    } catch (error) {
        window.Logger.error('Error exporting follow-up status table:', error);
        showNotification('Failed to export table', 'error');
    }
}

// Export functions
window.renderFollowUpStatusTable = renderFollowUpStatusTable;
window.exportFollowUpStatusTableCSV = exportFollowUpStatusTableCSV;