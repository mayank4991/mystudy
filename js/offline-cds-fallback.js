/**
 * offline-cds-fallback.js
 * Offline Clinical Decision Support fallback
 * Provides limited CDS evaluation when offline with cached rules
 */

// =====================================================
// OFFLINE CDS FALLBACK
// =====================================================

class OfflineCDSFallback {
    /**
     * Local CDS evaluation when offline
     * Provides basic dosage validation and seizure classification
     */
    
    static OFFLINE_RULES = {
        dosageValidation: {
            'Phenytoin': { min: 200, max: 600, unit: 'mg/day', note: 'Adjust based on therapeutic range' },
            'Valproic Acid': { min: 500, max: 3000, unit: 'mg/day', note: 'Start 500mg 2-3x daily' },
            'Levetiracetam': { min: 500, max: 3000, unit: 'mg/day', note: 'Start 500mg BID, increase weekly' },
            'Carbamazepine': { min: 400, max: 1200, unit: 'mg/day', note: 'Start 200mg 2x daily' },
            'Lamotrigine': { min: 50, max: 500, unit: 'mg/day', note: 'Slow titration required' },
            'Oxcarbazepine': { min: 600, max: 2400, unit: 'mg/day', note: 'Similar to carbamazepine' }
        },
        seizureClassification: {
            generalized: {
                keywords: ['tonic-clonic', 'absence', 'atonic', 'myoclonic', 'loss of consciousness', 'both sides'],
                recommendation: 'Consider broad-spectrum AED'
            },
            focal: {
                keywords: ['focal', 'partial', 'aware', 'unaware', 'one side', 'temporal', 'frontal'],
                recommendation: 'Consider focal-effective AED'
            },
            unknown: {
                keywords: [],
                recommendation: 'Classify seizure type for optimal drug selection'
            }
        },
        drugInteractions: {
            'Phenytoin + Valproic Acid': '⚠️ Increased levels of phenytoin',
            'Phenytoin + Carbamazepine': '⚠️ Mutual induction - levels decrease',
            'Valproic Acid + Lamotrigine': '⚠️ Lamotrigine levels doubled - reduce dose',
            'Carbamazepine + Oral Contraceptives': '⚠️ OCP effectiveness reduced'
        }
    };
    
    /**
     * Validate dosage offline
     */
    static validateDosageOffline(drugName, dose, frequency) {
        if (!drugName || !dose) return { valid: null, message: 'Insufficient data for offline validation' };
        
        const rule = this.OFFLINE_RULES.dosageValidation[drugName];
        if (!rule) {
            return { valid: null, message: `No offline rules for ${drugName}` };
        }
        
        // Calculate total daily dose
        const frequencyMultiplier = this._parseFrequency(frequency);
        const totalDose = dose * frequencyMultiplier;
        
        const response = {
            drug: drugName,
            dose: dose,
            frequency: frequency,
            calculatedDaily: totalDose,
            expectedRange: `${rule.min}-${rule.max} ${rule.unit}`,
            valid: totalDose >= rule.min && totalDose <= rule.max,
            message: rule.note,
            offline: true
        };
        
        if (totalDose < rule.min) {
            response.warning = `⚠️ Dose below recommended minimum. Consider increasing.`;
        } else if (totalDose > rule.max) {
            response.warning = `⚠️ Dose above recommended maximum. Monitor levels closely.`;
        }
        
        return response;
    }
    
    static _parseFrequency(frequency) {
        if (!frequency) return 1;
        const f = frequency.toString().toLowerCase();
        
        if (f.includes('once') || f.includes('od')) return 1;
        if (f.includes('twice') || f.includes('bd')) return 2;
        if (f.includes('thrice') || f.includes('tds') || f.includes('tid')) return 3;
        if (f.includes('four') || f.includes('qid')) return 4;
        
        // Parse numeric frequency (e.g., "2x daily" = 2)
        const match = f.match(/(\d+)/);
        if (match) return parseInt(match[1]);
        
        return 1;
    }
    
    /**
     * Classify seizure type offline
     */
    static classifySeizureOffline(seizureDescription) {
        if (!seizureDescription) {
            return { type: 'unknown', confidence: 0, recommendation: 'Cannot classify without description' };
        }
        
        const description = seizureDescription.toString().toLowerCase();
        
        // Check for generalized seizure keywords
        for (const keyword of this.OFFLINE_RULES.seizureClassification.generalized.keywords) {
            if (description.includes(keyword)) {
                return {
                    type: 'generalized',
                    confidence: 0.7,
                    keywords: [keyword],
                    recommendation: this.OFFLINE_RULES.seizureClassification.generalized.recommendation,
                    offline: true
                };
            }
        }
        
        // Check for focal seizure keywords
        for (const keyword of this.OFFLINE_RULES.seizureClassification.focal.keywords) {
            if (description.includes(keyword)) {
                return {
                    type: 'focal',
                    confidence: 0.7,
                    keywords: [keyword],
                    recommendation: this.OFFLINE_RULES.seizureClassification.focal.recommendation,
                    offline: true
                };
            }
        }
        
        return {
            type: 'unknown',
            confidence: 0,
            recommendation: 'Cannot confidently classify - review with online CDS',
            offline: true
        };
    }
    
    /**
     * Check for drug interactions offline
     */
    static checkDrugInteractionsOffline(drugs) {
        if (!Array.isArray(drugs) || drugs.length < 2) {
            return { interactions: [], offline: true };
        }
        
        const interactions = [];
        
        for (let i = 0; i < drugs.length; i++) {
            for (let j = i + 1; j < drugs.length; j++) {
                const drug1 = drugs[i];
                const drug2 = drugs[j];
                
                // Check both directions
                const key1 = `${drug1} + ${drug2}`;
                const key2 = `${drug2} + ${drug1}`;
                
                const interaction = this.OFFLINE_RULES.drugInteractions[key1] || 
                                   this.OFFLINE_RULES.drugInteractions[key2];
                
                if (interaction) {
                    interactions.push({
                        drugs: [drug1, drug2],
                        warning: interaction,
                        action: 'Consider dose adjustment or monitoring'
                    });
                }
            }
        }
        
        return {
            interactions: interactions,
            hasInteractions: interactions.length > 0,
            offline: true
        };
    }
    
    /**
     * Get comprehensive offline assessment
     */
    static getOfflineAssessment(patient, seizureInfo, medicationInfo) {
        const assessment = {
            timestamp: new Date().toISOString(),
            offline: true,
            offlineMode: true,
            components: {}
        };
        
        // 1. Seizure classification
        if (seizureInfo && seizureInfo.description) {
            assessment.components.seizureClassification = this.classifySeizureOffline(
                seizureInfo.description
            );
        }
        
        // 2. Dosage validation for current medications
        if (medicationInfo && Array.isArray(medicationInfo)) {
            assessment.components.dosageValidation = medicationInfo
                .filter(med => med.name && med.dose)
                .map(med => this.validateDosageOffline(
                    med.name,
                    med.dose,
                    med.frequency
                ));
        }
        
        // 3. Drug interactions
        if (medicationInfo && Array.isArray(medicationInfo)) {
            const drugNames = medicationInfo
                .map(med => med.name)
                .filter(name => name && Object.keys(this.OFFLINE_RULES.dosageValidation).includes(name));
            
            assessment.components.drugInteractions = this.checkDrugInteractionsOffline(drugNames);
        }
        
        // 4. Add disclaimer
        assessment.disclaimer = '⚠️ OFFLINE MODE: This assessment is based on cached local rules only. ' +
                               'For comprehensive evaluation, sync with server when connection is restored.';
        
        return assessment;
    }
    
    /**
     * Cache CDS rules locally when online
     */
    static async cacheOfflineRules(rules) {
        try {
            localStorage.setItem('cds_offline_rules', JSON.stringify(rules));
            localStorage.setItem('cds_rules_cached_at', new Date().toISOString());
            window.Logger.debug('CDS rules cached for offline use');
        } catch (err) {
            window.Logger.warn('Failed to cache CDS rules:', err);
        }
    }
    
    /**
     * Load cached CDS rules if available
     */
    static loadCachedRules() {
        try {
            const cachedRules = localStorage.getItem('cds_offline_rules');
            if (cachedRules) {
                return JSON.parse(cachedRules);
            }
        } catch (err) {
            window.Logger.warn('Failed to load cached CDS rules:', err);
        }
        
        return null;
    }
}

// =====================================================
// INTEGRATION WITH EXISTING CDS
// =====================================================

/**
 * Wrap existing CDS functions to provide offline fallback
 */
if (typeof window !== 'undefined') {
    window.OfflineCDSFallback = OfflineCDSFallback;
    
    // If CDS module exists, wrap its functions
    if (window.ClinicalDecisionSupport) {
        const originalEvaluate = window.ClinicalDecisionSupport.evaluate;
        
        window.ClinicalDecisionSupport.evaluate = async function(data, options = {}) {
            // Try online evaluation first
            if (navigator.onLine) {
                try {
                    return await originalEvaluate.call(this, data, options);
                } catch (err) {
                    window.Logger.warn('Online CDS failed, falling back to offline:', err);
                }
            }
            
            // Fall back to offline evaluation
            const offlineAssessment = window.OfflineCDSFallback.getOfflineAssessment(
                data.patient,
                data.seizureInfo,
                data.medications
            );
            
            return offlineAssessment;
        };
    }
}
