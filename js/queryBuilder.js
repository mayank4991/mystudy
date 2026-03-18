/**
 * Advanced Query Builder for Custom Report Generation
 * Enables public health professionals to build complex filters with AND/OR logic
 * without SQL knowledge. Supports multiple data types and predefined conditions.
 */

class QueryBuilder {
  constructor(containerId = 'queryBuilderContainer') {
    this.containerId = containerId;
    this.conditions = [];
    this.logicOperator = 'AND'; // AND or OR between conditions
    this.presets = new Map(); // Saved filter presets
    this.livePreviewCount = 0; // Count of matching records
    this.allPatientData = null; // Cached for live preview
    this.conditionIdCounter = 0;

    // Define available filter fields and their properties
    this.filterFields = {
      seizureFrequency: {
        label: 'Seizure Frequency',
        type: 'select',
        operators: ['equals', 'notEquals'],
        options: [
          { value: 'Seizure Free', label: 'Seizure Free' },
          { value: 'Rarely', label: 'Rarely' },
          { value: 'Monthly', label: 'Monthly' },
          { value: 'Weekly', label: 'Weekly' },
          { value: 'Daily', label: 'Daily' }
        ]
      },
      treatmentAdherence: {
        label: 'Treatment Adherence',
        type: 'select',
        operators: ['equals', 'notEquals', 'in'],
        options: [
          { value: 'Always take', label: 'Always Take Medicine' },
          { value: 'Occasionally miss', label: 'Occasionally Miss' },
          { value: 'Frequently miss', label: 'Frequently Miss' },
          { value: 'Completely stopped', label: 'Completely Stopped' }
        ]
      },
      medicineSource: {
        label: 'Medicine Source',
        type: 'select',
        operators: ['equals', 'notEquals'],
        options: [
          { value: 'Government', label: 'Government Medicines' },
          { value: 'Private', label: 'Private Medicines' },
          { value: 'Mixed', label: 'Mixed (Government + Private)' }
        ]
      },
      sideEffect: {
        label: 'Side Effects',
        type: 'multiselect',
        operators: ['hasAny', 'hasAll', 'hasNone'],
        options: [
          { value: 'Tremor', label: 'Tremor' },
          { value: 'Rash', label: 'Rash/Skin Reactions' },
          { value: 'Dizziness', label: 'Dizziness' },
          { value: 'Drowsiness', label: 'Drowsiness/Fatigue' },
          { value: 'Nausea', label: 'Nausea/Vomiting' },
          { value: 'Headache', label: 'Headache' },
          { value: 'Hair Loss', label: 'Hair Loss' },
          { value: 'Weight Change', label: 'Weight Change' },
          { value: 'Behavioral', label: 'Behavioral Changes' },
          { value: 'Other', label: 'Other' }
        ]
      },
      phc: {
        label: 'PHC Location',
        type: 'select',
        operators: ['equals', 'notEquals', 'in'],
        options: [] // Populated from data
      },
      ageRange: {
        label: 'Patient Age',
        type: 'range',
        operators: ['between', 'lessThan', 'greaterThan'],
        min: 0,
        max: 100,
        step: 1
      },
      lastFollowUpDays: {
        label: 'Days Since Last Follow-Up',
        type: 'numeric',
        operators: ['greaterThan', 'lessThan', 'equals', 'between'],
        min: 0,
        max: 3650 // 10 years
      },
      patientStatus: {
        label: 'Patient Status',
        type: 'select',
        operators: ['equals', 'notEquals', 'in'],
        options: [
          { value: 'Active', label: 'Active' },
          { value: 'Inactive', label: 'Inactive' },
          { value: 'Referred', label: 'Referred' },
          { value: 'Deceased', label: 'Deceased' },
          { value: 'Draft', label: 'Draft' }
        ]
      },
      gender: {
        label: 'Gender',
        type: 'select',
        operators: ['equals', 'notEquals'],
        options: [
          { value: 'Male', label: 'Male' },
          { value: 'Female', label: 'Female' },
          { value: 'Other', label: 'Other' }
        ]
      },
      lastFollowUpDate: {
        label: 'Last Follow-Up Date',
        type: 'dateRange',
        operators: ['between', 'before', 'after'],
        defaultRange: 'last90days'
      }
    };
  }

  /**
   * Initialize the query builder UI
   */
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.warn(`Container #${this.containerId} not found`);
      return;
    }

    container.innerHTML = `
      <div class="query-builder">
        <div class="qb-header">
          <h3>Build Custom Report</h3>
          <p class="qb-subtitle">Combine conditions to find the exact patient group you need</p>
        </div>

        <div class="qb-logic-selector">
          <label>Match records where:</label>
          <div class="logic-buttons">
            <button class="logic-btn active" data-logic="AND">ALL conditions match (AND)</button>
            <button class="logic-btn" data-logic="OR">ANY condition matches (OR)</button>
          </div>
        </div>

        <div class="qb-conditions-container" id="conditionsContainer">
          <!-- Conditions added here -->
        </div>

        <div class="qb-actions">
          <button class="btn-add-condition" id="addConditionBtn">+ Add Condition</button>
          <button class="btn-clear-filters" id="clearFiltersBtn">Clear All</button>
        </div>

        <div class="qb-preview" id="livePreview">
          <div class="preview-spinner"></div>
          <span id="previewCount">Matching records: calculating...</span>
        </div>

        <div class="qb-footer">
          <div class="qb-preset-controls">
            <input type="text" id="presetName" placeholder="Save this filter as..." class="preset-input">
            <button id="savePresetBtn" class="btn-preset">Save as Preset</button>
            <button id="loadPresetBtn" class="btn-preset secondary">Load Preset</button>
          </div>
          <div class="qb-generate-actions">
            <button id="generateReportBtn" class="btn-primary btn-lg" disabled>Generate Report</button>
            <button id="cancelQueryBtn" class="btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.addCondition(); // Start with one empty condition
  }

  /**
   * Setup event listeners for query builder interactions
   */
  setupEventListeners() {
    // Logic operator selection
    document.querySelectorAll('.logic-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.logic-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.logicOperator = e.target.dataset.logic;
        this.updateLivePreview();
      });
    });

    // Add condition button
    document.getElementById('addConditionBtn')?.addEventListener('click', () => this.addCondition());

    // Clear filters button
    document.getElementById('clearFiltersBtn')?.addEventListener('click', () => this.clearAllConditions());

    // Generate report button
    document.getElementById('generateReportBtn')?.addEventListener('click', () => this.generateReport());

    // Cancel button
    document.getElementById('cancelQueryBtn')?.addEventListener('click', () => this.close());
  }

  /**
   * Add a new filter condition row
   */
  addCondition(fieldKey = null, operator = null, value = null) {
    const conditionId = this.conditionIdCounter++;
    const condition = {
      id: conditionId,
      field: fieldKey,
      operator: operator,
      value: value
    };

    this.conditions.push(condition);
    this.renderCondition(condition);
    this.updateLivePreview();
  }

  /**
   * Render a single condition row UI
   */
  renderCondition(condition) {
    const conditionsContainer = document.getElementById('conditionsContainer');
    if (!conditionsContainer) return;

    const conditionEl = document.createElement('div');
    conditionEl.className = 'qb-condition';
    conditionEl.id = `condition-${condition.id}`;

    const fieldSelect = this.createFieldSelect(condition);
    const operatorSelect = this.createOperatorSelect(condition);
    const valueInput = this.createValueInput(condition);

    conditionEl.appendChild(fieldSelect);
    conditionEl.appendChild(operatorSelect);
    conditionEl.appendChild(valueInput);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-condition';
    removeBtn.innerHTML = '✕';
    removeBtn.addEventListener('click', () => this.removeCondition(condition.id));
    conditionEl.appendChild(removeBtn);

    if (this.conditions.length > 1) {
      conditionEl.insertAdjacentHTML('beforeend', 
        `<span class="condition-logic">${this.logicOperator}</span>`);
    }

    conditionsContainer.appendChild(conditionEl);
  }

  /**
   * Create field selector dropdown
   */
  createFieldSelect(condition) {
    const select = document.createElement('select');
    select.className = 'qb-field-select';
    select.innerHTML = '<option value="">Select a field...</option>';

    Object.entries(this.filterFields).forEach(([key, field]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = field.label;
      if (condition.field === key) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      condition.field = e.target.value;
      condition.operator = null;
      condition.value = null;
      this.refreshCondition(condition);
      this.updateLivePreview();
    });

    return select;
  }

  /**
   * Create operator selector dropdown
   */
  createOperatorSelect(condition) {
    const select = document.createElement('select');
    select.className = 'qb-operator-select';

    if (!condition.field) {
      select.innerHTML = '<option>Select field first</option>';
      select.disabled = true;
      return select;
    }

    const fieldDef = this.filterFields[condition.field];
    const operators = {
      'equals': 'equals',
      'notEquals': 'does not equal',
      'in': 'is one of',
      'greaterThan': 'greater than',
      'lessThan': 'less than',
      'between': 'between',
      'before': 'before',
      'after': 'after',
      'contains': 'contains',
      'hasAny': 'has any of',
      'hasAll': 'has all of',
      'hasNone': 'has none of'
    };

    fieldDef.operators.forEach(op => {
      const option = document.createElement('option');
      option.value = op;
      option.textContent = operators[op];
      if (condition.operator === op) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      condition.operator = e.target.value;
      condition.value = null;
      this.refreshCondition(condition);
      this.updateLivePreview();
    });

    return select;
  }

  /**
   * Create value input based on field type and operator
   */
  createValueInput(condition) {
    const container = document.createElement('div');
    container.className = 'qb-value-input';

    if (!condition.field || !condition.operator) {
      container.innerHTML = '<input type="text" placeholder="Select field and operator" disabled>';
      return container;
    }

    const fieldDef = this.filterFields[condition.field];

    switch (fieldDef.type) {
      case 'select':
        const select = document.createElement('select');
        select.className = 'qb-value-select';
        select.innerHTML = '<option value="">Select...</option>';
        fieldDef.options.forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          if (condition.value === opt.value) option.selected = true;
          select.appendChild(option);
        });
        select.addEventListener('change', (e) => {
          condition.value = e.target.value;
          this.updateLivePreview();
        });
        container.appendChild(select);
        break;

      case 'multiselect':
        const div = document.createElement('div');
        div.className = 'qb-multiselect';
        fieldDef.options.forEach(opt => {
          const label = document.createElement('label');
          label.className = 'checkbox-label';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = opt.value;
          if (condition.value && condition.value.includes(opt.value)) {
            checkbox.checked = true;
          }
          checkbox.addEventListener('change', () => {
            const selected = Array.from(div.querySelectorAll('input[type="checkbox"]:checked'))
              .map(cb => cb.value);
            condition.value = selected;
            this.updateLivePreview();
          });
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(opt.label));
          div.appendChild(label);
        });
        container.appendChild(div);
        break;

      case 'range':
      case 'numeric':
        if (condition.operator === 'between') {
          const minInput = document.createElement('input');
          minInput.type = 'number';
          minInput.placeholder = 'Min';
          minInput.min = fieldDef.min || 0;
          minInput.max = fieldDef.max || 1000;
          minInput.className = 'qb-range-input';

          const maxInput = document.createElement('input');
          maxInput.type = 'number';
          maxInput.placeholder = 'Max';
          maxInput.min = fieldDef.min || 0;
          maxInput.max = fieldDef.max || 1000;
          maxInput.className = 'qb-range-input';

          if (condition.value && Array.isArray(condition.value)) {
            minInput.value = condition.value[0] || '';
            maxInput.value = condition.value[1] || '';
          }

          minInput.addEventListener('change', () => {
            condition.value = [Number(minInput.value), Number(maxInput.value)];
            this.updateLivePreview();
          });
          maxInput.addEventListener('change', () => {
            condition.value = [Number(minInput.value), Number(maxInput.value)];
            this.updateLivePreview();
          });

          container.appendChild(minInput);
          container.appendChild(document.createTextNode(' to '));
          container.appendChild(maxInput);
        } else {
          const input = document.createElement('input');
          input.type = 'number';
          input.min = fieldDef.min || 0;
          input.max = fieldDef.max || 1000;
          input.value = condition.value || '';
          input.className = 'qb-numeric-input';
          input.addEventListener('change', () => {
            condition.value = Number(input.value);
            this.updateLivePreview();
          });
          container.appendChild(input);
        }
        break;

      case 'dateRange':
        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.className = 'qb-date-input';
        const endInput = document.createElement('input');
        endInput.type = 'date';
        endInput.className = 'qb-date-input';

        if (condition.value && Array.isArray(condition.value)) {
          startInput.value = condition.value[0] || '';
          endInput.value = condition.value[1] || '';
        }

        startInput.addEventListener('change', () => {
          condition.value = [startInput.value, endInput.value];
          this.updateLivePreview();
        });
        endInput.addEventListener('change', () => {
          condition.value = [startInput.value, endInput.value];
          this.updateLivePreview();
        });

        container.appendChild(startInput);
        container.appendChild(document.createTextNode(' to '));
        container.appendChild(endInput);
        break;

      default:
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = condition.value || '';
        textInput.placeholder = 'Enter value...';
        textInput.addEventListener('change', () => {
          condition.value = textInput.value;
          this.updateLivePreview();
        });
        container.appendChild(textInput);
    }

    return container;
  }

  /**
   * Remove a condition row
   */
  removeCondition(conditionId) {
    this.conditions = this.conditions.filter(c => c.id !== conditionId);
    const conditionEl = document.getElementById(`condition-${conditionId}`);
    if (conditionEl) conditionEl.remove();
    this.updateLivePreview();
  }

  /**
   * Refresh a condition's UI (update operator/value selectors when field changes)
   */
  refreshCondition(condition) {
    const conditionEl = document.getElementById(`condition-${condition.id}`);
    if (!conditionEl) return;

    const operatorSelect = conditionEl.querySelector('.qb-operator-select');
    const valueInputDiv = conditionEl.querySelector('.qb-value-input');

    if (operatorSelect) operatorSelect.replaceWith(this.createOperatorSelect(condition));
    if (valueInputDiv) valueInputDiv.replaceWith(this.createValueInput(condition));
  }

  /**
   * Clear all conditions and start fresh
   */
  clearAllConditions() {
    this.conditions = [];
    const container = document.getElementById('conditionsContainer');
    if (container) container.innerHTML = '';
    this.addCondition();
    this.updateLivePreview();
  }

  /**
   * Update live preview count of matching records
   */
  async updateLivePreview() {
    const previewCount = document.getElementById('previewCount');
    if (!previewCount) return;

    previewCount.textContent = 'Matching records: calculating...';

    try {
      const countResult = await this.getMatchingCount();
      this.livePreviewCount = countResult;
      previewCount.textContent = `Matching records: ${countResult}`;

      // Enable/disable generate button based on matches
      const generateBtn = document.getElementById('generateReportBtn');
      if (generateBtn) {
        generateBtn.disabled = countResult === 0;
      }
    } catch (error) {
      console.error('Error updating live preview:', error);
      previewCount.textContent = 'Error calculating matches';
    }
  }

  /**
   * Get matching record count from backend
   */
  async getMatchingCount() {
    try {
      const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'queryBuilderPreview',
          filters: this.buildFilterObject(),
          logic: this.logicOperator
        })
      });

      const result = await response.json();
      return result.count || 0;
    } catch (error) {
      console.error('Error in getMatchingCount:', error);
      return 0;
    }
  }

  /**
   * Build filter object from current conditions
   */
  buildFilterObject() {
    return {
      conditions: this.conditions.map(c => ({
        field: c.field,
        operator: c.operator,
        value: c.value
      })),
      logic: this.logicOperator
    };
  }

  /**
   * Generate the custom report based on filters
   */
  async generateReport() {
    const filterObj = this.buildFilterObject();
    console.log('Generating report with filters:', filterObj);

    // Trigger custom report generation (delegated to customReports.js)
    if (window.CustomReports) {
      window.CustomReports.generateCustomFilteredList(filterObj);
    }
  }

  /**
   * Save current filter as a preset
   */
  savePreset() {
    const presetName = document.getElementById('presetName')?.value;
    if (!presetName) {
      alert('Please enter a name for this filter');
      return;
    }

    const presetData = {
      name: presetName,
      filters: this.buildFilterObject(),
      createdAt: new Date().toISOString()
    };

    this.presets.set(presetName, presetData);
    localStorage.setItem(`preset_${presetName}`, JSON.stringify(presetData));
    alert(`Filter saved as: ${presetName}`);
    document.getElementById('presetName').value = '';
  }

  /**
   * Load a saved preset
   */
  loadPreset() {
    const presetName = prompt('Enter preset name to load:');
    if (!presetName) return;

    const presetData = this.presets.get(presetName) || 
                       JSON.parse(localStorage.getItem(`preset_${presetName}`));

    if (!presetData) {
      alert('Preset not found');
      return;
    }

    // Rebuild conditions from preset
    this.conditions = presetData.filters.conditions.map((c, idx) => ({
      ...c,
      id: idx
    }));
    this.conditionIdCounter = this.conditions.length;
    this.logicOperator = presetData.filters.logic;

    // Re-render UI
    const container = document.getElementById('conditionsContainer');
    if (container) container.innerHTML = '';
    this.conditions.forEach(c => this.renderCondition(c));

    // Update logic button
    document.querySelectorAll('.logic-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.logic === this.logicOperator);
    });

    this.updateLivePreview();
  }

  /**
   * Close the query builder modal
   */
  close() {
    const modal = document.getElementById('advancedAnalyticsModal');
    if (modal) {
      modal.querySelector('.modal-overlay')?.click();
    }
  }

  /**
   * Get the current filter configuration as JSON
   */
  getFilterConfig() {
    return this.buildFilterObject();
  }
}

// Export for use in other modules
window.QueryBuilder = QueryBuilder;
