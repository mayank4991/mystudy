/**
 * Custom Reports Module
 * Provides 6 pre-configured report generators for public health professionals
 * Supports drill-down analytics and data export from generated lists
 */

class CustomReports {
  constructor() {
    this.currentReport = null;
    this.currentReportData = null;
    this.reportViewSettings = {
      itemsPerPage: 100,
      currentPage: 1,
      sortBy: 'name',
      sortAsc: true
    };
  }

  /**
   * Initialize custom reports UI
   */
  init() {
    this.setupReportButtons();
    this.setupReportViewHandlers();
  }

  /**
   * Setup quick report template buttons
   */
  setupReportButtons() {
    const reports = [
      {
        id: 'seizureFrequency',
        title: 'Patients by Seizure Frequency',
        description: 'Find patients with specific seizure patterns for targeted intervention',
        icon: '⚡'
      },
      {
        id: 'medicinesStopped',
        title: 'Patients Who Stopped Medicines',
        description: 'Identify patients with poor medication compliance for re-engagement',
        icon: '💊'
      },
      {
        id: 'choPerformance',
        title: 'CHOs by Patient Load & Performance',
        description: 'Rank health workers by caseload and performance metrics',
        icon: '👥'
      },
      {
        id: 'medicineSource',
        title: 'Private vs Government Medicine Use',
        description: 'Analyze medicine access patterns by facility and location',
        icon: '🏥'
      },
      {
        id: 'nonCompliant',
        title: 'Non-Compliant Patients',
        description: 'Find patients with poor adherence for intervention programs',
        icon: '⚠️'
      },
      {
        id: 'sideEffects',
        title: 'Patients with Side Effects',
        description: 'Monitor adverse effects and manage medication adjustments',
        icon: '🔔'
      },
      {
        id: 'procurementForecast',
        title: 'Medicine Procurement Forecast',
        description: 'Forecast medicine needs by facility and AAM center based on patient prescriptions vs current stock',
        icon: '📦'
      }
    ];

    const container = document.getElementById('quickReportsContainer');
    if (!container) return;

    let html = '<div class="quick-reports-grid">';
    reports.forEach(report => {
      html += `
        <div class="quick-report-card" data-report-id="${report.id}">
          <span class="report-icon">${report.icon}</span>
          <h4>${report.title}</h4>
          <p>${report.description}</p>
          <button class="btn-generate-report" data-report-id="${report.id}">Generate List</button>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;

    // Event listeners for report buttons
    container.querySelectorAll('.btn-generate-report').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reportId = e.target.dataset.reportId;
        this.generateReport(reportId);
      });
    });
  }

  /**
   * Generate a specific report
   */
  async generateReport(reportId) {
    // Show loading state
    this.showReportLoading(reportId);

    try {
      let reportData;

      switch (reportId) {
        case 'seizureFrequency':
          reportData = await this.generateSeizureFrequencyReport();
          break;
        case 'medicinesStopped':
          reportData = await this.generateMedicinesStoppedReport();
          break;
        case 'choPerformance':
          reportData = await this.generateCHOPerformanceReport();
          break;
        case 'medicineSource':
          reportData = await this.generateMedicineSourceReport();
          break;
        case 'nonCompliant':
          reportData = await this.generateNonCompliantReport();
          break;
        case 'sideEffects':
          reportData = await this.generateSideEffectsReport();
          break;
        case 'procurementForecast':
          reportData = await this.generateProcurementForecastReport();
          break;
        default:
          throw new Error(`Unknown report type: ${reportId}`);
      }

      this.displayReport(reportData);
    } catch (error) {
      if (window.Logger) window.Logger.error(`Error generating report ${reportId}:`, error);
      alert(`Error generating report: ${error.message}`);
    }
  }

  /**
   * Report 1: Patients by Seizure Frequency
   */
  async generateSeizureFrequencyReport() {
    const frequencies = ['Seizure Free', 'Rarely', 'Monthly', 'Weekly', 'Daily'];
    const selectedFrequency = prompt('Select seizure frequency to report on:\n\n' + 
      frequencies.map((f, i) => `${i+1}. ${f}`).join('\n'));

    if (!selectedFrequency) return null;

    const frequencyMap = { '1': 'Seizure Free', '2': 'Rarely', '3': 'Monthly', '4': 'Weekly', '5': 'Daily' };
    const frequency = frequencyMap[selectedFrequency];

    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getPatientsBySeizureFrequency',
          frequency: frequency,
          phcFilter: document.getElementById('advancedPhcFilter')?.value || 'All'
        })
      });

      const result = await response.json();
      return {
        id: 'seizureFrequency',
        title: `Patients with ${frequency} Seizures`,
        filters: `Seizure Frequency = "${frequency}"`,
        columns: ['PatientID', 'PatientName', 'Age', 'Gender', 'Phone', 'PHC', 'SeizureFrequency', 'LastFollowUp', 'CHOAssigned', 'CurrentMedicine'],
        data: result.data || [],
        summary: result.summary || {}
      };
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating seizure frequency report:', error);
      throw error;
    }
  }

  /**
   * Report 2: Patients Who Stopped Medicines
   */
  async generateMedicinesStoppedReport() {
    const daysOption = prompt('Check patients who stopped medicines:\n\n1. Last 30 days\n2. Last 90 days\n3. All time');
    if (!daysOption) return null;

    const daysMap = { '1': 30, '2': 90, '3': 999999 };
    const daysToCheck = daysMap[daysOption];

    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getPatientsMedicinesStopped',
          daysInactive: daysToCheck,
          phcFilter: document.getElementById('advancedPhcFilter')?.value || 'All'
        })
      });

      const result = await response.json();
      return {
        id: 'medicinesStopped',
        title: 'Patients Who Stopped Medicines',
        filters: `Adherence = "Completely Stopped" (Last ${daysToCheck === 999999 ? 'all' : daysToCheck} days)`,
        columns: ['PatientID', 'PatientName', 'Phone', 'Address', 'PHC', 'Age', 'Gender', 'LastFollowUp', 'CHOAssigned'],
        data: result.data || [],
        summary: result.summary || {}
      };
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating medicines stopped report:', error);
      throw error;
    }
  }

  /**
   * Report 3: CHOs by Patient Load & Performance
   * Enhanced with date range and metric filtering
   */
  async generateCHOPerformanceReport() {
    // Prompt for metric selection
    const metricOption = prompt('Rank CHOs by:\n\n1. Patient Load\n2. Seizure Control (%)\n3. Follow-Up Rate\n4. Adherence Rate (%)');
    if (!metricOption || !['1','2','3','4'].includes(metricOption)) return null;

    const metricMap = { '1': 'patientLoad', '2': 'seizureControl', '3': 'followUpRate', '4': 'adherenceRate' };
    const metricLabels = { '1': 'Patient Load', '2': 'Seizure Control', '3': 'Follow-Up Rate', '4': 'Adherence Rate' };
    const metric = metricMap[metricOption];

    // Get date range from user
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    
    const startDateInput = prompt('Enter start date (YYYY-MM-DD):', thirtyDaysAgo);
    if (!startDateInput) return null;
    
    const endDateInput = prompt('Enter end date (YYYY-MM-DD):', today);
    if (!endDateInput) return null;

    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getCHOPerformanceRanking',
          metric: metric,
          phcFilter: document.getElementById('advancedPhcFilter')?.value || 'All',
          dateRange: {
            startDate: startDateInput,
            endDate: endDateInput
          }
        })
      });

      const result = await response.json();
      
      if (result.status === 'error') {
        throw new Error(result.message || 'Failed to fetch CHO performance data');
      }

      return {
        id: 'choPerformance',
        title: `CHOs Ranked by ${metricLabels[metricOption]}`,
        filters: `Metric=${metric}, Date Range=${startDateInput} to ${endDateInput}, PHC=${document.getElementById('advancedPhcFilter')?.value || 'All'}`,
        columns: ['CHOName', 'PHC', 'PatientCount', 'TotalFollowUps', 'SeizureControlPercent', 'FollowUpRatePercent', 'AdherenceRatePercent', 'PerformanceTier', 'LastFollowUpDate'],
        data: result.data || [],
        summary: result.summary || {}
      };
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating CHO performance report:', error);
      throw error;
    }
  }

  /**
   * Report 4: Private vs Government Medicine Use
   */
  async generateMedicineSourceReport() {
    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getPrivateVsGovMedicineUsage',
          phcFilter: document.getElementById('advancedPhcFilter')?.value || 'All'
        })
      });

      const result = await response.json();
      return {
        id: 'medicineSource',
        title: 'Private vs Government Medicine Usage by PHC',
        filters: 'Aggregated by PHC location',
        columns: ['PHC', 'Location', 'PatientsOnPrivate', 'PatientsOnGovt', 'PatientsOnMixed', 'PercentPrivate', 'PercentGovt'],
        data: result.data || [],
        summary: result.summary || {}
      };
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating medicine source report:', error);
      throw error;
    }
  }

  /**
   * Report 5: Non-Compliant Patients
   */
  async generateNonCompliantReport() {
    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getNonCompliantPatients',
          phcFilter: document.getElementById('advancedPhcFilter')?.value || 'All'
        })
      });

      const result = await response.json();
      return {
        id: 'nonCompliant',
        title: 'Non-Compliant Patients (Poor Adherence)',
        filters: 'Adherence = "Frequently Miss" OR "Occasionally Miss" AND Last Follow-Up > 90 days',
        columns: ['PatientID', 'PatientName', 'Phone', 'PHC', 'CurrentAdherence', 'LastFollowUp', 'DaysSinceFollowUp', 'CHOAssigned', 'RiskLevel'],
        data: result.data || [],
        summary: result.summary || {}
      };
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating non-compliant report:', error);
      throw error;
    }
  }

  /**
   * Report 6: Patients with Side Effects
   */
  async generateSideEffectsReport() {
    const sideEffects = ['Tremor', 'Rash', 'Dizziness', 'Drowsiness', 'Nausea', 'Headache', 'Hair Loss', 'Weight Change', 'Behavioral', 'Other'];
    const selectedEffect = prompt('Select side effect to report on:\n\n' + 
      sideEffects.map((f, i) => `${i+1}. ${f}`).join('\n'));

    if (!selectedEffect) return null;

    const effectMap = Object.fromEntries(sideEffects.map((f, i) => [String(i+1), f]));
    const sideEffect = effectMap[selectedEffect];

    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getPatientsBySideEffect',
          sideEffect: sideEffect,
          phcFilter: document.getElementById('advancedPhcFilter')?.value || 'All'
        })
      });

      const result = await response.json();
      return {
        id: 'sideEffects',
        title: `Patients with ${sideEffect}`,
        filters: `Side Effects contains "${sideEffect}"`,
        columns: ['PatientID', 'PatientName', 'Phone', 'PHC', 'Age', 'SideEffect', 'CurrentMedicine', 'DateReported', 'ManagementPlan'],
        data: result.data || [],
        summary: result.summary || {}
      };
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating side effects report:', error);
      throw error;
    }
  }

  /**
   * Report 7: Medicine Procurement Forecast by Facility & AAM Center
   * Uses local patient data + StockComparison module to calculate needs
   */
  async generateProcurementForecastReport() {
    // Collect available facilities
    const allPatients = window.patientData || window.allPatients || [];
    if (!allPatients || allPatients.length === 0) {
      alert('No patient data available. Please refresh and try again.');
      return null;
    }

    // NON_EPILEPSY filter (same as rest of the codebase)
    const NON_EPILEPSY = (typeof NON_EPILEPSY_DIAGNOSES !== 'undefined' && Array.isArray(NON_EPILEPSY_DIAGNOSES))
      ? NON_EPILEPSY_DIAGNOSES
      : ['fds','functional disorder','functional neurological disorder','uncertain','unknown','other','not epilepsy','non-epileptic','psychogenic','conversion disorder','anxiety','depression','syncope','vasovagal','cardiac','migraine','headache','behavioral','attention seeking','malingering'];

    const activePatients = allPatients.filter(p => {
      const s = (p.PatientStatus || '').toString().trim();
      if (s === 'Draft' || s === 'Inactive') return false;
      if (NON_EPILEPSY.includes((p.Diagnosis || '').toString().trim().toLowerCase())) return false;
      return true;
    });

    // Build unique PHC list
    const phcSet = new Set();
    activePatients.forEach(p => {
      const phc = (p.PHC || '').trim();
      if (phc) phcSet.add(phc);
    });
    const phcList = Array.from(phcSet).sort();

    // Ask user for scope
    const scopeOpt = prompt(
      'Procurement forecast scope:\n\n' +
      '1. All Facilities (summary)\n' +
      '2. By Facility (one row per medicine per facility)\n' +
      '3. By AAM Center (one row per medicine per center)\n'
    );
    if (!scopeOpt || !['1','2','3'].includes(scopeOpt)) return null;

    const MEDICINES = window.MEDICINE_LIST || [];

    // Helper: parse medications from patient
    const getPatientMeds = (patient) => {
      let meds = patient.Medications;
      if (!meds) return [];
      if (typeof meds === 'string') {
        try { meds = JSON.parse(meds); } catch (e) { meds = meds.split(',').map(m => ({ name: m.trim() })); }
      }
      if (!Array.isArray(meds)) return [];
      return meds;
    };

    // Helper: calculate monthly requirement for a group of patients and a medicine
    const calcMonthly = (patients, medName) => {
      let total = 0;
      const medLower = medName.toLowerCase();
      patients.forEach(p => {
        const meds = getPatientMeds(p);
        meds.forEach(m => {
          if (!m || !m.name) return;
          // Match by medicine name prefix (before parenthetical dosage info)
          const name = m.name.split('(')[0].trim().toLowerCase();
          if (name === medLower) {
            // Parse dosage frequency if available, default 2 doses/day × 30 days
            const dosage = (m.dosage || '').toString().toUpperCase();
            let dailyDoses = 2; // default BD
            if (dosage.includes('TDS') || dosage.includes('TID')) dailyDoses = 3;
            else if (dosage.includes('OD') || dosage.includes('QD') || dosage.includes('DAILY')) dailyDoses = 1;
            else if (dosage.includes('QID')) dailyDoses = 4;
            total += dailyDoses * 30;
          }
        });
      });
      return total;
    };

    // Fetch current stock if StockComparison available
    const fetchStock = async (phcName, aam) => {
      if (typeof StockComparison !== 'undefined' && StockComparison.fetchCurrentStock) {
        return await StockComparison.fetchCurrentStock(phcName, aam || undefined);
      }
      return {};
    };

    const rows = [];

    try {
      if (scopeOpt === '1') {
        // All facilities summary — one row per medicine
        const stockMap = await fetchStock('All');
        MEDICINES.forEach(med => {
          const monthlyNeed = calcMonthly(activePatients, med);
          const currentStock = stockMap[med] || 0;
          const coverageMonths = monthlyNeed > 0 ? Math.round((currentStock / monthlyNeed) * 10) / 10 : (currentStock > 0 ? 99 : 0);
          const shortage = monthlyNeed > 0 ? Math.max(0, (monthlyNeed * 3) - currentStock) : 0; // 3-month buffer
          const patientsOnMed = activePatients.filter(p => getPatientMeds(p).some(m => m && m.name && m.name.split('(')[0].trim().toLowerCase() === med.toLowerCase())).length;
          rows.push({
            Medicine: med,
            PatientsOnMed: patientsOnMed,
            MonthlyNeed: monthlyNeed,
            CurrentStock: currentStock,
            CoverageMonths: coverageMonths,
            ThreeMonthNeed: monthlyNeed * 3,
            Shortage: shortage,
            Status: coverageMonths >= 3 ? 'Adequate' : coverageMonths >= 1 ? 'Low' : monthlyNeed > 0 ? 'Critical' : 'No Demand'
          });
        });

        return {
          id: 'procurementForecast',
          title: 'Medicine Procurement Forecast — All Facilities',
          filters: `Scope: All Facilities, Active epilepsy patients: ${activePatients.length}`,
          columns: ['Medicine', 'PatientsOnMed', 'MonthlyNeed', 'CurrentStock', 'CoverageMonths', 'ThreeMonthNeed', 'Shortage', 'Status'],
          data: rows,
          summary: { totalPatients: activePatients.length, totalMedicines: MEDICINES.length }
        };

      } else if (scopeOpt === '2') {
        // By Facility — one row per medicine per PHC
        for (const phc of phcList) {
          const phcPatients = activePatients.filter(p => (p.PHC || '').trim() === phc);
          const stockMap = await fetchStock(phc);
          MEDICINES.forEach(med => {
            const monthlyNeed = calcMonthly(phcPatients, med);
            if (monthlyNeed === 0) return; // skip medicines with no demand at this facility
            const currentStock = stockMap[med] || 0;
            const coverageMonths = monthlyNeed > 0 ? Math.round((currentStock / monthlyNeed) * 10) / 10 : 0;
            const shortage = Math.max(0, (monthlyNeed * 3) - currentStock);
            const patientsOnMed = phcPatients.filter(p => getPatientMeds(p).some(m => m && m.name && m.name.split('(')[0].trim().toLowerCase() === med.toLowerCase())).length;
            rows.push({
              Facility: phc,
              Medicine: med,
              PatientsOnMed: patientsOnMed,
              MonthlyNeed: monthlyNeed,
              CurrentStock: currentStock,
              CoverageMonths: coverageMonths,
              ThreeMonthNeed: monthlyNeed * 3,
              Shortage: shortage,
              Status: coverageMonths >= 3 ? 'Adequate' : coverageMonths >= 1 ? 'Low' : 'Critical'
            });
          });
        }

        return {
          id: 'procurementForecast',
          title: 'Medicine Procurement Forecast — By Facility',
          filters: `Scope: By Facility (${phcList.length} facilities), Active patients: ${activePatients.length}`,
          columns: ['Facility', 'Medicine', 'PatientsOnMed', 'MonthlyNeed', 'CurrentStock', 'CoverageMonths', 'ThreeMonthNeed', 'Shortage', 'Status'],
          data: rows,
          summary: { totalFacilities: phcList.length, totalPatients: activePatients.length }
        };

      } else {
        // By AAM Center — one row per medicine per AAM center
        // Build AAM-to-PHC mapping from patient data
        const aamMap = {}; // { aamName: { phc, patients[] } }
        activePatients.forEach(p => {
          const aam = (p.NearestAAMCenter || p.nearestAAMCenter || '').toString().trim();
          const phc = (p.PHC || '').trim();
          if (!aam) return;
          if (!aamMap[aam]) aamMap[aam] = { phc, patients: [] };
          aamMap[aam].patients.push(p);
        });

        const aamNames = Object.keys(aamMap).sort();
        for (const aam of aamNames) {
          const info = aamMap[aam];
          const stockMap = await fetchStock(info.phc, aam);
          MEDICINES.forEach(med => {
            const monthlyNeed = calcMonthly(info.patients, med);
            if (monthlyNeed === 0) return;
            const currentStock = stockMap[med] || 0;
            const coverageMonths = monthlyNeed > 0 ? Math.round((currentStock / monthlyNeed) * 10) / 10 : 0;
            const shortage = Math.max(0, (monthlyNeed * 3) - currentStock);
            const patientsOnMed = info.patients.filter(p => getPatientMeds(p).some(m => m && m.name && m.name.split('(')[0].trim().toLowerCase() === med.toLowerCase())).length;
            rows.push({
              AAMCenter: aam,
              Facility: info.phc,
              Medicine: med,
              PatientsOnMed: patientsOnMed,
              MonthlyNeed: monthlyNeed,
              CurrentStock: currentStock,
              CoverageMonths: coverageMonths,
              ThreeMonthNeed: monthlyNeed * 3,
              Shortage: shortage,
              Status: coverageMonths >= 3 ? 'Adequate' : coverageMonths >= 1 ? 'Low' : 'Critical'
            });
          });
        }

        return {
          id: 'procurementForecast',
          title: 'Medicine Procurement Forecast — By AAM Center',
          filters: `Scope: By AAM Center (${aamNames.length} centers), Active patients: ${activePatients.length}`,
          columns: ['AAMCenter', 'Facility', 'Medicine', 'PatientsOnMed', 'MonthlyNeed', 'CurrentStock', 'CoverageMonths', 'ThreeMonthNeed', 'Shortage', 'Status'],
          data: rows,
          summary: { totalAAMCenters: aamNames.length, totalPatients: activePatients.length }
        };
      }
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating procurement forecast:', error);
      throw error;
    }
  }

  /**
   * Display the generated report in a modal/view
   */
  displayReport(reportData) {
    if (!reportData) return;

    this.currentReport = reportData;
    this.reportViewSettings.currentPage = 1;

    const viewContainer = document.getElementById('reportViewContainer');
    if (!viewContainer) return;

    // Build summary panel for CHO Performance report
    let summaryPanel = '';
    if (reportData.id === 'choPerformance' && reportData.summary && reportData.data.length > 0) {
      const s = reportData.summary;
      const tierCounts = { Excellent: 0, Good: 0, Average: 0, 'Needs Improvement': 0 };
      reportData.data.forEach(row => {
        const tier = row.PerformanceTier || '';
        if (tierCounts.hasOwnProperty(tier)) tierCounts[tier]++;
      });
      
      summaryPanel = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
          <div style="padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #3b82f6; text-align: center;">
            <div style="font-weight: 700; color: #3b82f6; font-size: 1.4em;">${s.totalCHOs || 0}</div>
            <div style="font-size: 0.8em; color: #666;">Total CHOs</div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #8b5cf6; text-align: center;">
            <div style="font-weight: 700; color: #8b5cf6; font-size: 1.4em;">${s.totalPatients || 0}</div>
            <div style="font-size: 0.8em; color: #666;">Total Patients</div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #06b6d4; text-align: center;">
            <div style="font-weight: 700; color: #06b6d4; font-size: 1.4em;">${s.totalFollowUps || 0}</div>
            <div style="font-size: 0.8em; color: #666;">Total Follow-ups</div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #10b981; text-align: center;">
            <div style="font-weight: 700; color: #10b981; font-size: 1.4em;">${s.avgSeizureControl || 0}%</div>
            <div style="font-size: 0.8em; color: #666;">Avg Seizure Control</div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #f59e0b; text-align: center;">
            <div style="font-weight: 700; color: #f59e0b; font-size: 1.4em;">${s.avgAdherence || 0}%</div>
            <div style="font-size: 0.8em; color: #666;">Avg Adherence</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
          <span style="padding: 4px 10px; background: #d1fae5; color: #065f46; border-radius: 12px; font-size: 0.8em; font-weight: 600;">Excellent: ${tierCounts.Excellent}</span>
          <span style="padding: 4px 10px; background: #dbeafe; color: #1e40af; border-radius: 12px; font-size: 0.8em; font-weight: 600;">Good: ${tierCounts.Good}</span>
          <span style="padding: 4px 10px; background: #fef3c7; color: #92400e; border-radius: 12px; font-size: 0.8em; font-weight: 600;">Average: ${tierCounts.Average}</span>
          <span style="padding: 4px 10px; background: #fee2e2; color: #991b1b; border-radius: 12px; font-size: 0.8em; font-weight: 600;">Needs Improvement: ${tierCounts['Needs Improvement']}</span>
        </div>
      `;
    }

    let html = `
      <div class="report-view">
        <div class="report-header">
          <h3>${reportData.title}</h3>
          <p class="report-filters"><strong>Applied Filters:</strong> ${reportData.filters}</p>
          <p class="report-summary"><strong>Total Records:</strong> ${reportData.data.length}</p>
        </div>
        
        ${summaryPanel}

        <div class="report-controls">
          <div class="report-search">
            <input type="text" id="reportSearchInput" placeholder="Search in results..." class="report-search-input">
          </div>
          <div class="report-export-buttons">
            <button class="btn-export-csv" data-report-id="${reportData.id}">Export as CSV</button>
            <button class="btn-export-excel" data-report-id="${reportData.id}">Export as Excel</button>
            <button class="btn-export-pdf" data-report-id="${reportData.id}">Export as PDF</button>
          </div>
        </div>

        <div class="report-table-container">
          <table class="report-table" id="reportTable">
            <thead>
              <tr>
                ${reportData.columns.map(col => `
                  <th class="sortable" data-column="${col}">
                    ${this.formatColumnName(col)}
                    <span class="sort-indicator">⇅</span>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody id="reportTableBody">
              <!-- Populated by renderReportData -->
            </tbody>
          </table>
        </div>

        <div class="report-pagination">
          <button class="btn-prev-page" id="prevPageBtn" disabled>← Previous</button>
          <span id="pageIndicator">Page 1 of X</span>
          <button class="btn-next-page" id="nextPageBtn">Next →</button>
        </div>
      </div>
    `;

    viewContainer.innerHTML = html;
    // Show the report container
    viewContainer.style.display = 'block';
    this.renderReportData();
    this.setupReportEventHandlers();
  }

  /**
   * Render report data table with pagination
   */
  renderReportData(filteredData = null) {
    if (!this.currentReport) return;

    let data = filteredData || this.currentReport.data;
    const { itemsPerPage, currentPage } = this.reportViewSettings;

    const startIdx = (currentPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const pageData = data.slice(startIdx, endIdx);

    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;

    tbody.innerHTML = pageData.map((row, idx) => {
      let rowHtml = '<tr>';
      this.currentReport.columns.forEach(col => {
        const value = row[col] || '';
        rowHtml += `<td>${this.formatCellValue(value, col)}</td>`;
      });
      rowHtml += '</tr>';
      return rowHtml;
    }).join('');

    // Update pagination
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const pageIndicator = document.getElementById('pageIndicator');
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
    }

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages;
  }

  /**
   * Setup event handlers for report view
   */
  setupReportEventHandlers() {
    // Search functionality
    const searchInput = document.getElementById('reportSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = this.currentReport.data.filter(row => {
          return this.currentReport.columns.some(col => {
            const value = String(row[col] || '').toLowerCase();
            return value.includes(term);
          });
        });
        this.reportViewSettings.currentPage = 1;
        this.renderReportData(filtered);
      });
    }

    // Pagination
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      if (this.reportViewSettings.currentPage > 1) {
        this.reportViewSettings.currentPage--;
        this.renderReportData();
      }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      this.reportViewSettings.currentPage++;
      this.renderReportData();
    });

    // Export buttons
    document.querySelectorAll('.btn-export-csv').forEach(btn => {
      btn.addEventListener('click', () => this.exportReport('csv'));
    });
    document.querySelectorAll('.btn-export-excel').forEach(btn => {
      btn.addEventListener('click', () => this.exportReport('excel'));
    });
    document.querySelectorAll('.btn-export-pdf').forEach(btn => {
      btn.addEventListener('click', () => this.exportReport('pdf'));
    });

    // Sorting
    document.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', (e) => {
        const column = e.currentTarget.dataset.column;
        this.sortReportData(column);
      });
    });
  }

  /**
   * Sort report data by column
   */
  sortReportData(column) {
    const { sortBy, sortAsc } = this.reportViewSettings;

    if (sortBy === column) {
      this.reportViewSettings.sortAsc = !sortAsc;
    } else {
      this.reportViewSettings.sortBy = column;
      this.reportViewSettings.sortAsc = true;
    }

    const data = [...this.currentReport.data];
    data.sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];

      // Handle numeric values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return this.reportViewSettings.sortAsc ? aVal - bVal : bVal - aVal;
      }

      // Handle string values
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();

      if (this.reportViewSettings.sortAsc) {
        return aVal.localeCompare(bVal);
      } else {
        return bVal.localeCompare(aVal);
      }
    });

    this.currentReport.data = data;
    this.reportViewSettings.currentPage = 1;
    this.renderReportData();
  }

  /**
   * Export report data in specified format
   */
  async exportReport(format) {
    if (!this.currentReport) return;

    if (window.ExportHandlers) {
      await window.ExportHandlers.exportList(this.currentReport, format);
    } else {
      alert('Export handlers not loaded. Please refresh the page.');
    }
  }

  /**
   * Format column name for display
   */
  formatColumnName(col) {
    // Custom friendly names for procurement report columns
    const friendlyNames = {
      'PatientsOnMed': 'Patients On Med',
      'MonthlyNeed': 'Monthly Need (units)',
      'CurrentStock': 'Current Stock',
      'CoverageMonths': 'Coverage (months)',
      'ThreeMonthNeed': '3-Month Need',
      'AAMCenter': 'AAM Center'
    };
    if (friendlyNames[col]) return friendlyNames[col];
    return col
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Format cell value for display
   */
  formatCellValue(value, column) {
    if (value === null || value === undefined || value === '') return '-';
    
    // Color-coded Performance Tier badges
    if (column === 'PerformanceTier') {
      const tierColors = {
        'Excellent': { bg: '#d1fae5', text: '#065f46', border: '#10b981' },
        'Good': { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' },
        'Average': { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' },
        'Needs Improvement': { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
        'No Data': { bg: '#f3f4f6', text: '#6b7280', border: '#9ca3af' }
      };
      const colors = tierColors[value] || tierColors['No Data'];
      return `<span style="padding: 3px 10px; background: ${colors.bg}; color: ${colors.text}; border: 1px solid ${colors.border}; border-radius: 12px; font-size: 0.85em; font-weight: 600; white-space: nowrap;">${value}</span>`;
    }
    
    // Add % symbol to percentage columns
    if (column === 'SeizureControlPercent' || column === 'FollowUpRatePercent' || column === 'AdherenceRatePercent' || 
        column === 'PercentPrivate' || column === 'PercentGovt') {
      const num = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(num)) {
        // Color-code percentages
        let color = '#333';
        if (column === 'SeizureControlPercent' || column === 'AdherenceRatePercent') {
          color = num >= 60 ? '#10b981' : num >= 40 ? '#f59e0b' : '#ef4444';
        }
        return `<span style="color: ${color}; font-weight: 600;">${Math.round(num)}%</span>`;
      }
    }
    
    // Risk level color-coding
    if (column === 'RiskLevel') {
      const riskColors = { 'High': '#ef4444', 'Medium': '#f59e0b', 'Low': '#10b981' };
      const color = riskColors[value] || '#333';
      return `<span style="color: ${color}; font-weight: 600;">${value}</span>`;
    }
    
    // Procurement status color-coding
    if (column === 'Status' && (value === 'Critical' || value === 'Low' || value === 'Adequate' || value === 'No Demand')) {
      const statusColors = { 'Critical': { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' }, 'Low': { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' }, 'Adequate': { bg: '#d1fae5', text: '#065f46', border: '#10b981' }, 'No Demand': { bg: '#f3f4f6', text: '#6b7280', border: '#9ca3af' } };
      const colors = statusColors[value] || statusColors['No Demand'];
      return `<span style="padding: 3px 10px; background: ${colors.bg}; color: ${colors.text}; border: 1px solid ${colors.border}; border-radius: 12px; font-size: 0.85em; font-weight: 600; white-space: nowrap;">${value}</span>`;
    }
    
    // Coverage months color-coding
    if (column === 'CoverageMonths') {
      const num = typeof value === 'number' ? value : parseFloat(value);
      if (!isNaN(num) && num !== 99) {
        const color = num >= 3 ? '#10b981' : num >= 1 ? '#f59e0b' : '#ef4444';
        return `<span style="color: ${color}; font-weight: 600;">${num}</span>`;
      }
      return num === 99 ? '<span style="color: #6b7280;">∞</span>' : String(value);
    }
    
    // Shortage color-coding
    if (column === 'Shortage') {
      const num = typeof value === 'number' ? value : parseInt(value);
      if (!isNaN(num) && num > 0) {
        return `<span style="color: #ef4444; font-weight: 600;">${num.toLocaleString()}</span>`;
      }
      return num === 0 ? '<span style="color: #10b981;">0</span>' : String(value);
    }
    
    // Format dates (ISO format strings)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      } catch (e) { /* fall through */ }
    }
    
    // Format date-only strings (YYYY-MM-DD)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      try {
        const d = new Date(value + 'T00:00:00');
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      } catch (e) { /* fall through */ }
    }
    
    // Numbers: show integers without decimals
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return String(value);
      return Math.round(value).toString();
    }
    
    // String numbers that look like "60.00" — display as integer
    if (typeof value === 'string' && /^\d+\.\d+$/.test(value)) {
      const num = parseFloat(value);
      if (!isNaN(num)) return Math.round(num).toString();
    }
    
    return String(value);
  }

  /**
   * Show loading state for report generation
   */
  showReportLoading(reportId) {
    const container = document.getElementById('reportViewContainer');
    if (container) {
      container.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Generating report...</p>
        </div>
      `;
      // Show the report container
      container.style.display = 'block';
    }
  }

  /**
   * Generate a custom filtered list from query builder
   */
  async generateCustomFilteredList(filterObj) {
    this.showReportLoading('custom');

    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'executeCustomFilter',
          filters: filterObj
        })
      });

      const result = await response.json();

      const reportData = {
        id: 'customFilter',
        title: 'Custom Filtered Report',
        filters: this.buildFilterDescription(filterObj),
        columns: result.columns || ['PatientID', 'PatientName', 'PHC'],
        data: result.data || [],
        summary: result.summary || {}
      };

      this.displayReport(reportData);
    } catch (error) {
      if (window.Logger) window.Logger.error('Error generating custom filtered report:', error);
      alert(`Error: ${error.message}`);
    }
  }

  /**
   * Build human-readable filter description
   */
  buildFilterDescription(filterObj) {
    const conditions = filterObj.conditions
      .map(c => `${c.field} ${c.operator} ${c.value}`)
      .join(` ${filterObj.logic} `);
    return `Custom Filters: ${conditions}`;
  }

  /**
   * Setup initial report view handlers
   */
  setupReportViewHandlers() {
    // Can be extended for additional interactions
  }
}

// Export for use in other modules
window.CustomReports = new CustomReports();
