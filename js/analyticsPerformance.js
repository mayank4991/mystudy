/**
 * Analytics Performance Optimization Module (Phase 4)
 * Implements pagination, lazy loading, memory optimization, and caching
 */

class AnalyticsPerformanceOptimizer {
  constructor() {
    this.pageSize = 50;
    this.cachedMetrics = new Map();
    this.chunkedData = new Map();
    this.offscreenCanvas = document.createElement('canvas');
  }

  /**
   * Paginate large datasets
   * @param {Array} data - Full dataset
   * @param {number} pageNumber - Page number (1-indexed)
   * @param {number} pageSize - Items per page (default 50)
   * @return {Object} Paginated result with metadata
   */
  paginateData(data, pageNumber, pageSize = this.pageSize) {
    const totalPages = Math.ceil(data.length / pageSize);
    const startIdx = (pageNumber - 1) * pageSize;
    const endIdx = startIdx + pageSize;

    return {
      data: data.slice(startIdx, endIdx),
      pageNumber: pageNumber,
      pageSize: pageSize,
      totalPages: totalPages,
      totalRecords: data.length,
      startRecord: startIdx + 1,
      endRecord: Math.min(endIdx, data.length),
      hasNextPage: pageNumber < totalPages,
      hasPreviousPage: pageNumber > 1
    };
  }

  /**
   * Virtual scroll implementation for large tables
   * Only renders visible rows
   * @param {Array} allRows - All data rows
   * @param {HTMLElement} container - Container element
   * @param {number} visibleRows - Number of rows visible at once (default 20)
   * @return {Object} Virtual scroll handler
   */
  createVirtualScroll(allRows, container, visibleRows = 20) {
    const rowHeight = 50; // pixels
    const totalHeight = allRows.length * rowHeight;
    const visibleHeight = visibleRows * rowHeight;

    let currentScrollTop = 0;

    const handler = {
      onScroll: (scrollTop) => {
        currentScrollTop = scrollTop;
        const startIdx = Math.floor(scrollTop / rowHeight);
        const endIdx = Math.ceil((scrollTop + visibleHeight) / rowHeight);

        return {
          visibleRows: allRows.slice(startIdx, endIdx + 1),
          startIdx: startIdx,
          offsetY: startIdx * rowHeight
        };
      },

      render: (visibleData) => {
        const html = visibleData.visibleRows
          .map((row, idx) => {
            return `<tr style="transform: translateY(${visibleData.offsetY}px);">${
              Object.values(row).map(v => `<td>${v}</td>`).join('')
            }</tr>`;
          })
          .join('');

        return html;
      }
    };

    return {
      totalHeight: totalHeight,
      rowHeight: rowHeight,
      onScroll: handler.onScroll,
      render: handler.render
    };
  }

  /**
   * Chunk data processing for large aggregations
   * Process data in chunks to avoid blocking
   * @param {Array} data - Data to process
   * @param {Function} processor - Processing function for each chunk
   * @param {number} chunkSize - Items per chunk (default 500)
   * @return {Promise} Resolves when all chunks processed
   */
  async processInChunks(data, processor, chunkSize = 500) {
    const results = [];
    const totalChunks = Math.ceil(data.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const startIdx = i * chunkSize;
      const endIdx = Math.min((i + 1) * chunkSize, data.length);
      const chunk = data.slice(startIdx, endIdx);

      // Process chunk
      const chunkResult = await processor(chunk, i + 1, totalChunks);
      results.push(chunkResult);

      // Yield to browser every chunk
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return results;
  }

  /**
   * Lazy load charts - only render when visible
   * @param {string} chartId - Canvas element ID
   * @param {Function} chartFactory - Function that creates the chart
   * @return {Object} Lazy load controller
   */
  lazyLoadChart(chartId, chartFactory) {
    const controller = {
      chartId: chartId,
      chart: null,
      loaded: false,

      load: function() {
        if (!this.loaded && !this.chart) {
          const canvas = document.getElementById(this.chartId);
          if (canvas) {
            this.chart = chartFactory();
            this.loaded = true;
          }
        }
        return this.chart;
      },

      destroy: function() {
        if (this.chart && typeof this.chart.destroy === 'function') {
          this.chart.destroy();
          this.chart = null;
          this.loaded = false;
        }
      }
    };

    // Set up intersection observer
    const canvas = document.getElementById(chartId);
    if (canvas && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !controller.loaded) {
            controller.load();
          }
        });
      }, { threshold: 0.1 });

      observer.observe(canvas);
    }

    return controller;
  }

  /**
   * Memory-efficient data aggregation
   * Process and aggregate without keeping full dataset in memory
   * @param {Array} data - Source data
   * @param {Function} mapper - Transform function for each item
   * @param {Function} aggregator - Aggregation function
   * @return {*} Aggregated result
   */
  reduceWithMemory(data, mapper, aggregator) {
    let result = null;
    const chunkSize = 1000;

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const mappedChunk = chunk.map(mapper);

      result = aggregator(result, mappedChunk);

      // Clear chunk references
      chunk.length = 0;
    }

    return result;
  }

  /**
   * Debounce function for search/filter operations
   * @param {Function} func - Function to debounce
   * @param {number} delay - Delay in ms
   * @return {Function} Debounced function
   */
  debounce(func, delay = 300) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  }

  /**
   * Throttle function for scroll events
   * @param {Function} func - Function to throttle
   * @param {number} delay - Delay in ms
   * @return {Function} Throttled function
   */
  throttle(func, delay = 300) {
    let lastCall = 0;
    return (...args) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        return func(...args);
      }
    };
  }

  /**
   * Request idle callback for non-critical tasks
   * Falls back to setTimeout for unsupported browsers
   * @param {Function} callback - Callback function
   * @return {number} Request ID
   */
  scheduleIdleTask(callback) {
    if ('requestIdleCallback' in window) {
      return window.requestIdleCallback(callback, { timeout: 2000 });
    } else {
      return setTimeout(callback, 100);
    }
  }

  /**
   * Cancel idle task
   * @param {number} id - Request ID
   */
  cancelIdleTask(id) {
    if ('cancelIdleCallback' in window) {
      window.cancelIdleCallback(id);
    } else {
      clearTimeout(id);
    }
  }

  /**
   * Memoize expensive calculations
   * @param {Function} func - Function to memoize
   * @param {Function} keyGenerator - Function to generate cache key
   * @return {Function} Memoized function
   */
  memoize(func, keyGenerator = (...args) => JSON.stringify(args)) {
    return function(...args) {
      const key = keyGenerator(...args);
      if (this.cachedMetrics.has(key)) {
        return this.cachedMetrics.get(key);
      }

      const result = func(...args);
      this.cachedMetrics.set(key, result);

      // Limit cache size
      if (this.cachedMetrics.size > 200) {
        const firstKey = this.cachedMetrics.keys().next().value;
        this.cachedMetrics.delete(firstKey);
      }

      return result;
    };
  }

  /**
   * Optimize table rendering with document fragments
   * @param {Array} rows - Table rows data
   * @param {Function} rowRenderer - Function that renders a single row
   * @return {DocumentFragment} Fragment ready for insertion
   */
  batchRenderRows(rows, rowRenderer) {
    const fragment = document.createDocumentFragment();
    
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = rowRenderer(row, index);
      fragment.appendChild(tr);
    });

    return fragment;
  }

  /**
   * Request animation frame for smooth updates
   * @param {Function} callback - Animation callback
   * @return {number} Frame ID
   */
  scheduleFrameUpdate(callback) {
    return requestAnimationFrame(callback);
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.cachedMetrics.clear();
    this.chunkedData.clear();
  }

  /**
   * Get cache statistics
   * @return {Object} Cache stats
   */
  getCacheStats() {
    return {
      metricsCache: this.cachedMetrics.size,
      chunkedData: this.chunkedData.size,
      memorySaved: (this.cachedMetrics.size * 10).toFixed(0) + ' KB (estimated)'
    };
  }

  /**
   * Enable performance monitoring
   * @param {Function} callback - Callback with performance metrics
   * @return {Function} Stop monitoring function
   */
  monitorPerformance(callback) {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach(entry => {
        callback({
          name: entry.name,
          type: entry.entryType,
          duration: entry.duration.toFixed(2) + 'ms',
          startTime: entry.startTime.toFixed(2) + 'ms'
        });
      });
    });

    observer.observe({ entryTypes: ['measure', 'navigation', 'resource'] });

    // Return cleanup function
    return () => observer.disconnect();
  }
}

// Create global instance
window.PerformanceOptimizer = new AnalyticsPerformanceOptimizer();

/**
 * Enhanced Dashboard with performance optimizations
 * Extends AnalyticsDashboard with Phase 4 optimizations
 */
if (typeof window.AnalyticsDashboard !== 'undefined') {
  const OriginalDashboard = window.AnalyticsDashboard.prototype;

  // Override renderMetricsTable with pagination
  const originalRenderMetricsTable = OriginalDashboard.renderMetricsTable;
  OriginalDashboard.renderMetricsTable = function(data) {
    const optimizer = window.PerformanceOptimizer;
    
    // Paginate data
    const page1 = optimizer.paginateData(data, 1, 50);
    this.currentMetricsPage = 1;
    this.totalMetricsPages = page1.totalPages;

    // Render first page
    this._renderMetricsTablePage(page1.data);

    // Add pagination controls
    this._addMetricsTablePagination(page1, data);
  };

  // Add pagination rendering method
  OriginalDashboard._renderMetricsTablePage = function(pageData) {
    const tbody = document.getElementById('metricsTableBody');
    if (!tbody) return;

    const fragment = window.PerformanceOptimizer.batchRenderRows(
      pageData,
      (cho) => `
        <td><strong>${cho.CHOName}</strong></td>
        <td>${cho.PatientCount}</td>
        <td>${cho.TotalFollowUps}</td>
        <td><span class="badge bg-${parseFloat(cho.SeizureControlPercent) >= 50 ? 'success' : 'warning'}">${cho.SeizureControlPercent}%</span></td>
        <td><span class="badge bg-${parseFloat(cho.AdherenceRatePercent) >= 70 ? 'success' : 'warning'}">${cho.AdherenceRatePercent}%</span></td>
        <td><span class="tier-badge tier-${cho.PerformanceTier.toLowerCase()}">${cho.PerformanceTier}</span></td>
        <td>
          <button class="btn btn-sm btn-info" onclick="window.analyticsDashboard.selectCHO('${cho.CHOName}')">View</button>
        </td>
      `
    );

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  };

  // Add pagination controls
  OriginalDashboard._addMetricsTablePagination = function(currentPage, allData) {
    const tableSection = document.querySelector('.detailed-table-section');
    if (!tableSection) return;

    let paginationDiv = document.getElementById('metricsPagination');
    if (!paginationDiv) {
      paginationDiv = document.createElement('div');
      paginationDiv.id = 'metricsPagination';
      paginationDiv.style.cssText = 'margin-top: 1rem; display: flex; justify-content: center; gap: 0.5rem; align-items: center;';
      tableSection.appendChild(paginationDiv);
    }

    const optimizer = window.PerformanceOptimizer;
    let html = `
      <button class="btn btn-sm btn-secondary" onclick="window.analyticsDashboard._goToMetricsPage(${Math.max(1, currentPage.pageNumber - 1)}, ${allData.length})" ${currentPage.pageNumber === 1 ? 'disabled' : ''}>
        &laquo; Previous
      </button>
      <span>Page ${currentPage.pageNumber} of ${currentPage.totalPages}</span>
      <button class="btn btn-sm btn-secondary" onclick="window.analyticsDashboard._goToMetricsPage(${Math.min(currentPage.totalPages, currentPage.pageNumber + 1)}, ${allData.length})" ${!currentPage.hasNextPage ? 'disabled' : ''}>
        Next &raquo;
      </button>
    `;

    paginationDiv.innerHTML = html;
  };

  // Add method to go to page
  OriginalDashboard._goToMetricsPage = function(pageNumber, totalRecords) {
    const optimizer = window.PerformanceOptimizer;
    const pageData = optimizer.paginateData(this.lastMetricsData || [], pageNumber, 50);
    this._renderMetricsTablePage(pageData.data);
    this._addMetricsTablePagination(pageData, this.lastMetricsData || []);
  };

  // Store metrics data for pagination
  const originalLoadCHOPerformance = OriginalDashboard.loadCHOPerformance;
  OriginalDashboard.loadCHOPerformance = async function() {
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

    // Store for pagination
    this.lastMetricsData = result.data;

    // Use optimized rendering
    this.renderPerformanceChart(result.data);
    this.renderMetricsTable(result.data);

    document.getElementById('kpiSeizureControl').textContent = result.summary.avgSeizureControl + '%';
    document.getElementById('kpiAdherence').textContent = result.summary.avgAdherence + '%';
    document.getElementById('kpiPatientLoad').textContent = result.data.reduce((s, c) => s + c.PatientCount, 0);
  };
}
