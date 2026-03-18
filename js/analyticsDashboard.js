/**
 * Advanced Analytics Dashboard
 * Interactive dashboard with charts, trends, and comprehensive analytics
 */

class AnalyticsDashboard {
  constructor() {
    this.currentChо = null;
    this.selectedPHC = 'All';
    this.dateRange = {
      start: new Date(new Date().setDate(new Date().getDate() - 30)),
      end: new Date()
    };
    this.charts = {};
    this.initialized = false;
  }

  /**
   * Initialize the dashboard UI and event handlers
   */
  async initialize() {
    if (this.initialized) return;
    
    this.buildDashboardHTML();
    this.setupEventHandlers();
    this.initialized = true;
    
    // Load initial data
    await this.loadDashboardData();
  }

  /**
   * Build dashboard HTML structure
   */
  buildDashboardHTML() {
    const analyticsTab = document.getElementById('analyticsTab');
    if (!analyticsTab) return;

    analyticsTab.innerHTML = `
      <div class="analytics-dashboard">
        <!-- Dashboard Header & Filters -->
        <div class="dashboard-header">
          <h2>Advanced Clinical Analytics Dashboard</h2>
          <div class="dashboard-filters">
            <div class="filter-group">
              <label>CHO Selection:</label>
              <select id="dashboardCHOSelect">
                <option value="">Select CHO...</option>
                <option value="all">All CHOs (District View)</option>
              </select>
            </div>
            <div class="filter-group">
              <label>PHC Location:</label>
              <select id="dashboardPHCSelect">
                <option value="All">All PHCs</option>
              </select>
            </div>
            <div class="filter-group">
              <label>Date Range:</label>
              <input type="date" id="dashboardStartDate">
              <span>to</span>
              <input type="date" id="dashboardEndDate">
            </div>
            <button id="dashboardRefreshBtn" class="btn btn-primary">Refresh</button>
          </div>
        </div>

        <!-- KPI Cards -->
        <div class="dashboard-kpis">
          <div class="kpi-card">
            <div class="kpi-header">Seizure Control Rate</div>
            <div class="kpi-value" id="kpiSeizureControl">--</div>
            <div class="kpi-footer">% of follow-ups</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-header">Medication Adherence</div>
            <div class="kpi-value" id="kpiAdherence">--</div>
            <div class="kpi-footer">% good adherence</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-header">Patient Load</div>
            <div class="kpi-value" id="kpiPatientLoad">--</div>
            <div class="kpi-footer">unique patients</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-header">Workload Balance</div>
            <div class="kpi-value" id="kpiWorkload">--</div>
            <div class="kpi-footer">% balanced</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-header">Performance Score</div>
            <div class="kpi-value" id="kpiScore">--</div>
            <div class="kpi-footer">composite score</div>
          </div>
        </div>

        <!-- Charts Section -->
        <div class="dashboard-charts">
          <!-- Row 1: Performance Ranking & Seizure Trends -->
          <div class="chart-row">
            <div class="chart-container">
              <h3>CHO Performance Ranking</h3>
              <canvas id="performanceChart"></canvas>
            </div>
            <div class="chart-container">
              <h3>Seizure Control Trend</h3>
              <canvas id="seizureTrendChart"></canvas>
            </div>
          </div>

          <!-- Row 2: Distribution & Adherence -->
          <div class="chart-row">
            <div class="chart-container">
              <h3>Patient Stratification by Control</h3>
              <canvas id="stratificationChart"></canvas>
            </div>
            <div class="chart-container">
              <h3>Adherence Trend</h3>
              <canvas id="adherenceTrendChart"></canvas>
            </div>
          </div>

          <!-- Row 3: Workload & Peer Comparison -->
          <div class="chart-row">
            <div class="chart-container">
              <h3>CHO Workload Distribution</h3>
              <canvas id="workloadChart"></canvas>
            </div>
            <div class="chart-container">
              <h3>Peer Comparison (Current CHO)</h3>
              <div id="peerComparisonDiv" class="peer-comparison-container"></div>
            </div>
          </div>
        </div>

        <!-- Improvement Recommendations -->
        <div class="improvement-section">
          <h3>CHO Improvement Recommendations</h3>
          <div id="improvementRecommendations" class="recommendations-container"></div>
        </div>

        <!-- Table: Detailed CHO Metrics -->
        <div class="detailed-table-section">
          <h3>Detailed CHO Metrics</h3>
          <div class="table-controls">
            <input type="text" id="metricsTableSearch" placeholder="Search CHO...">
            <select id="metricsTableSort">
              <option value="patientLoad">Sort by Patient Load</option>
              <option value="seizureControl">Sort by Seizure Control</option>
              <option value="adherence">Sort by Adherence</option>
            </select>
          </div>
          <table class="detailed-metrics-table">
            <thead>
              <tr>
                <th>CHO Name</th>
                <th>Patients</th>
                <th>Follow-Ups</th>
                <th>Seizure Control</th>
                <th>Adherence</th>
                <th>Performance Tier</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="metricsTableBody">
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Setup event handlers for dashboard interactions
   */
  setupEventHandlers() {
    // Refresh button
    document.getElementById('dashboardRefreshBtn')?.addEventListener('click', () => {
      this.loadDashboardData();
    });

    // CHO selection
    document.getElementById('dashboardCHOSelect')?.addEventListener('change', (e) => {
      this.currentChо = e.target.value || null;
      this.loadDashboardData();
    });

    // PHC filter
    document.getElementById('dashboardPHCSelect')?.addEventListener('change', (e) => {
      this.selectedPHC = e.target.value;
      this.loadDashboardData();
    });

    // Date range
    document.getElementById('dashboardStartDate')?.addEventListener('change', (e) => {
      this.dateRange.start = new Date(e.target.value);
      this.loadDashboardData();
    });

    document.getElementById('dashboardEndDate')?.addEventListener('change', (e) => {
      this.dateRange.end = new Date(e.target.value);
      this.loadDashboardData();
    });

    // Table search
    document.getElementById('metricsTableSearch')?.addEventListener('input', (e) => {
      this.filterMetricsTable(e.target.value);
    });

    // Table sort
    document.getElementById('metricsTableSort')?.addEventListener('change', (e) => {
      this.sortMetricsTable(e.target.value);
    });
  }

  /**
   * Load all dashboard data
   */
  async loadDashboardData() {
    try {
      // Show loading state
      this.showDashboardLoading(true);

      const promises = [
        this.loadCHOPerformance(),
        this.loadPatientStratification(),
        this.loadWorkloadDistribution(),
        this.loadCHOList(),
        this.loadPHCList()
      ];

      if (this.currentChо) {
        promises.push(
          this.loadCHOTrends(),
          this.loadPeerComparison(),
          this.loadImprovementPotential()
        );
      }

      await Promise.all(promises);

      this.showDashboardLoading(false);
    } catch (error) {
      if (window.Logger) window.Logger.error('Error loading dashboard data:', error);
      alert(`Error loading dashboard: ${error.message}`);
      this.showDashboardLoading(false);
    }
  }

  /**
   * Load CHO performance ranking
   */
  async loadCHOPerformance() {
    const response = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getCHOPerformanceRanking',
        metric: 'seizureControl',
        phcFilter: this.selectedPHC,
        dateRange: {
          startDate: this.dateRange.start.toISOString().split('T')[0],
          endDate: this.dateRange.end.toISOString().split('T')[0]
        }
      })
    });

    const result = await response.json();
    if (result.status === 'error') throw new Error(result.message);

    this.renderPerformanceChart(result.data);
    this.renderMetricsTable(result.data);

    // Update KPIs
    const avgSeizure = result.summary.avgSeizureControl;
    const avgAdherence = result.summary.avgAdherence;
    document.getElementById('kpiSeizureControl').textContent = avgSeizure + '%';
    document.getElementById('kpiAdherence').textContent = avgAdherence + '%';
    document.getElementById('kpiPatientLoad').textContent = result.data.reduce((s, c) => s + c.PatientCount, 0);
  }

  /**
   * Load patient stratification data
   */
  async loadPatientStratification() {
    const response = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getPatientStratificationByControl',
        startDate: this.dateRange.start.toISOString().split('T')[0],
        endDate: this.dateRange.end.toISOString().split('T')[0],
        phcFilter: this.selectedPHC
      })
    });

    const result = await response.json();
    if (result.status === 'error') throw new Error(result.message);

    this.renderStratificationChart(result);
  }

  /**
   * Load workload distribution
   */
  async loadWorkloadDistribution() {
    const response = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getCHOWorkloadDistribution',
        startDate: this.dateRange.start.toISOString().split('T')[0],
        endDate: this.dateRange.end.toISOString().split('T')[0]
      })
    });

    const result = await response.json();
    if (result.status === 'error') throw new Error(result.message);

    this.renderWorkloadChart(result);
    document.getElementById('kpiWorkload').textContent = result.equipments.loadBalance;
  }

  /**
   * Load CHO trends (seizure control and adherence over time)
   */
  async loadCHOTrends() {
    if (!this.currentChо) return;

    const seizureResponse = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getCHOSeizureControlTrend',
        choName: this.currentChо,
        monthsBack: 6
      })
    });

    const seizureData = await seizureResponse.json();
    if (seizureData.status !== 'error') {
      this.renderSeizureTrendChart(seizureData.data);
    }

    const adherenceResponse = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getCHOAdherenceTrend',
        choName: this.currentChо,
        monthsBack: 6
      })
    });

    const adherenceData = await adherenceResponse.json();
    if (adherenceData.status !== 'error') {
      this.renderAdherenceTrendChart(adherenceData.data);
    }
  }

  /**
   * Load peer comparison data
   */
  async loadPeerComparison() {
    if (!this.currentChо) return;

    const response = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getPeerComparison',
        choName: this.currentChо,
        startDate: this.dateRange.start.toISOString().split('T')[0],
        endDate: this.dateRange.end.toISOString().split('T')[0]
      })
    });

    const result = await response.json();
    if (result.status !== 'error') {
      this.renderPeerComparison(result);
      document.getElementById('kpiScore').textContent = result.overallScore;
    }
  }

  /**
   * Load improvement recommendations
   */
  async loadImprovementPotential() {
    if (!this.currentChо) return;

    const response = await fetch(DEPLOYMENT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'getCHOImprovementPotential',
        choName: this.currentChо,
        startDate: this.dateRange.start.toISOString().split('T')[0],
        endDate: this.dateRange.end.toISOString().split('T')[0]
      })
    });

    const result = await response.json();
    if (result.status !== 'error') {
      this.renderImprovementRecommendations(result);
    }
  }

  /**
   * Load list of all CHOs for dropdown
   */
  async loadCHOList() {
    try {
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getCHOPerformanceRanking',
          metric: 'patientLoad',
          phcFilter: this.selectedPHC
        })
      });

      const result = await response.json();
      if (result.status === 'success') {
        const select = document.getElementById('dashboardCHOSelect');
        if (select) {
          const chоs = result.data;
          const currentValue = select.value;
          const currentHtml = select.innerHTML;
          
          // Keep existing options, add CHO list
          let html = currentHtml;
          chоs.forEach(cho => {
            if (!html.includes(`value="${cho.CHOName}"`)) {
              html += `<option value="${cho.CHOName}">${cho.CHOName}</option>`;
            }
          });
          select.innerHTML = html;
          select.value = currentValue || '';
        }
      }
    } catch (error) {
      if (window.Logger) window.Logger.error('Error loading CHO list:', error);
    }
  }

  /**
   * Load list of PHCs
   */
  async loadPHCList() {
    try {
      // Get PHCs from performance ranking
      const response = await fetch(DEPLOYMENT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getCHOPerformanceRanking',
          metric: 'patientLoad',
          phcFilter: 'All'
        })
      });

      const result = await response.json();
      if (result.status === 'success') {
        const phcs = [...new Set(result.data.map(c => c.PHC))];
        const select = document.getElementById('dashboardPHCSelect');
        if (select) {
          let html = '<option value="All">All PHCs</option>';
          phcs.forEach(phc => {
            html += `<option value="${phc}">${phc || 'Unknown'}</option>`;
          });
          select.innerHTML = html;
          select.value = this.selectedPHC;
        }
      }
    } catch (error) {
      if (window.Logger) window.Logger.error('Error loading PHC list:', error);
    }
  }

  /**
   * Render CHO performance ranking chart
   */
  renderPerformanceChart(data) {
    const ctx = document.getElementById('performanceChart');
    if (!ctx) return;

    // Destroy old chart
    if (this.charts.performance) {
      this.charts.performance.destroy();
    }

    const topCHOs = data.slice(0, 10);
    const labels = topCHOs.map(c => c.CHOName);
    const seizureControl = topCHOs.map(c => parseFloat(c.SeizureControlPercent));
    const adherence = topCHOs.map(c => parseFloat(c.AdherenceRatePercent));

    this.charts.performance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Seizure Control %',
            data: seizureControl,
            backgroundColor: '#28a745',
            borderColor: '#1e7e34',
            borderWidth: 1
          },
          {
            label: 'Adherence %',
            data: adherence,
            backgroundColor: '#007bff',
            borderColor: '#0056b3',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'top' }
        },
        scales: {
          y: { beginAtZero: true, max: 100 }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            document.getElementById('dashboardCHOSelect').value = labels[index];
            this.currentChо = labels[index];
            this.loadDashboardData();
          }
        }
      }
    });
  }

  /**
   * Render seizure control trend chart
   */
  renderSeizureTrendChart(data) {
    const ctx = document.getElementById('seizureTrendChart');
    if (!ctx) return;

    if (this.charts.seizureTrend) {
      this.charts.seizureTrend.destroy();
    }

    const labels = data.map(d => d.month);
    const values = data.map(d => parseFloat(d.seizureControlPercent));

    this.charts.seizureTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Seizure Control %',
          data: values,
          borderColor: '#28a745',
          backgroundColor: 'rgba(40, 167, 69, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: { beginAtZero: true, max: 100 }
        }
      }
    });
  }

  /**
   * Render adherence trend chart
   */
  renderAdherenceTrendChart(data) {
    const ctx = document.getElementById('adherenceTrendChart');
    if (!ctx) return;

    if (this.charts.adherenceTrend) {
      this.charts.adherenceTrend.destroy();
    }

    const labels = data.map(d => d.month);
    const values = data.map(d => parseFloat(d.adherencePercent));

    this.charts.adherenceTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Medication Adherence %',
          data: values,
          borderColor: '#007bff',
          backgroundColor: 'rgba(0, 123, 255, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: { beginAtZero: true, max: 100 }
        }
      }
    });
  }

  /**
   * Render patient stratification chart
   */
  renderStratificationChart(data) {
    const ctx = document.getElementById('stratificationChart');
    if (!ctx) return;

    if (this.charts.stratification) {
      this.charts.stratification.destroy();
    }

    const counts = data.counts;

    this.charts.stratification = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Seizure Free', 'Decreasing Seizures', 'Unchanged', 'Increasing Seizures', 'No Data'],
        datasets: [{
          data: [
            counts.seizureFree,
            counts.decreasingSeizures,
            counts.unchangedSeizures,
            counts.increasingSeizures,
            counts.noData
          ],
          backgroundColor: [
            '#28a745',
            '#17a2b8',
            '#ffc107',
            '#dc3545',
            '#e9ecef'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }

  /**
   * Render workload distribution chart
   */
  renderWorkloadChart(data) {
    const ctx = document.getElementById('workloadChart');
    if (!ctx) return;

    if (this.charts.workload) {
      this.charts.workload.destroy();
    }

    const categories = data.categories;

    this.charts.workload = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Overloaded', 'Balanced', 'Underutilized'],
        datasets: [{
          label: 'Number of CHOs',
          data: [
            categories.overloaded.count,
            categories.balanced.count,
            categories.underutilized.count
          ],
          backgroundColor: ['#dc3545', '#28a745', '#ffc107']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  /**
   * Render peer comparison metrics
   */
  renderPeerComparison(data) {
    const container = document.getElementById('peerComparisonDiv');
    if (!container) return;

    const comparisons = data.comparisons;

    container.innerHTML = `
      <div class="peer-metrics">
        <div class="peer-metric">
          <div class="metric-name">Seizure Control</div>
          <div class="metric-bar">
            <div class="bar-value" style="width: ${data.metrics.seizureControlPercentile}%"></div>
          </div>
          <div class="metric-info">
            <span class="your-value">${comparisons.seizureControl.value}%</span>
            <span class="avg-value">avg: ${comparisons.seizureControl.districtAvg}%</span>
            <span class="rank">Rank: ${comparisons.seizureControl.position}/${data.peerGroup.totalCHOs}</span>
          </div>
        </div>

        <div class="peer-metric">
          <div class="metric-name">Medication Adherence</div>
          <div class="metric-bar">
            <div class="bar-value" style="width: ${data.metrics.adherencePercentile}%"></div>
          </div>
          <div class="metric-info">
            <span class="your-value">${comparisons.adherence.value}%</span>
            <span class="avg-value">avg: ${comparisons.adherence.districtAvg}%</span>
            <span class="rank">Rank: ${comparisons.adherence.position}/${data.peerGroup.totalCHOs}</span>
          </div>
        </div>

        <div class="peer-metric">
          <div class="metric-name">Patient Load</div>
          <div class="metric-bar">
            <div class="bar-value" style="width: ${data.metrics.patientLoadPercentile}%"></div>
          </div>
          <div class="metric-info">
            <span class="your-value">${comparisons.patientLoad.value}</span>
            <span class="avg-value">avg: ${comparisons.patientLoad.districtAvg}</span>
            <span class="rank">Rank: ${comparisons.patientLoad.position}/${data.peerGroup.totalCHOs}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render improvement recommendations
   */
  renderImprovementRecommendations(data) {
    const container = document.getElementById('improvementRecommendations');
    if (!container) return;

    if (data.improvements && data.improvements.length > 0) {
      let html = '';
      data.improvements.forEach(improvement => {
        html += `
          <div class="improvement-card">
            <h4>${improvement.metric}</h4>
            <div class="improvement-details">
              <div class="detail">
                <span class="label">Current:</span>
                <span class="value">${improvement.current}</span>
              </div>
              <div class="detail">
                <span class="label">Target:</span>
                <span class="value">${improvement.target}</span>
              </div>
              <div class="detail">
                <span class="label">Gap:</span>
                <span class="value" style="color: #dc3545;">${improvement.gap}</span>
              </div>
            </div>
            <div class="recommendations">
              <strong>Recommendations:</strong>
              <ul>
                ${improvement.recommendations.map(r => `<li>${r}</li>`).join('')}
              </ul>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    } else {
      container.innerHTML = '<p class="alert alert-success">No improvement areas identified. Excellent performance!</p>';
    }
  }

  /**
   * Render metrics table
   */
  renderMetricsTable(data) {
    const tbody = document.getElementById('metricsTableBody');
    if (!tbody) return;

    tbody.innerHTML = data.map(cho => `
      <tr class="metrics-row" data-cho="${cho.CHOName}">
        <td><strong>${cho.CHOName}</strong></td>
        <td>${cho.PatientCount}</td>
        <td>${cho.TotalFollowUps}</td>
        <td><span class="badge bg-${parseFloat(cho.SeizureControlPercent) >= 50 ? 'success' : 'warning'}">${cho.SeizureControlPercent}%</span></td>
        <td><span class="badge bg-${parseFloat(cho.AdherenceRatePercent) >= 70 ? 'success' : 'warning'}">${cho.AdherenceRatePercent}%</span></td>
        <td><span class="tier-badge tier-${cho.PerformanceTier.toLowerCase()}">${cho.PerformanceTier}</span></td>
        <td>
          <button class="btn btn-sm btn-info" onclick="window.analyticsDashboard.selectCHO('${cho.CHOName}')">View Details</button>
        </td>
      </tr>
    `).join('');
  }

  /**
   * Filter metrics table by search term
   */
  filterMetricsTable(searchTerm) {
    const rows = document.querySelectorAll('.metrics-row');
    rows.forEach(row => {
      const choName = row.dataset.cho.toLowerCase();
      row.style.display = choName.includes(searchTerm.toLowerCase()) ? '' : 'none';
    });
  }

  /**
   * Sort metrics table
   */
  sortMetricsTable(sortBy) {
    const tbody = document.getElementById('metricsTableBody');
    const rows = Array.from(document.querySelectorAll('.metrics-row'));

    rows.sort((a, b) => {
      let aVal, bVal;

      if (sortBy === 'patientLoad') {
        aVal = parseInt(a.cells[1].textContent);
        bVal = parseInt(b.cells[1].textContent);
      } else if (sortBy === 'seizureControl') {
        aVal = parseFloat(a.cells[3].textContent);
        bVal = parseFloat(b.cells[3].textContent);
      } else if (sortBy === 'adherence') {
        aVal = parseFloat(a.cells[4].textContent);
        bVal = parseFloat(b.cells[4].textContent);
      }

      return bVal - aVal;
    });

    tbody.innerHTML = '';
    rows.forEach(row => tbody.appendChild(row));
  }

  /**
   * Select a CHO for detailed view
   */
  selectCHO(choName) {
    document.getElementById('dashboardCHOSelect').value = choName;
    this.currentChо = choName;
    this.loadDashboardData();
  }

  /**
   * Show/hide loading state
   */
  showDashboardLoading(show) {
    const dashboard = document.querySelector('.analytics-dashboard');
    if (!dashboard) return;

    if (show) {
      const overlay = document.createElement('div');
      overlay.className = 'loading-overlay';
      overlay.id = 'dashboardLoadingOverlay';
      overlay.innerHTML = '<div class="spinner"></div><p>Loading analytics...</p>';
      dashboard.appendChild(overlay);
    } else {
      document.getElementById('dashboardLoadingOverlay')?.remove();
    }
  }
}

// Initialize dashboard globally
window.analyticsDashboard = new AnalyticsDashboard();
