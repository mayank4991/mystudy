/**
 * Stock Comparison Module
 * Handles comparison of current stock vs. needed stock based on procurement forecast
 * Dependencies: None (uses global window.patientData)
 */

const StockComparison = (() => {
    // Private variables
    const CRITICAL_THRESHOLD = 0.25;  // 25% - critical stock level
    const LOW_THRESHOLD = 0.50;        // 50% - low stock level
    const ADEQUATE_THRESHOLD = 0.80;   // 80% - adequate stock level
    const EXCESS_THRESHOLD = Infinity; // Everything above adequate

    /**
     * Calculate forecasted monthly tablet requirement for a specific medication
     * @param {Array<Object>} patients - Array of patient objects
     * @param {string} medicationName - Name of the medication
     * @returns {number} Total tablets needed per month
     */
    function calculateMonthlyRequirement(patients, medicationName) {
        let totalMonthly = 0;

        patients.forEach(patient => {
            if (!Array.isArray(patient.Medications)) return;

            patient.Medications.forEach(med => {
                if (!med || !med.name) return;

                const medName = med.name.split('(')[0].trim();
                if (medName.toLowerCase() === medicationName.toLowerCase()) {
                    // 2 doses per day, 30 days per month
                    totalMonthly += 2 * 30;
                }
            });
        });

        return totalMonthly;
    }

    /**
     * Get all patients for a specific PHC
     * @param {string} phcName - Name of the PHC (or 'All' for all PHCs)
     * @returns {Array<Object>} Filtered patient array
     */
    function getPatientsByPHC(phcName) {
        if (!window.patientData || !Array.isArray(window.patientData)) {
            console.error('Patient data not available');
            return [];
        }

        if (!phcName || phcName === 'All') {
            // Return all active patients
            return window.patientData.filter(p => {
                const isActive = !p.PatientStatus ||
                    (p.PatientStatus && p.PatientStatus.toLowerCase() !== 'inactive');
                return isActive;
            });
        }

        // Filter by specific PHC
        return window.patientData.filter(p => {
            const phcMatch = p.PHC && p.PHC.trim().toLowerCase() === phcName.trim().toLowerCase();
            const isActive = !p.PatientStatus ||
                (p.PatientStatus && p.PatientStatus.toLowerCase() !== 'inactive');
            return phcMatch && isActive;
        });
    }

    /**
     * Get all unique active medications across patients
     * @param {Array<Object>} patients - Array of patient objects
     * @returns {Array<string>} Sorted array of medication names
     */
    function getActiveMedications(patients) {
        const medSet = new Set();

        patients.forEach(patient => {
            if (!Array.isArray(patient.Medications)) return;

            patient.Medications.forEach(med => {
                if (med && med.name) {
                    const medName = med.name.split('(')[0].trim();
                    medSet.add(medName);
                }
            });
        });

        return Array.from(medSet).sort();
    }

    /**
     * Determine stock status based on current vs needed
     * @param {number} currentStock - Current stock quantity
     * @param {number} monthlyNeeded - Monthly requirement
     * @returns {Object} Status object with status, color, and details
     */
    function getStockStatus(currentStock, monthlyNeeded) {
        if (monthlyNeeded === 0) {
            return {
                status: 'no-demand',
                label: 'No Demand',
                color: '#95a5a6',
                bgColor: '#ecf0f1',
                severity: 0,
                coverage_months: null,
                percentage: null
            };
        }

        // Calculate months of stock coverage
        const coverageMonths = currentStock / monthlyNeeded;
        const percentage = Math.min((currentStock / monthlyNeeded) * 100, 100);

        let status, label, color, bgColor, severity;

        if (coverageMonths >= 3) {
            // Excessive stock (3+ months)
            status = 'excess';
            label = 'Excess Stock';
            color = '#27ae60';
            bgColor = '#d5f4e6';
            severity = 5;
        } else if (coverageMonths >= 2) {
            // Good stock (2-3 months)
            status = 'adequate';
            label = 'Adequate';
            color = '#16a085';
            bgColor = '#dceef0';
            severity = 4;
        } else if (coverageMonths >= 1) {
            // Acceptable stock (1-2 months)
            status = 'acceptable';
            label = 'Acceptable';
            color = '#2980b9';
            bgColor = '#d6eaf8';
            severity = 3;
        } else if (coverageMonths >= 0.5) {
            // Low stock (0.5-1 month)
            status = 'low';
            label = 'Low Stock';
            color = '#f39c12';
            bgColor = '#fdecd1';
            severity = 2;
        } else {
            // Critical stock (less than 0.5 month)
            status = 'critical';
            label = 'Critical';
            color = '#e74c3c';
            bgColor = '#fadbd8';
            severity = 1;
        }

        return {
            status,
            label,
            color,
            bgColor,
            severity,
            coverage_months: Math.round(coverageMonths * 10) / 10,
            percentage: Math.round(percentage)
        };
    }

    /**
     * Fetch current stock levels for a PHC from backend
     * @param {string} phcName - Name of the PHC
     * @param {string} [aamCenter] - Optional AAM center name for center-level stock
     * @returns {Promise<Object>} Map of medication to current stock quantity
     */
    async function fetchCurrentStock(phcName, aamCenter) {
        try {
            let url = `${API_CONFIG.MAIN_SCRIPT_URL}?action=getPHCStock&phcName=${encodeURIComponent(phcName)}`;
            if (aamCenter) {
                url += `&aamCenter=${encodeURIComponent(aamCenter)}`;
            }
            const response = await fetch(url);
            const result = await response.json();

            if (result.status === 'success' && Array.isArray(result.data)) {
                const stockMap = {};
                result.data.forEach(item => {
                    if (item.Medicine) {
                        stockMap[item.Medicine] = item.CurrentStock || 0;
                    }
                });
                return stockMap;
            }

            return {};
        } catch (error) {
            console.error('Error fetching current stock:', error);
            return {};
        }
    }

    /**
     * Generate comprehensive stock comparison report
     * @param {string} phcName - Name of the PHC
     * @param {string} [aamCenter] - Optional AAM center name for center-level stock
     * @returns {Promise<Object>} Comprehensive stock report
     */
    async function generateStockReport(phcName, aamCenter) {
        try {
            // Get patients
            const patients = getPatientsByPHC(phcName);
            
            if (!patients || patients.length === 0) {
                return {
                    success: false,
                    error: 'No patient data available',
                    phcName,
                    aamCenter: aamCenter || '',
                    items: [],
                    summary: {
                        totalMedicines: 0,
                        criticalCount: 0,
                        lowCount: 0,
                        acceptableCount: 0,
                        adequateCount: 0,
                        excessCount: 0
                    }
                };
            }

            // Get current stock (facility-level or AAM center-level)
            const currentStock = await fetchCurrentStock(phcName, aamCenter);

            // Get active medications
            const activeMeds = getActiveMedications(patients);

            // Calculate comparison for each medicine
            const items = [];
            const summary = {
                totalMedicines: activeMeds.length,
                criticalCount: 0,
                lowCount: 0,
                acceptableCount: 0,
                adequateCount: 0,
                excessCount: 0,
                noDemandCount: 0
            };

            activeMeds.forEach(med => {
                const monthlyNeeded = calculateMonthlyRequirement(patients, med);
                const current = currentStock[med] || 0;
                const stockStatus = getStockStatus(current, monthlyNeeded);

                const item = {
                    medicine: med,
                    current_stock: current,
                    monthly_needed: monthlyNeeded,
                    ...stockStatus
                };

                items.push(item);

                // Update summary counts
                if (stockStatus.status === 'critical') summary.criticalCount++;
                else if (stockStatus.status === 'low') summary.lowCount++;
                else if (stockStatus.status === 'acceptable') summary.acceptableCount++;
                else if (stockStatus.status === 'adequate') summary.adequateCount++;
                else if (stockStatus.status === 'excess') summary.excessCount++;
                else if (stockStatus.status === 'no-demand') summary.noDemandCount++;
            });

            // Sort by severity descending (critical first)
            items.sort((a, b) => b.severity - a.severity);

            return {
                success: true,
                phcName,
                aamCenter: aamCenter || '',
                items,
                summary,
                generatedAt: new Date().toISOString(),
                patientCount: patients.length
            };
        } catch (error) {
            console.error('Error generating stock report:', error);
            return {
                success: false,
                error: error.message,
                phcName,
                aamCenter: aamCenter || '',
                items: [],
                summary: {}
            };
        }
    }

    /**
     * Get summary statistics across all medicines
     * @param {Array<Object>} items - Stock comparison items
     * @returns {Object} Summary statistics
     */
    function calculateSummaryStats(items) {
        if (!items || items.length === 0) {
            return {
                totalItems: 0,
                criticalPercentage: 0,
                lowPercentage: 0,
                averageCoverageMonths: 0,
                estimatedStockoutRisk: 'Low'
            };
        }

        const criticalCount = items.filter(i => i.status === 'critical').length;
        const lowCount = items.filter(i => i.status === 'low').length;
        const coverageMonths = items
            .filter(i => i.coverage_months !== null)
            .map(i => i.coverage_months);

        const avgCoverage = coverageMonths.length > 0
            ? coverageMonths.reduce((a, b) => a + b, 0) / coverageMonths.length
            : 0;

        let stockoutRisk = 'Low';
        if (criticalCount / items.length > 0.25) {
            stockoutRisk = 'Very High';
        } else if (criticalCount / items.length > 0.15) {
            stockoutRisk = 'High';
        } else if (lowCount / items.length > 0.25) {
            stockoutRisk = 'Moderate';
        }

        return {
            totalItems: items.length,
            criticalPercentage: Math.round((criticalCount / items.length) * 100),
            lowPercentage: Math.round((lowCount / items.length) * 100),
            averageCoverageMonths: Math.round(avgCoverage * 10) / 10,
            estimatedStockoutRisk: stockoutRisk
        };
    }

    /**
     * Get medicines sorted by stock status severity
     * @param {Array<Object>} items - Stock comparison items
     * @param {string} filterStatus - Optional: filter by specific status
     * @returns {Array<Object>} Filtered and sorted items
     */
    function getMedicinesByStatus(items, filterStatus = null) {
        let filtered = items;

        if (filterStatus) {
            filtered = items.filter(i => i.status === filterStatus);
        }

        return filtered.sort((a, b) => b.severity - a.severity);
    }

    // Public API
    return {
        generateStockReport,
        calculateSummaryStats,
        getMedicinesByStatus,
        getStockStatus,
        getPatientsByPHC,
        getActiveMedications,
        calculateMonthlyRequirement,
        fetchCurrentStock
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StockComparison;
}
