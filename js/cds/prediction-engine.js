/**
 * prediction-engine.js — Client-side Prediction API client & data preparation
 * Handles communication with PredictionService.gs backend and provides
 * instant local feature computation for progressive rendering.
 *
 * v1.1.0 — Parallel model streaming, offline fallback, outcome validation,
 *           role-based requests, enhanced data handling
 *
 * @version 1.1.0
 */

(function() {
  'use strict';

  function _t(key, params) {
    return window.EpicareI18n && window.EpicareI18n.translate ? window.EpicareI18n.translate(key, params) : key;
  }

  // ──────────────────────────────────────────────────────────────────
  // §1  Constants & Configuration
  // ──────────────────────────────────────────────────────────────────

  var ALL_MODELS = ['seizureFreedom', 'dreRisk', 'adherence', 'sudepRisk', 'treatmentResponse'];

  var _cache = {};
  var _cacheTTL = 5 * 60 * 1000; // 5 minutes
  var _pendingRequests = {};
  var _REQUEST_TIMEOUT = 30000; // 30s per model

  // ──────────────────────────────────────────────────────────────────
  // §2  PredictionEngine — API Client
  // ──────────────────────────────────────────────────────────────────

  window.PredictionEngine = {

    MODEL_VERSION: '1.1.0',
    MIN_FOLLOWUPS_FOR_PREDICTIONS: 1,  // backend now validates per-model
    ALL_MODELS: ALL_MODELS,

    /**
     * Fetch ALL predictions at once (legacy single-request mode).
     * Uses in-memory cache with 5-minute TTL.
     * Deduplicates concurrent requests for the same patient.
     *
     * @param {string} patientId
     * @param {Object} [opts] - { role?: string }
     * @returns {Promise<Object>} Prediction result
     */
    fetchPredictions: function(patientId, opts) {
      opts = opts || {};
      var cacheKey = 'pred_all_' + patientId;

      // Check cache
      var cached = _cache[cacheKey];
      if (cached && (Date.now() - cached.timestamp) < _cacheTTL) {
        return Promise.resolve(cached.data);
      }

      // Deduplicate in-flight requests
      if (_pendingRequests[cacheKey]) {
        return _pendingRequests[cacheKey];
      }

      var promise = new Promise(function(resolve, reject) {
        var timeoutId = setTimeout(function() {
          reject(new Error('Prediction request timed out after 30 seconds'));
        }, _REQUEST_TIMEOUT);

        if (typeof window.makeAPICall !== 'function') {
          clearTimeout(timeoutId);
          reject(new Error('API client not available'));
          return;
        }

        var payload = { patientId: patientId };
        if (opts.role) payload.role = opts.role;

        window.makeAPICall('cdsPredictions', payload)
          .then(function(response) {
            clearTimeout(timeoutId);
            if (response && response.status === 'success' && response.data) {
              _cache[cacheKey] = { data: response.data, timestamp: Date.now() };
              resolve(response.data);
            } else {
              reject(new Error((response && response.message) || 'Prediction request failed'));
            }
          })
          .catch(function(err) {
            clearTimeout(timeoutId);
            reject(err);
          });
      });

      _pendingRequests[cacheKey] = promise;
      promise.finally(function() { delete _pendingRequests[cacheKey]; });
      return promise;
    },

    /**
     * Fetch predictions one model at a time (parallel streaming mode).
     * Fires an onModel callback as soon as each model resolves.
     *
     * @param {string} patientId
     * @param {Object} opts - { role?, onModel: function(modelName, data, error), onComplete: function(fullResult) }
     * @returns {Promise<Object>} Merged result after all models complete
     */
    fetchPredictionsStreaming: function(patientId, opts) {
      opts = opts || {};
      var role = opts.role || '';
      var onModel = typeof opts.onModel === 'function' ? opts.onModel : function() {};
      var onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : function() {};

      // Check full cache first
      var cacheKey = 'pred_all_' + patientId;
      var cached = _cache[cacheKey];
      if (cached && (Date.now() - cached.timestamp) < _cacheTTL) {
        ALL_MODELS.forEach(function(m) {
          onModel(m, cached.data, null);
        });
        onComplete(cached.data);
        return Promise.resolve(cached.data);
      }

      if (typeof window.makeAPICall !== 'function') {
        var err = new Error('API client not available');
        ALL_MODELS.forEach(function(m) { onModel(m, null, err); });
        return Promise.reject(err);
      }

      var mergedResult = {
        predictions: {},
        validation: {},
        modelVersions: {},
        cohortQuality: null,
        timeToEvent: null,
        drugComparisons: null,
        metadata: { modelsRequested: ALL_MODELS.length, modelsCompleted: 0, modelsSkipped: 0, modelsFailed: 0 }
      };

      var promises = ALL_MODELS.map(function(modelName) {
        return new Promise(function(resolve) {
          var perModelCacheKey = 'pred_' + modelName + '_' + patientId;
          var mc = _cache[perModelCacheKey];
          if (mc && (Date.now() - mc.timestamp) < _cacheTTL) {
            _mergeModelResult(mergedResult, modelName, mc.data);
            onModel(modelName, mc.data, null);
            resolve();
            return;
          }

          var timeout = setTimeout(function() {
            onModel(modelName, null, new Error('timeout'));
            mergedResult.metadata.modelsFailed++;
            resolve();
          }, _REQUEST_TIMEOUT);

          window.makeAPICall('cdsPredictions', { patientId: patientId, models: modelName, role: role })
            .then(function(response) {
              clearTimeout(timeout);
              if (response && response.status === 'success' && response.data) {
                _cache[perModelCacheKey] = { data: response.data, timestamp: Date.now() };
                _mergeModelResult(mergedResult, modelName, response.data);
                onModel(modelName, response.data, null);
              } else {
                onModel(modelName, null, new Error((response && response.message) || 'failed'));
                mergedResult.metadata.modelsFailed++;
              }
              resolve();
            })
            .catch(function(err) {
              clearTimeout(timeout);
              onModel(modelName, null, err);
              mergedResult.metadata.modelsFailed++;
              resolve();
            });
        });
      });

      return Promise.all(promises).then(function() {
        mergedResult.metadata.modelsCompleted = ALL_MODELS.length - mergedResult.metadata.modelsFailed;
        // Cache the merged result
        _cache[cacheKey] = { data: mergedResult, timestamp: Date.now() };
        onComplete(mergedResult);
        return mergedResult;
      });
    },

    /**
     * Invalidate cached predictions for a patient.
     * Call this after submitting a new follow-up.
     * @param {string} patientId
     */
    invalidateCache: function(patientId) {
      Object.keys(_cache).forEach(function(key) {
        if (key.indexOf(patientId) !== -1) delete _cache[key];
      });
    },

    /** Clear entire prediction cache. */
    clearCache: function() { _cache = {}; },

    /**
     * Check if a patient has enough data for meaningful predictions.
     * Now returns per-model sufficiency based on backend requirements.
     * @param {Array} followUps
     * @returns {Object} { sufficient, message, followUpCount, perModel }
     */
    checkDataSufficiency: function(followUps) {
      var count = (followUps || []).length;
      var perModel = {};

      // Client-side minimum requirements mirror backend MODEL_REQUIREMENTS
      var reqs = {
        seizureFreedom: { min: 2, minDays: 30 },
        dreRisk:        { min: 1, minDays: 0 },
        adherence:      { min: 3, minDays: 60 },
        sudepRisk:      { min: 1, minDays: 0 },
        treatmentResponse: { min: 2, minDays: 30 }
      };

      var daySpan = 0;
      if (count >= 2) {
        var dates = [];
        (followUps || []).forEach(function(fu) {
          var d = _parseDate(fu.FollowUpDate || fu.followUpDate || '');
          if (d) dates.push(d.getTime());
        });
        dates.sort(function(a, b) { return a - b; });
        if (dates.length >= 2) {
          daySpan = Math.round((dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24));
        }
      }

      var anyValid = false;
      ALL_MODELS.forEach(function(m) {
        var r = reqs[m];
        var valid = count >= r.min && daySpan >= r.minDays;
        perModel[m] = {
          sufficient: valid,
          currentFollowUps: count,
          required: r.min,
          currentDays: daySpan,
          requiredDays: r.minDays
        };
        if (valid) anyValid = true;
      });

      if (count === 0) {
        return {
          sufficient: false,
          message: _t('prediction.insufficientData.noFollowUps'),
          followUpCount: count,
          perModel: perModel
        };
      }
      if (!anyValid) {
        return {
          sufficient: false,
          message: _t('prediction.insufficientData.needMore', { count: count }),
          followUpCount: count,
          perModel: perModel
        };
      }
      return {
        sufficient: true,
        message: count + ' follow-ups available — predictions can be generated.',
        followUpCount: count,
        perModel: perModel
      };
    },

    // ──────────────────────────────────────────────────────────────
    // §2b  Outcome Validation API Methods
    // ──────────────────────────────────────────────────────────────

    /**
     * Submit outcome validation for a prediction.
     * @param {string} predictionId
     * @param {string} actualOutcome
     * @param {Object} [opts] - { outcomeDate?, notes? }
     * @returns {Promise<Object>}
     */
    validateOutcome: function(predictionId, actualOutcome, opts) {
      opts = opts || {};
      return new Promise(function(resolve, reject) {
        if (typeof window.makeAPICall !== 'function') {
          return reject(new Error('API client not available'));
        }
        window.makeAPICall('validatePredictionOutcome', {
          predictionId: predictionId,
          actualOutcome: actualOutcome,
          outcomeDate: opts.outcomeDate || '',
          notes: opts.notes || ''
        }).then(function(resp) {
          if (resp && resp.status === 'success') resolve(resp.data || resp);
          else reject(new Error((resp && resp.message) || 'Validation failed'));
        }).catch(reject);
      });
    },

    /**
     * Get prediction + outcome history for a patient.
     * @param {string} patientId
     * @returns {Promise<Object>}
     */
    getPredictionHistory: function(patientId) {
      return new Promise(function(resolve, reject) {
        if (typeof window.makeAPICall !== 'function') {
          return reject(new Error('API client not available'));
        }
        window.makeAPICall('getPredictionHistory', { patientId: patientId })
          .then(function(resp) {
            if (resp && resp.status === 'success') resolve(resp.data || { predictions: [] });
            else reject(new Error((resp && resp.message) || 'History fetch failed'));
          }).catch(reject);
      });
    },

    /**
     * Get model performance summary (admin).
     * @returns {Promise<Object>}
     */
    getModelPerformance: function() {
      return new Promise(function(resolve, reject) {
        if (typeof window.makeAPICall !== 'function') {
          return reject(new Error('API client not available'));
        }
        window.makeAPICall('getModelPerformanceSummary', {})
          .then(function(resp) {
            if (resp && resp.status === 'success') resolve(resp.data || {});
            else reject(new Error((resp && resp.message) || 'Performance fetch failed'));
          }).catch(reject);
      });
    },

    // ──────────────────────────────────────────────────────────────
    // §2c  Offline Fallback — Local Probability Estimates
    // ──────────────────────────────────────────────────────────────

    /**
     * Generate offline prediction estimates using local patient data.
     * Returns simplified, lower-confidence predictions when server is unreachable.
     *
     * @param {Object} patient
     * @param {Array} followUps
     * @returns {Object} Prediction-like result with offline quality indicators
     */
    generateOfflinePredictions: function(patient, followUps) {
      var fus = followUps || [];
      var result = {
        patientId: patient.PatientID || patient.patientId || 'unknown',
        offline: true,
        offlineNotice: _t('prediction.offlineNotice'),
        generatedAt: new Date().toISOString(),
        predictions: {},
        metadata: { source: 'offline-local', modelsCompleted: 0, modelsSkipped: 0 }
      };

      var stats = window.PredictionDataPrep.computeQuickStats(patient, fus);

      // Seizure Freedom — simple trend-based estimate
      if (fus.length >= 2) {
        var szTrend = stats.seizureTrend;
        var lastSz = szTrend.lastValue || 0;
        var prob = 0;
        if (lastSz === 0) prob = 70;
        else if (szTrend.direction === 'improving') prob = 45;
        else if (szTrend.direction === 'stable') prob = 25;
        else prob = 15;

        result.predictions.seizureFreedom = {
          probabilityPercent: prob,
          confidenceInterval: { lower: Math.max(0, prob - 25), upper: Math.min(100, prob + 25) },
          offlineEstimate: true,
          features: [
            { name: _t('prediction.feature.seizureTrend'), value: szTrend.direction, impact: szTrend.direction === 'improving' ? 'positive' : 'negative' },
            { name: _t('prediction.feature.lastSeizureCount'), value: lastSz, impact: lastSz === 0 ? 'positive' : 'negative' }
          ]
        };
        result.metadata.modelsCompleted++;
      } else {
        result.predictions.seizureFreedom = { status: 'insufficient_data', offlineEstimate: true };
        result.metadata.modelsSkipped++;
      }

      // SUDEP Risk — static factor scoring
      var sudepScore = 20; // baseline
      var age = parseInt(patient.Age || patient.age || '0', 10);
      if (age > 0 && age < 30) sudepScore += 10;
      var epilepsyType = String(patient.EpilepsyType || patient.epilepsyType || '').toLowerCase();
      if (/generalized|tonic.clonic|gtcs/i.test(epilepsyType)) sudepScore += 15;
      if (stats.seizureTrend.lastValue > 5) sudepScore += 15;
      if (stats.adherenceHistory.currentScore && stats.adherenceHistory.currentScore <= 2) sudepScore += 10;
      sudepScore = Math.min(sudepScore, 100);

      result.predictions.sudepRisk = {
        score: sudepScore,
        riskLevel: sudepScore >= 60 ? 'High' : (sudepScore >= 35 ? 'Moderate' : 'Low'),
        offlineEstimate: true,
        features: [
          { name: _t('prediction.feature.age'), value: age, impact: (age > 0 && age < 30) ? 'risk-increasing' : 'neutral' },
          { name: _t('prediction.feature.seizureLoad'), value: stats.seizureTrend.lastValue || 0, impact: (stats.seizureTrend.lastValue || 0) > 5 ? 'risk-increasing' : 'neutral' }
        ]
      };
      result.metadata.modelsCompleted++;

      // Adherence — trend-based
      if (fus.length >= 3) {
        var adhTrend = stats.adherenceHistory;
        var adhProb = 50;
        if (adhTrend.currentScore >= 4) adhProb = 75;
        else if (adhTrend.currentScore >= 3) adhProb = 55;
        else if (adhTrend.currentScore >= 2) adhProb = 35;
        else adhProb = 20;
        if (adhTrend.direction === 'declining') adhProb -= 10;
        if (adhTrend.direction === 'improving') adhProb += 10;
        adhProb = Math.max(10, Math.min(90, adhProb));

        result.predictions.adherence = {
          probabilityPercent: adhProb,
          predictedAdherence: adhProb >= 60 ? 'Good' : (adhProb >= 40 ? 'At Risk' : 'Poor'),
          offlineEstimate: true,
          features: [
            { name: _t('prediction.feature.currentScore'), value: adhTrend.currentScore, impact: adhTrend.currentScore >= 3 ? 'positive' : 'negative' },
            { name: _t('prediction.feature.trend'), value: adhTrend.direction, impact: adhTrend.direction === 'declining' ? 'negative' : 'positive' }
          ]
        };
        result.metadata.modelsCompleted++;
      } else {
        result.predictions.adherence = { status: 'insufficient_data', offlineEstimate: true };
        result.metadata.modelsSkipped++;
      }

      // DRE Risk — simplified
      if (fus.length >= 1) {
        var dreScore = 15;
        var medCount = stats.medicationCount || 0;
        if (medCount >= 3) dreScore += 25;
        else if (medCount >= 2) dreScore += 10;
        if (stats.seizureTrend.average > 3) dreScore += 15;
        if (stats.seizureTrend.direction === 'worsening') dreScore += 10;
        dreScore = Math.min(dreScore, 100);

        result.predictions.dreRisk = {
          score: dreScore,
          riskLevel: dreScore >= 50 ? 'High' : (dreScore >= 30 ? 'Moderate' : 'Low'),
          offlineEstimate: true,
          features: [
            { name: _t('prediction.feature.medicationCount'), value: medCount, impact: medCount >= 3 ? 'risk-increasing' : 'neutral' },
            { name: _t('prediction.feature.seizureTrend'), value: stats.seizureTrend.direction, impact: stats.seizureTrend.direction === 'worsening' ? 'risk-increasing' : 'neutral' }
          ]
        };
        result.metadata.modelsCompleted++;
      } else {
        result.predictions.dreRisk = { status: 'insufficient_data', offlineEstimate: true };
        result.metadata.modelsSkipped++;
      }

      // Treatment Response — simplified
      if (fus.length >= 2 && stats.medicationCount > 0) {
        result.predictions.treatmentResponse = {
          medications: [{ name: _t('prediction.feature.currentRegimen'), trend: stats.seizureTrend.direction, offlineEstimate: true }],
          offlineEstimate: true
        };
        result.metadata.modelsCompleted++;
      } else {
        result.predictions.treatmentResponse = { status: 'insufficient_data', offlineEstimate: true };
        result.metadata.modelsSkipped++;
      }

      return result;
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // §3  Merge helper for streaming mode
  // ──────────────────────────────────────────────────────────────────

  function _mergeModelResult(merged, modelName, singleResult) {
    if (!singleResult) return;
    if (singleResult.predictions && singleResult.predictions[modelName]) {
      merged.predictions[modelName] = singleResult.predictions[modelName];
      merged.metadata.modelsCompleted++;
    }
    if (singleResult.validation && singleResult.validation[modelName]) {
      merged.validation[modelName] = singleResult.validation[modelName];
    }
    if (singleResult.modelVersions && singleResult.modelVersions[modelName]) {
      merged.modelVersions[modelName] = singleResult.modelVersions[modelName];
    }
    // These are shared across models — take from any response
    if (singleResult.cohortQuality && !merged.cohortQuality) {
      merged.cohortQuality = singleResult.cohortQuality;
    }
    if (singleResult.timeToEvent && !merged.timeToEvent) {
      merged.timeToEvent = singleResult.timeToEvent;
    }
    if (singleResult.drugComparisons && !merged.drugComparisons) {
      merged.drugComparisons = singleResult.drugComparisons;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // §2  PredictionDataPrep — Local Feature Computation
  // ──────────────────────────────────────────────────────────────────

  window.PredictionDataPrep = {

    /**
     * Compute seizure frequency trend from follow-ups (client-side).
     * Used for instant sparkline rendering while backend loads.
     *
     * @param {Array} followUps - Patient follow-ups (sorted ascending by date)
     * @returns {Object} { values: [{date, freq}], slope, r2, direction }
     */
    computeSeizureTrend: function(followUps) {
      var values = [];

      (followUps || []).forEach(function(fu) {
        var date = fu.FollowUpDate || fu.followUpDate || '';
        var freq = _parseSeizureCount(fu.SeizureFrequency || fu.seizureFrequency || '');
        values.push({ date: date, freq: freq });
      });

      var nums = values.map(function(v) { return v.freq; });
      var trend = _linearRegression(nums);

      return {
        values: values,
        slope: trend.slope,
        r2: trend.r2,
        direction: trend.slope < -0.3 ? 'improving' : (trend.slope > 0.3 ? 'worsening' : 'stable'),
        lastValue: nums.length > 0 ? nums[nums.length - 1] : null,
        average: nums.length > 0 ? (nums.reduce(function(a, b) { return a + b; }, 0) / nums.length) : null
      };
    },

    /**
     * Compute adherence trajectory from follow-ups (client-side).
     * @param {Array} followUps
     * @returns {Object} { scores: [{date, score, label}], slope, direction, currentScore }
     */
    computeAdherenceHistory: function(followUps) {
      var scores = [];

      (followUps || []).forEach(function(fu) {
        var label = fu.TreatmentAdherence || fu.treatmentAdherence || '';
        var score = _adherenceToScore(label);
        if (score > 0) {
          scores.push({
            date: fu.FollowUpDate || fu.followUpDate || '',
            score: score,
            label: label
          });
        }
      });

      var nums = scores.map(function(s) { return s.score; });
      var trend = _linearRegression(nums);

      return {
        scores: scores,
        slope: trend.slope,
        direction: trend.slope > 0.15 ? 'improving' : (trend.slope < -0.15 ? 'declining' : 'stable'),
        currentScore: nums.length > 0 ? nums[nums.length - 1] : null,
        averageScore: nums.length > 0 ? Math.round((nums.reduce(function(a, b) { return a + b; }, 0) / nums.length) * 100) / 100 : null
      };
    },

    /**
     * Compute follow-up attendance regularity.
     * @param {Array} followUps
     * @returns {Object} { intervals: [], avgInterval, stdDev, isRegular }
     */
    computeFollowUpRegularity: function(followUps) {
      var dates = [];
      (followUps || []).forEach(function(fu) {
        var d = _parseDate(fu.FollowUpDate || fu.followUpDate || '');
        if (d) dates.push(d.getTime());
      });

      dates.sort(function(a, b) { return a - b; });

      if (dates.length < 2) {
        return { intervals: [], avgInterval: null, stdDev: null, isRegular: null };
      }

      var intervals = [];
      for (var i = 1; i < dates.length; i++) {
        intervals.push(Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24)));
      }

      var avg = intervals.reduce(function(a, b) { return a + b; }, 0) / intervals.length;
      var variance = intervals.reduce(function(s, v) { return s + Math.pow(v - avg, 2); }, 0) / intervals.length;
      var stdDev = Math.sqrt(variance);

      return {
        intervals: intervals,
        avgInterval: Math.round(avg),
        stdDev: Math.round(stdDev),
        isRegular: stdDev < 20 // less than 20-day standard deviation = regular
      };
    },

    /**
     * Extract quick summary statistics from patient + follow-ups
     * for immediate display while backend loads.
     *
     * @param {Object} patient
     * @param {Array} followUps
     * @returns {Object} Quick stats
     */
    computeQuickStats: function(patient, followUps) {
      var szTrend = this.computeSeizureTrend(followUps);
      var adhHistory = this.computeAdherenceHistory(followUps);
      var regularity = this.computeFollowUpRegularity(followUps);

      var meds = [];
      try {
        var medRaw = patient.Medications || patient.medications || '';
        if (typeof medRaw === 'string' && medRaw.trim()) {
          if (medRaw.charAt(0) === '[') {
            meds = JSON.parse(medRaw);
          } else {
            meds = medRaw.split(/[;\n]+/).filter(function(s) { return s.trim(); });
          }
        } else if (Array.isArray(medRaw)) {
          meds = medRaw;
        }
      } catch (e) {}

      return {
        seizureTrend: szTrend,
        adherenceHistory: adhHistory,
        followUpRegularity: regularity,
        medicationCount: meds.length,
        followUpCount: (followUps || []).length,
        lastFollowUpDate: followUps && followUps.length > 0
          ? (followUps[followUps.length - 1].FollowUpDate || followUps[followUps.length - 1].followUpDate || '')
          : null
      };
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // §3  Private Helpers
  // ──────────────────────────────────────────────────────────────────

  function _parseSeizureCount(val) {
    if (val === null || val === undefined) return 0;
    var s = String(val).trim().toLowerCase();
    if (!s || s === 'none' || s === 'nil' || s === '0' || s === 'no seizures' || s === 'seizure free' || s === 'seizure-free') return 0;
    var n = parseFloat(s);
    if (!isNaN(n)) return Math.max(0, Math.round(n));
    var rangeMatch = s.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (rangeMatch) return Math.round((parseInt(rangeMatch[1], 10) + parseInt(rangeMatch[2], 10)) / 2);
    if (/daily|every day/i.test(s)) return 30;
    if (/weekly|every week/i.test(s)) return 8;
    if (/monthly/i.test(s)) return 2;
    if (/rare|occasional/i.test(s)) return 1;
    return 0;
  }

  function _adherenceToScore(label) {
    if (!label) return 0;
    var l = String(label).toLowerCase().trim();
    if (/always|perfect|never miss|good/i.test(l)) return 4;
    if (/occasionally|sometimes|fair/i.test(l)) return 3;
    if (/frequently|often miss|poor/i.test(l)) return 2;
    if (/stop|completely|not taking/i.test(l)) return 1;
    return 0;
  }

  function _linearRegression(values) {
    if (!values || values.length < 2) {
      return { slope: 0, intercept: values && values.length === 1 ? values[0] : 0, r2: 0 };
    }
    var n = values.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (var i = 0; i < n; i++) {
      sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i; sumY2 += values[i] * values[i];
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var ssTot = sumY2 - (sumY * sumY) / n;
    var ssRes = 0;
    for (var j = 0; j < n; j++) { ssRes += Math.pow(values[j] - (intercept + slope * j), 2); }
    var r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
    return { slope: slope, intercept: intercept, r2: r2 };
  }

  function _parseDate(val) {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) return val;
    var s = String(val).trim();
    if (!s) return null;
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    var parts = s.split(/[\/\-\.]/);
    if (parts.length === 3) {
      var day = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10) - 1;
      var year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

})();
