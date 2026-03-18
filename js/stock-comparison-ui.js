/**
 * Stock Comparison UI Module
 * Renders modern, comprehensive stock comparison dashboard
 * Dependencies: StockComparison module
 */

const StockComparisonUI = (() => {
    /**
     * Render the main stock comparison dashboard
     * @param {string} containerId - ID of the container element
     * @param {string} phcName - Name of the PHC
     * @param {string} [aamCenter] - Optional AAM center name for center-level view
     */
    async function renderDashboard(containerId, phcName, aamCenter) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }

        // Check if patient data is available
        if (!window.patientData || !Array.isArray(window.patientData) || window.patientData.length === 0) {
            container.innerHTML = `
                <div style="padding: 30px; background: #fef5e7; border-left: 4px solid #f39c12; border-radius: 6px;">
                    <i class="fas fa-info-circle" style="color: #f39c12; margin-right: 8px;"></i>
                    <strong>Data Not Ready</strong>
                    <p style="margin: 8px 0 0 0; color: #666; font-size: 0.9rem;">
                        Waiting for patient data to load. Please try again in a moment.
                    </p>
                </div>
            `;
            return;
        }

        // Show loading state
        container.innerHTML = `
            <div style="padding: 40px; text-align: center;">
                <div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid var(--primary-color); 
                     border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                <p style="margin-top: 12px; color: #666;">Loading stock comparison data...</p>
            </div>
        `;

        try {
            // Generate report (passing aamCenter for center-level stock)
            const report = await StockComparison.generateStockReport(phcName, aamCenter || '');

            if (!report.success) {
                container.innerHTML = `
                    <div style="padding: 30px; background: #fef5e7; border-left: 4px solid #f39c12; border-radius: 6px;">
                        <i class="fas fa-info-circle" style="color: #f39c12; margin-right: 8px;"></i>
                        <strong>No Data Available</strong>
                        <p style="margin: 8px 0 0 0; color: #666; font-size: 0.9rem;">
                            ${report.error || 'No patient or stock data found for this facility.'}
                        </p>
                    </div>
                `;
                return;
            }

            // Render full dashboard
            const summary = StockComparison.calculateSummaryStats(report.items);
            const html = renderDashboardHTML(report, summary);
            container.innerHTML = html;

            // Initialize event listeners (pass aamCenter for refresh)
            initializeDashboardEvents(report, summary, aamCenter);

        } catch (error) {
            console.error('Error rendering dashboard:', error);
            container.innerHTML = `
                <div style="padding: 30px; background: #fadbd8; border-left: 4px solid #e74c3c; border-radius: 6px;">
                    <i class="fas fa-exclamation-circle" style="color: #e74c3c; margin-right: 8px;"></i>
                    <strong>Error Loading Data</strong>
                    <p style="margin: 8px 0 0 0; color: #666; font-size: 0.9rem;">${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Generate HTML for the entire dashboard
     */
    function renderDashboardHTML(report, summary) {
        // Build level indicator showing Facility or AAM Center
        const aamLabel = report.aamCenter
            ? `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:12px; background:#d5f4e6; color:#117a65; font-size:12px; font-weight:600;">
                   <i class="fas fa-house-medical"></i> ${report.aamCenter}
               </span>`
            : `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:12px; background:#d6eaf8; color:#1a5276; font-size:12px; font-weight:600;">
                   <i class="fas fa-clinic-medical"></i> Facility Level
               </span>`;
        return `
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                .stock-dashboard {
                    display: grid;
                    gap: 20px;
                }

                .stat-card {
                    background: white;
                    border-radius: 12px;
                    padding: 16px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                    border-left: 4px solid #3498db;
                    transition: all 0.3s ease;
                }

                .stat-card:hover {
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    transform: translateY(-2px);
                }

                .stat-card.critical {
                    border-left-color: #e74c3c;
                    background: linear-gradient(135deg, rgba(231, 76, 60, 0.05), ffffff);
                }

                .stat-card.low {
                    border-left-color: #f39c12;
                    background: linear-gradient(135deg, rgba(243, 156, 18, 0.05), ffffff);
                }

                .stat-card.adequate {
                    border-left-color: #27ae60;
                    background: linear-gradient(135deg, rgba(39, 174, 96, 0.05), ffffff);
                }

                .stat-value {
                    font-size: 28px;
                    font-weight: 700;
                    margin: 8px 0;
                    color: #222;
                }

                .stat-label {
                    font-size: 13px;
                    color: #7f8c8d;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .stat-subtitle {
                    font-size: 12px;
                    color: #95a5a6;
                    margin-top: 4px;
                }

                .stat-icon {
                    font-size: 24px;
                    float: right;
                    opacity: 0.15;
                }

                .medicine-list-section {
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                }

                .medicine-list-header {
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 16px;
                    color: #222;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .medicine-item {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr auto;
                    gap: 12px;
                    padding: 12px;
                    border-bottom: 1px solid #ecf0f1;
                    align-items: center;
                    transition: background 0.2s ease;
                }

                .medicine-item:hover {
                    background: #f8f9fa;
                }

                .medicine-item:last-child {
                    border-bottom: none;
                }

                .medicine-name {
                    font-weight: 500;
                    color: #222;
                }

                .stock-info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .stock-label {
                    font-size: 12px;
                    color: #95a5a6;
                    font-weight: 500;
                }

                .stock-value {
                    font-size: 14px;
                    font-weight: 600;
                    color: #222;
                }

                .comparison-bar {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                    height: 24px;
                }

                .bar-current {
                    height: 100%;
                    background: linear-gradient(135deg, #3498db, #2980b9);
                    border-radius: 4px;
                    min-width: 2px;
                    transition: width 0.3s ease;
                    position: relative;
                }

                .bar-needed {
                    height: 100%;
                    background: linear-gradient(135deg, #e0e0e0, #bdc3c7);
                    border-radius: 4px;
                    flex: 1;
                }

                .status-badge {
                    padding: 6px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }

                .status-badge.critical {
                    background: #fadbd8;
                    color: #c0392b;
                }

                .status-badge.low {
                    background: #fdecd1;
                    color: #d68910;
                }

                .status-badge.acceptable {
                    background: #d6eaf8;
                    color: #1a5276;
                }

                .status-badge.adequate {
                    background: #d5f4e6;
                    color: #117a65;
                }

                .status-badge.excess {
                    background: #d1f2eb;
                    color: #0e6251;
                }

                .status-badge.no-demand {
                    background: #ecf0f1;
                    color: #7f8c8d;
                }

                .coverage-indicator {
                    font-size: 12px;
                    font-weight: 600;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: #ecf0f1;
                    color: #2c3e50;
                }

                .filter-tabs {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                    flex-wrap: wrap;
                }

                .filter-btn {
                    padding: 6px 12px;
                    border: 2px solid #e0e0e0;
                    background: white;
                    border-radius: 20px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    transition: all 0.2s ease;
                    color: #2c3e50;
                }

                .filter-btn:hover {
                    border-color: #3498db;
                    color: #3498db;
                }

                .filter-btn.active {
                    background: #3498db;
                    color: white;
                    border-color: #3498db;
                }

                .summary-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .list-container {
                    max-height: 600px;
                    overflow-y: auto;
                }

                .empty-state {
                    padding: 30px;
                    text-align: center;
                    color: #95a5a6;
                }

                .empty-state-icon {
                    font-size: 48px;
                    opacity: 0.3;
                    margin-bottom: 12px;
                }
            </style>

            <div class="stock-dashboard">
                <!-- Summary Statistics -->
                <div class="summary-grid">
                    ${renderSummaryCards(report, summary)}
                </div>

                <!-- Filter and List -->
                <div class="medicine-list-section">
                    <div class="medicine-list-header">
                        <i class="fas fa-pills" style="color: #3498db;"></i>
                        Stock Comparison Details (${report.items.length} medicines)
                        ${aamLabel}
                    </div>

                    <div class="filter-tabs" id="filterTabs">
                        <button class="filter-btn active" data-filter="all">All (${report.items.length})</button>
                        ${report.summary.criticalCount > 0 ? `<button class="filter-btn" data-filter="critical"><i class="fas fa-exclamation-circle" style="margin-right: 4px;"></i>Critical (${report.summary.criticalCount})</button>` : ''}
                        ${report.summary.lowCount > 0 ? `<button class="filter-btn" data-filter="low"><i class="fas fa-warning" style="margin-right: 4px;"></i>Low (${report.summary.lowCount})</button>` : ''}
                        ${report.summary.acceptableCount > 0 ? `<button class="filter-btn" data-filter="acceptable"><i class="fas fa-check-circle" style="margin-right: 4px;"></i>Acceptable (${report.summary.acceptableCount})</button>` : ''}
                        ${report.summary.adequateCount > 0 ? `<button class="filter-btn" data-filter="adequate"><i class="fas fa-thumbs-up" style="margin-right: 4px;"></i>Adequate (${report.summary.adequateCount})</button>` : ''}
                    </div>

                    <div class="list-container" id="medicineList">
                        ${renderMedicineList(report.items, 'all')}
                    </div>
                </div>

                <!-- Information Footer -->
                <div style="padding: 12px 16px; background: #f8f9fa; border-radius: 8px; font-size: 12px; color: #7f8c8d; border-left: 3px solid #3498db;">
                    <i class="fas fa-info-circle" style="margin-right: 6px;"></i>
                    <strong>Calculation Basis:</strong> Monthly requirement = Active patients on medication × 2 doses/day × 30 days. Coverage months = Current Stock ÷ Monthly Needed.
                </div>
            </div>
        `;
    }

    /**
     * Render summary stat cards
     */
    function renderSummaryCards(report, summary) {
        const cards = [
            {
                icon: 'box',
                label: 'Total Medicines',
                value: summary.totalItems,
                subtitle: `${report.patientCount} active patients`,
                color: '#3498db'
            },
            {
                icon: 'exclamation-triangle',
                label: 'Average Coverage',
                value: `${summary.averageCoverageMonths} mo`,
                subtitle: 'Stock duration',
                color: '#f39c12'
            },
            {
                icon: 'alert-circle',
                label: 'Stockout Risk',
                value: summary.estimatedStockoutRisk,
                subtitle: summary.criticalPercentage + '% critical',
                color: summary.estimatedStockoutRisk === 'Low' ? '#27ae60' : 
                       summary.estimatedStockoutRisk === 'Moderate' ? '#f39c12' : '#e74c3c'
            }
        ];

        return cards.map(card => `
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-${card.icon}"></i></div>
                <div class="stat-label">${card.label}</div>
                <div class="stat-value" style="color: ${card.color};">${card.value}</div>
                <div class="stat-subtitle">${card.subtitle}</div>
            </div>
        `).join('');
    }

    /**
     * Render medicine list items
     */
    function renderMedicineList(items, filter) {
        const filtered = filter === 'all' 
            ? items 
            : items.filter(i => i.status === filter);

        if (filtered.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-pills"></i></div>
                    <p>No medicines in this category</p>
                </div>
            `;
        }

        return filtered.map(item => renderMedicineItem(item)).join('');
    }

    /**
     * Render single medicine item
     */
    function renderMedicineItem(item) {
        const currentPercentage = item.monthly_needed > 0 
            ? Math.min((item.current_stock / item.monthly_needed) * 100, 100)
            : 100;

        const statusIcon = {
            critical: '⚠️',
            low: '⚡',
            acceptable: '✓',
            adequate: '✓✓',
            excess: '⭐',
            'no-demand': '○'
        }[item.status] || '•';

        return `
            <div class="medicine-item">
                <div class="medicine-name">${item.medicine}</div>
                <div class="stock-info">
                    <span class="stock-label">Current</span>
                    <span class="stock-value">${item.current_stock.toLocaleString()} units</span>
                </div>
                <div class="stock-info">
                    <span class="stock-label">Monthly Need</span>
                    <span class="stock-value">${item.monthly_needed.toLocaleString()} units</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span class="status-badge ${item.status}">
                            ${statusIcon} ${item.label}
                        </span>
                        ${item.coverage_months !== null ? `<span class="coverage-indicator">${item.coverage_months}mo</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Initialize event listeners
     */
    function initializeDashboardEvents(report, summary, aamCenter) {
        const filterBtns = document.querySelectorAll('#filterTabs .filter-btn');
        
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Update active state
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.closest('.filter-btn').classList.add('active');

                // Update list
                const filter = e.target.closest('.filter-btn').dataset.filter;
                const listContainer = document.getElementById('medicineList');
                listContainer.innerHTML = renderMedicineList(report.items, filter);
            });
        });

        // Add refresh button listener
        const refreshBtn = document.getElementById('refreshStockComparisonBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const phcName = report.phcName || window.currentUserPHC || 'All';
                refresh('stockComparisonDashboard', phcName, aamCenter || '');
            });
        }
    }

    /**
     * Refresh the dashboard
     */
    async function refresh(containerId, phcName, aamCenter) {
        await renderDashboard(containerId, phcName, aamCenter || '');
    }

    // Public API
    return {
        renderDashboard,
        refresh
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StockComparisonUI;
}
