import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

// --- DECORATION STYLES ---
// These classes map to styles.css definitions
const adverbMark = Decoration.mark({ class: "cj-highlight-adverb", attributes: { "data-cj-type": "Adverb Toxicity" } });
const filterMark = Decoration.mark({ class: "cj-highlight-filter", attributes: { "data-cj-type": "Filter Word (Distance)" } });
const weakMark = Decoration.mark({ class: "cj-highlight-weak", attributes: { "data-cj-type": "Weak Verb" } });

// --- CONFIGURATION ---
const DEBOUNCE_MS = 1000; // Only scan when typing stops to save performance

export const compuJudgeHud = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    timeout: number | null = null;

    constructor(view: EditorView) {
        this.decorations = Decoration.none;
        this.scheduleScan(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.scheduleScan(update.view);
        }
    }

    scheduleScan(view: EditorView) {
        if (this.timeout) window.clearTimeout(this.timeout);
        this.timeout = window.setTimeout(() => {
            this.decorations = this.scan(view);
            view.dispatch({ effects: [] }); // Trigger re-render
        }, DEBOUNCE_MS);
    }

    scan(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const docText = view.state.doc.toString();
        
        // 1. ADVERB SCAN (Red Underline)
        const adverbRegex = /\b(\w+ly)\b/gi;
        const whitelist = ['only', 'family', 'ugly', 'ally', 'holy', 'early', 'daily', 'suddenly', 'really', 'barely']; 
        
        let match;
        // Reset regex state
        while ((match = adverbRegex.exec(docText)) !== null) {
            if (!whitelist.includes(match[0].toLowerCase())) {
                builder.add(match.index, match.index + match[0].length, adverbMark);
            }
        }

        // 2. FILTER WORD SCAN (Yellow Highlight)
        const filters = ['saw', 'felt', 'heard', 'noticed', 'wondered', 'realized', 'knew', 'thought', 'decided'];
        filters.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            while ((match = regex.exec(docText)) !== null) {
                builder.add(match.index, match.index + match[0].length, filterMark);
            }
        });

        // 3. WEAK VERB SCAN (Gray Dotted)
        const weak = ['was', 'were', 'is', 'are', 'been', 'being'];
        weak.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            while ((match = regex.exec(docText)) !== null) {
                builder.add(match.index, match.index + match[0].length, weakMark);
            }
        });

        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});