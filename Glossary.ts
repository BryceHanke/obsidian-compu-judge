export const NARRATIVE_GLOSSARY: Record<string, string> = {
    // --- M.I.C.E. QUOTIENT ---
    "Milieu": "A story about PLACE. Begins when entering a new world; ends when leaving it. (e.g., Wizard of Oz, Gulliver's Travels).",
    "Inquiry": "A story about QUESTIONS. Begins with a mystery; ends when the answer is found. (e.g., Sherlock Holmes).",
    "Character": "A story about IDENTITY. Begins with dissatisfaction with self; ends with a change in nature. (e.g., A Christmas Carol).",
    "Event": "A story about STATUS QUO. Begins with a disaster; ends when order is restored. (e.g., Godzilla, Die Hard).",

    // --- 7-ACT ANATOMY (TRUBY) ---
    "Weakness & Need": "The foundation. 'Weakness' is the internal psychological flaw holding the hero back. 'Need' is what they must learn to have a better life.",
    "Desire": "The engine of the story. The specific, tangible goal the hero wants (e.g., 'Stop the bomb', 'Get the girl').",
    "Opponent": "The force that wants the same goal as the hero (unity of opposites) and is exceptionally good at attacking the hero's Weakness.",
    "Plan": "The set of guidelines and strategies the hero uses to defeat the opponent. This usually fails or requires adaptation.",
    "Battle": "The final conflict (Climax). It determines who gets the Goal. Must be a physical manifestation of the thematic conflict.",
    "Self-Revelation": "The moment the hero strips away their 'Lie' and sees the truth about themselves. This allows them to win (or lose tragically).",
    "New Equilibrium": "The world has changed. The hero is now at a higher (or lower) level than when they started.",

    // --- METRICS ---
    "Tension": "The anticipation of a negative outcome. Created by withholding information or threatening something the audience cares about.",
    "Agency": "The measure of how much the Hero DRIVES the plot vs. just reacting to it.",
    "Promise": "The tonal and genre contract made with the reader in the first chapter.",
    "Payoff": "The satisfaction of fulfilling the Promise (or subverting it surprisingly).",
    
    // --- FORENSICS ---
    "Filter Words": "Distancing words (saw, felt, heard) that place a lens between the reader and the action. Remove them for immersion.",
    "Weak Verbs": "Forms of 'to be' (was, were) that describe state rather than action. Use active verbs instead.",
    "Somatic Markers": "Physical visceral reactions to emotion (e.g. 'stomach dropped', 'palms sweated') used to 'Show, Don't Tell'."
};

export const IDEAL_ARCS: Record<string, { label: string, points: number[] }> = {
    "truby": { 
        label: "7-Act Structure (Truby)", 
        points: [10, 30, 45, 60, 90, 20, 10] 
    },
    "hero": {
        label: "Hero's Journey (Campbell)",
        points: [10, 5, 15, 30, 50, 40, 85, 30, 60, 95, 10]
    },
    "cat": {
        label: "Save the Cat (Snyder)",
        points: [0, 40, 20, 50, 70, -20, -10, 90, 10]
    },
    "fichtean": {
        label: "Fichtean Curve",
        points: [10, 30, 20, 50, 40, 70, 60, 90, 100, 10]
    },
    "kishotenketsu": {
        label: "Kishōtenketsu (4-Act)",
        points: [0, 30, 30, 80, 80, 10]
    },
    "harmon": {
        label: "Harmon's Circle",
        points: [0, 20, 40, 50, 60, 80, 50, 10]
    }
};
