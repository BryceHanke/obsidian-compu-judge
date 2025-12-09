export function parseJson<T>(text: string): T {
    // Helper to clean and parse a substring
    const tryParse = (startIdx: number, endIdx: number): any => {
        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return undefined;
        const clean = text.substring(startIdx, endIdx + 1);
        const refined = clean
            .replace(/^```json\s*/, "")
            .replace(/```$/, "")
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .replace(/[\u0000-\u001F]+/g, c => ["\r", "\n", "\t"].includes(c) ? c : "");
        try {
            return JSON.parse(refined);
        } catch {
            return undefined;
        }
    };

    const openBrace = text.indexOf('{');
    const openBracket = text.indexOf('[');

    // Improved logic: Backtrack closing braces to handle trailing garbage
    const attemptParse = (start: number, searchChar: string): any => {
        let currentEnd = text.lastIndexOf(searchChar);
        while (currentEnd > start) {
            const parsed = tryParse(start, currentEnd);
            if (parsed !== undefined) {
                return parsed;
            }
            // Move back to the previous occurrence
            currentEnd = text.lastIndexOf(searchChar, currentEnd - 1);
        }
        return undefined;
    };

    let parsed: any;

    // Strategy: Try the earliest valid marker first. If it fails, try the other.
    // This handles cases like "[System Note] ... { Actual JSON }" where '[' is first but invalid as JSON start.

    if (openBrace !== -1 && (openBracket === -1 || openBrace < openBracket)) {
        // Object appears first
        parsed = attemptParse(openBrace, '}');
        if (parsed === undefined && openBracket !== -1) {
            // Fallback to array if object failed
            parsed = attemptParse(openBracket, ']');
        }
    } else if (openBracket !== -1) {
        // Array appears first
        parsed = attemptParse(openBracket, ']');
        if (parsed === undefined && openBrace !== -1) {
             // Fallback to object
             parsed = attemptParse(openBrace, '}');
        }
    }

    if (parsed === undefined) {
         console.error("JSON PARSE FAILURE", text);
         throw new Error("AI returned invalid JSON. Check console.");
    }

    // Heuristic: If we got an array but likely wanted an object (single result), return the first item.
    // Most interfaces in this app are objects (NigsResponse, NigsVibeCheck, etc).
    if (Array.isArray(parsed) && parsed.length > 0 && !Array.isArray(parsed[0])) {
         // Check if it's an array of objects which is a common failure mode when requesting a single object
         if (typeof parsed[0] === 'object') {
             return parsed[0] as T;
         }
    }

    return parsed as T;
}
