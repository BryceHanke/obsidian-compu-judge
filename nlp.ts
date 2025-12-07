import nlp from 'compromise';
import type { NlpMetrics } from './types';

// Lists for Static Analysis (Prose Forensics)
const FILTER_WORDS = [
    'saw', 'seen', 'see', 
    'heard', 'hear', 
    'felt', 'feel', 
    'smelled', 'smell', 
    'tasted', 'taste',
    'realized', 'wondered', 'knew', 'thought', 'noticed', 'decided',
    'watched', 'looked', 'seemed', 'appeared'
];

const WEAK_VERBS = [
    'is', 'am', 'are', 'was', 'were', 'be', 'being', 'been',
    'have', 'has', 'had' // Often weak auxiliary, though context matters
];

export class NlpService {
    
    public static analyze(text: string): NlpMetrics {
        const doc = nlp(text);
        
        // 1. FUNDAMENTALS
        const wordCount = doc.wordCount();
        const sentenceCount = doc.sentences().length;
        const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
        
        // 2. STYLE TOXICITY (Adverbs)
        const adverbCount = doc.adverbs().length;

        // 3. FILTER WORDS (Immersion Breakers)
        // Regex with word boundaries to avoid partial matches
        let filterCount = 0;
        const lowerText = text.toLowerCase();
        FILTER_WORDS.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            const matches = lowerText.match(regex);
            if (matches) filterCount += matches.length;
        });

        // 4. WEAK VERBS (Passive/Static State)
        let weakCount = 0;
        WEAK_VERBS.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            const matches = lowerText.match(regex);
            if (matches) weakCount += matches.length;
        });

        // 5. PACING (Variance)
        // Calculates standard deviation of sentence lengths to detect monotony
        const sentences = doc.sentences().json();
        const lengths = sentences.map((s: any) => s.terms.length);
        const variance = this.calculateStandardDeviation(lengths);
        const pacingScore = Math.min(100, (variance * 10)); // Normalize 0-10 variance to 0-100 score

        // 6. READABILITY (Heuristic)
        // Flesch-Kincaid approximation based on sentence length
        const readabilityScore = Math.max(0, 100 - (avgSentenceLength * 1.5)); 
        let technicalGrade = 0;
        if (readabilityScore > 90) technicalGrade = 5; 
        else if (readabilityScore > 60) technicalGrade = 9; 
        else if (readabilityScore > 30) technicalGrade = 12; 
        else technicalGrade = 16; 

        // 7. LEXICAL DIVERSITY
        // Ratio of unique terms to total terms
        const uniqueWords = new Set(doc.terms().out('array')).size;
        const lexicalDiversity = wordCount > 0 ? (uniqueWords / wordCount) * 100 : 0;

        // 8. DIALOGUE RATIO
        const dialogueMatches = text.match(/"[^"]+"/g) || [];
        const dialogueText = dialogueMatches.join(' ');
        const dialogueCount = nlp(dialogueText).wordCount();
        const dialogueRatio = wordCount > 0 ? (dialogueCount / wordCount) * 100 : 0;

        // 9. VOICE CONTRAST
        // Checks overlap between dialogue vocabulary and narration vocabulary
        let voiceContrast = 0;
        if (dialogueCount > 0) {
            const narrationText = text.replace(/"[^"]+"/g, '');
            const narrTerms = new Set(nlp(narrationText).terms().out('array'));
            const dialTerms = new Set(nlp(dialogueText).terms().out('array'));
            
            // Jaccard Similarity approach
            const intersection = new Set([...dialTerms].filter(x => narrTerms.has(x)));
            const union = new Set([...dialTerms, ...narrTerms]);
            const similarity = union.size > 0 ? intersection.size / union.size : 1;
            voiceContrast = (1 - similarity) * 100; 
        }

        // 10. REPETITION (Echoes)
        // Detects word reuse within small windows (clunky prose)
        const terms = doc.terms().out('array');
        let repetitionCount = 0;
        const windowSize = 50;
        // Only check significant words (length > 4) to avoid "the", "and"
        for (let i = 0; i < terms.length; i++) {
            const word = terms[i].toLowerCase();
            if (word.length < 5) continue; 
            
            // Look ahead in window
            for (let j = 1; j < windowSize && (i + j) < terms.length; j++) {
                if (terms[i+j].toLowerCase() === word) {
                    repetitionCount++;
                    break; // Count once per origin word
                }
            }
        }

        return {
            wordCount,
            sentenceCount,
            avgSentenceLength: parseFloat(avgSentenceLength.toFixed(1)),
            adverbCount,
            passiveVoiceCount: 0, // Placeholder, requires deeper dependency parsing
            readingLevel: String(technicalGrade),
            technicalGrade,
            lexicalDiversity: parseFloat(lexicalDiversity.toFixed(1)),
            sentenceVariance: parseFloat(variance.toFixed(1)),
            dialogueRatio: Math.round(dialogueRatio),
            voiceContrast: Math.round(voiceContrast),
            filterWordCount: filterCount,
            weakVerbCount: weakCount,
            repetitionCount,
            pacingScore: Math.round(pacingScore)
        };
    }

    private static calculateStandardDeviation(array: number[]): number {
        if (array.length === 0) return 0;
        const n = array.length;
        const mean = array.reduce((a, b) => a + b) / n;
        const variance = array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n;
        return Math.sqrt(variance);
    }
}