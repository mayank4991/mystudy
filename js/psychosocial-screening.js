/**
 * Psychosocial Screening Module for Epilepsy Patients
 * Implements NDDI-E (Neurological Disorders Depression Inventory for Epilepsy)
 * Separate from CDS - focused on mental health screening at fixed milestones
 */

class PsychosocialScreening {
  constructor() {
    this.lastChecked = null;
    this.currentPatient = null;
    this.cacheExpiryMs = 5 * 60 * 1000; // 5 minute cache
    
    // NDDI-E Question Bank
    this.nddiEQuestions = [
      { id: 1, text: 'Everything is a struggle', aliases: ['struggle', 'difficult'] },
      { id: 2, text: 'Nothing I do is right', aliases: ['nothing_right', 'failure'] },
      { id: 3, text: 'Feel guilty', aliases: ['guilt', 'guilty'] },
      { id: 4, text: 'I\'d be better off dead', aliases: ['suicidal', 'death', 'better_off_dead'], isCritical: true },
      { id: 5, text: 'Frustrated', aliases: ['frustration', 'irritable'] },
      { id: 6, text: 'Difficulty finding pleasure', aliases: ['pleasure', 'anhedonia', 'no_joy'] }
    ];
    
    this.likertScale = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'];
    this.likertValues = { 'Never': 1, 'Rarely': 2, 'Sometimes': 3, 'Often': 4, 'Always': 5 };
  }

  /**
   * Check if screening is due based on patient registration and visit dates
   * Rule: Screening is due ±25 days around 6-month and 1-year milestones
   * @param {Object} patientContext - Patient context with registration and visit dates
   * @returns {Object} { isDue: boolean, milestone: '6mo'|'1yr'|null, daysUntilDue: number, reason: string }
   */
  isScreeningDue(patientContext) {
    if (!patientContext || patientContext.demographics?.age < 18) {
      return { isDue: false, milestone: null, daysUntilDue: null, reason: 'Patient is under 18 years old' };
    }

    const followUp = patientContext.followUp || {};
    const isRoutineReview = !followUp.emergencyVisit && !followUp.acuteSeizure;
    
    if (!isRoutineReview) {
      return { isDue: false, milestone: null, daysUntilDue: null, reason: 'Not a routine follow-up visit' };
    }

    const registrationDate = this._parseDate(
      patientContext.registrationDate || 
      patientContext.rawForm?.RegistrationDate ||
      patientContext.rawForm?.registrationDate
    );
    
    const visitDate = this._parseDate(
      followUp.followUpDate ||
      patientContext.rawForm?.FollowUpDate ||
      patientContext.rawForm?.SubmissionDate
    ) || new Date();

    if (!registrationDate) {
      return { isDue: false, milestone: null, daysUntilDue: null, reason: 'Registration date not found' };
    }

    const daysSinceRegistration = Math.round((visitDate - registrationDate) / (24 * 60 * 60 * 1000));
    const tolerance = 25; // ±25 days around milestone

    // Check for 6-month milestone (180 days)
    const daysUntil6mo = 180 - daysSinceRegistration;
    if (Math.abs(daysUntil6mo) <= tolerance) {
      return { isDue: true, milestone: '6mo', daysUntilDue: daysUntil6mo, reason: 'At 6-month milestone' };
    }

    // Check for 1-year milestone (365 days)
    const daysUntil1yr = 365 - daysSinceRegistration;
    if (Math.abs(daysUntil1yr) <= tolerance) {
      return { isDue: true, milestone: '1yr', daysUntilDue: daysUntil1yr, reason: 'At 1-year milestone' };
    }

    return { isDue: false, milestone: null, daysUntilDue: Math.min(Math.abs(daysUntil6mo), Math.abs(daysUntil1yr)), reason: 'Not at screening milestone' };
  }

  /**
   * Get next scheduled screening date for a patient
   * @param {Object} patientContext - Patient context
   * @returns {Date|null} Next screening date or null if not applicable
   */
  getNextScreeningDate(patientContext) {
    const registrationDate = this._parseDate(patientContext.registrationDate);
    if (!registrationDate) return null;

    const lastScreeningDate = this._parseDate(
      patientContext.lastPsychScreeningDate ||
      patientContext.NDDIEScreeningDate
    );

    // If no prior screening, next is at 6 months
    if (!lastScreeningDate) {
      const nextDate = new Date(registrationDate);
      nextDate.setMonth(nextDate.getMonth() + 6);
      return nextDate;
    }

    // If last screening was at 6 months, next is at 1 year
    const daysSinceLastScreening = Math.round((new Date() - lastScreeningDate) / (24 * 60 * 60 * 1000));
    if (daysSinceLastScreening < 200) { // Recent 6-month screening
      const nextDate = new Date(registrationDate);
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      return nextDate;
    }

    // Default: repeat annually after 1-year milestone
    const nextDate = new Date(lastScreeningDate);
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    return nextDate;
  }

  /**
   * Calculate NDDI-E score from responses
   * @param {Array} responses - Array of 6 responses (order: Q1-Q6), each value 1-5
   * @returns {Object} { totalScore: number, interpretation: string, requiresReferral: boolean, suicidalityFlag: boolean }
   */
  calculateNDDIEScore(responses) {
    if (!Array.isArray(responses) || responses.length !== 6) {
      return { totalScore: null, interpretation: 'Invalid response format', requiresReferral: false, suicidalityFlag: false };
    }

    // Validate all responses are 1-5
    const validResponses = responses.every(r => Number.isInteger(r) && r >= 1 && r <= 5);
    if (!validResponses) {
      return { totalScore: null, interpretation: 'Invalid response values (must be 1-5)', requiresReferral: false, suicidalityFlag: false };
    }

    const totalScore = responses.reduce((sum, val) => sum + val, 0);
    
    // Check for suicidal ideation (Q4: "I'd be better off dead")
    // Critical if answered 3-5 (Sometimes, Often, Always)
    const suicidalityFlag = responses[3] >= 3;

    // Interpretation thresholds
    let interpretation = '';
    let requiresReferral = false;

    if (totalScore <= 6) {
      interpretation = 'No significant depressive symptoms';
      requiresReferral = false;
    } else if (totalScore <= 13) {
      interpretation = 'Mild depressive symptoms - monitor and support';
      requiresReferral = false;
    } else if (totalScore <= 20) {
      interpretation = 'Moderate depressive symptoms - consider psychiatric evaluation';
      requiresReferral = true;
    } else {
      interpretation = 'Severe depressive symptoms - strongly recommend psychiatric evaluation';
      requiresReferral = true;
    }

    return {
      totalScore: totalScore,
      interpretation: interpretation,
      requiresReferral: requiresReferral,
      suicidalityFlag: suicidalityFlag
    };
  }

  /**
   * Format response for display in UI
   * @param {number} value - Numeric response (1-5)
   * @returns {string} Human-readable response
   */
  formatResponse(value) {
    return this.likertScale[Math.max(0, Math.min(4, value - 1))] || 'Unknown';
  }

  /**
   * Get safe alert message for suicidal ideation
   * @returns {Object} Alert object for UI display
   */
  getSuicidalityAlert() {
    return {
      id: 'nddie_suicidality_critical',
      severity: 'critical',
      title: '🚨 IMMEDIATE SAFETY CONCERN: Suicidal Ideation Detected',
      text: 'Patient responded "Sometimes", "Often", or "Always" to "I\'d be better off dead". This indicates suicidal ideation and requires immediate intervention.',
      nextSteps: [
        'URGENT: Initiate comprehensive suicide risk assessment',
        'Develop immediate safety plan with patient and caregiver',
        'Refer to crisis intervention team or mental health specialist immediately',
        'Contact psychiatry for emergency evaluation',
        'Document completed assessment in patient record',
        'If imminent risk: Call emergency services (911 in USA) or crisis hotline',
        'Schedule follow-up within 24 hours'
      ],
      category: 'mental_health_crisis',
      displayAlert: true,
      requiresSignoff: true
    };
  }

  /**
   * Record NDDI-E screening response
   * @param {Object} data - { patientId, responses: [1-5 x 6], visitDate, registrationDate }
   * @returns {Promise<Object>} { success: boolean, message: string, scoreData: Object }
   */
  async recordNDDIEScreening(data) {
    if (!data.patientId || !Array.isArray(data.responses)) {
      return { success: false, message: 'Invalid screening data' };
    }

    const scoreData = this.calculateNDDIEScore(data.responses);
    
    if (scoreData.totalScore === null) {
      return { success: false, message: scoreData.interpretation };
    }

    try {
      // Call backend to save screening
      const result = await window.makeAPICall('recordNDDIEScreening', {
        patientId: data.patientId,
        responses: data.responses,
        totalScore: scoreData.totalScore,
        visitDate: data.visitDate || new Date().toISOString(),
        suicidalityFlag: scoreData.suicidalityFlag,
        interpretation: scoreData.interpretation
      });

      if (result.status === 'success') {
        window.Logger.debug('NDDI-E screening recorded successfully:', scoreData);
        return { success: true, message: 'Screening recorded', scoreData: scoreData };
      } else {
        return { success: false, message: result.message || 'Failed to save screening' };
      }
    } catch (error) {
      window.Logger.error('Error recording NDDI-E screening:', error);
      return { success: false, message: 'Error saving screening: ' + error.message };
    }
  }

  /**
   * Parse date from various formats
   * @private
   */
  _parseDate(value) {
    if (!value) return null;
    
    try {
      // Try parseFlexibleDate if available
      if (typeof window.parseFlexibleDate === 'function') {
        const parsed = window.parseFlexibleDate(value);
        if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
      }
    } catch (e) {
      // Ignore parse errors
    }

    // Try ISO format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return null;
  }
}

// Initialize globally
window.psychosocialScreening = new PsychosocialScreening();
window.Logger && window.Logger.debug('Psychosocial Screening module loaded');
