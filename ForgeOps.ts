import { Notice } from "obsidian";

export class ForgeOps {
    
    public static fixDialogue(text: string): string {
        let fixed = text;
        fixed = fixed.replace(/"\b/g, '“').replace(/\b"/g, '”'); 
        fixed = fixed.replace(/'\b/g, '‘').replace(/\b'/g, '’'); 
        fixed = fixed.replace(/",/g, ',”'); 
        fixed = fixed.replace(/"\./g, '.”');
        fixed = fixed.replace(/([?!])” He (said|asked|shouted)/g, '$1” he $2');
        new Notice("Dialogue Punctuation Standardized.");
        return fixed;
    }

    public static assassinateAdverbs(text: string, mode: 'highlight' | 'kill' = 'highlight'): string {
        const adverbRegex = /\b(\w+ly)\b/gi;
        const whitelist = ['only', 'family', 'ugly', 'ally', 'holy', 'early', 'daily'];

        if (mode === 'kill') {
            const result = text.replace(adverbRegex, (match) => {
                if (whitelist.includes(match.toLowerCase())) return match;
                return `[KILLED: ${match}]`;
            });
            new Notice("Adverbs marked for termination.");
            return result;
        } else {
            const result = text.replace(adverbRegex, (match) => {
                if (whitelist.includes(match.toLowerCase())) return match;
                return `**${match}**`;
            });
            new Notice("Adverbs Highlighted.");
            return result;
        }
    }

    public static highlightFilters(text: string): string {
        // "Orwellian Window Pane" mode: Remove distance words.
        const filters = ['saw', 'felt', 'heard', 'noticed', 'wondered', 'realized', 'knew', 'decided', 'watched', 'looked'];
        let result = text;
        filters.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            result = result.replace(regex, `==${word}==`);
        });
        new Notice("Filter Words Highlighted (Show, Don't Tell).");
        return result;
    }
    
    public static passiveVoiceScan(text: string): string {
        // Simple heuristic for passive voice: "to be" + "ed" (rough)
        // This is not perfect but fits the "Quick Fix" utility.
        const passiveRegex = /\b(am|is|are|was|were|be|been|being)\s+(\w+ed)\b/gi;
        let result = text.replace(passiveRegex, (match) => {
            return `==${match}==`;
        });
        if (result === text) {
            new Notice("No obvious passive voice detected.");
        } else {
            new Notice("Passive Voice Highlighted.");
        }
        return result;
    }
}
