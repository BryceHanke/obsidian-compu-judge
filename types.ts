// --- TYPES DEFINITION FOR COMPU-JUDGE (SANDERSON ENGINE v7.5.0) ---

export type AIProvider = 'gemini' | 'openai' | 'anthropic';

export interface ImageInput {
    data: string; // Base64
    mimeType: string;
}

export interface GradingColors {
    critical: string;    // <= -60
    poor: string;        // <= -40
    average: string;     // > -25
    good: string;        // >= 25
    excellent: string;   // >= 40 (Classic)
    masterpiece: string; // > 50
}

export interface GradientMap {
    startColor: string;
    midColor: string;
    endColor: string;
}

// DRIVE BLOCK (Global Context)
export interface DriveBlock {
    id: string;
    name: string;
    content: string;
    expanded: boolean;
}

export interface NigsSettings {
    // --- CORE ---
    apiKey: string;
    modelId: string;
    searchModelId: string; 
    aiProvider: AIProvider;
    openaiKey: string;
    openaiModel: string;
    anthropicKey: string;
    anthropicModel: string;
    
    // --- NEURO-PARAMETERS ---
    aiThinkingLevel: number;    // 1-5 (Thinking / Reasoning Effort)
    defaultTargetQuality: number; // Target Score
    tempMultiplier: number;     
    tempCritic: number;         
    tempWizard: number;         
    tempArchitect: number;      
    tempRepair: number;         
    tempSynth: number;          // New Synthesizer Temp
    
    // --- SAFETY & CONSTRAINTS ---
    wizardNegativeConstraints: string; 
    forgeImageBatchLength: number; // [NEW] Batch size for image processing
    namePool: string;           // [NEW] Preferred Names
    negativeNamePool: string;   // [NEW] Banned Names

    // --- ARBITRATION & CONTROL ---
    agentWeights: {
        logic: number;
        soul: number;
        market: number;
        lit: number;
        jester: number;
    };
    arbitrationEnabled: boolean;
    disableRainbows: boolean;
    luckTolerance: number; // 0-10
    
    // --- SYSTEM ---
    maxOutputTokens: number;    
    criticCores: number;        // [RENAMED] from analysisPasses
    enableTribunal: boolean;    // Toggle 3-Agent Consensus (Market, Logic, Lit)
    tribunalConfiguration: 'Iterative' | 'Parallel'; // [NEW] Tribunal Run Configuration
    tribunalMaxRetries: number; // [NEW] Number of retries for Tribunal loop
    showThinking: boolean;      
    optimizationMode: 'Speed' | 'Balanced' | 'Quality'; // [NEW] Optimization Setting
    enableLogging: boolean;     // [NEW] Log everything to hidden file
    
    // --- AGENTS ---
    wizardAgentEnabled: boolean;
    wizardAgentMaxRetries: number;
    synthAgentEnabled: boolean;
    synthAgentMaxRetries: number;

    // --- PROMPTS ---
    customSystemPrompt: string;      
    customOutlinePrompt: string;     
    customRepairPrompt: string;      
    
    // --- VISUALS ---
    gradingColors: GradingColors;
    gradientMap: GradientMap; // [NEW]
    
    // --- DATA STORE ---
    projects: Record<string, ProjectData>;
    drives: DriveBlock[];
    
    // Deprecated
    temperature?: number; 
    analysisPasses?: number;
}

export const DEFAULT_SETTINGS: NigsSettings = {
    apiKey: '',
    modelId: 'gemini-2.0-flash',
    searchModelId: '',
    aiProvider: 'gemini',
    openaiKey: '',
    openaiModel: 'gpt-4o',
    anthropicKey: '',
    anthropicModel: 'claude-3-7-sonnet-20250219',
    
    aiThinkingLevel: 3,
    defaultTargetQuality: 50, // Updated to match Masterpiece threshold
    tempMultiplier: 0.8, // Reduced from 1.0 for better consistency
    tempCritic: 0.1,    
    tempWizard: 0.85,   
    tempArchitect: 0.5, 
    tempRepair: 0.2,
    tempSynth: 1.0,     
    
    wizardNegativeConstraints: "Avoid: Deus Ex Machina, Talking Animals, Dream Sequences, Modern Slang.",
    forgeImageBatchLength: 10,
    namePool: "",           // Default Empty
    negativeNamePool: "",   // Default Empty

    agentWeights: {
        logic: 1.0,
        soul: 1.0,
        market: 1.0,
        lit: 1.0,
        jester: 1.0
    },
    arbitrationEnabled: true,
    disableRainbows: false,
    luckTolerance: 5,
    
    maxOutputTokens: 8192,
    criticCores: 1, // Default 1
    enableTribunal: true,
    tribunalConfiguration: 'Parallel', // Default to Parallel
    tribunalMaxRetries: 2, // Default 2 retries
    showThinking: false,
    optimizationMode: 'Balanced',
    enableLogging: true,

    wizardAgentEnabled: true,
    wizardAgentMaxRetries: 1,
    synthAgentEnabled: true,
    synthAgentMaxRetries: 1,

    customSystemPrompt: "",
    customOutlinePrompt: "",
    customRepairPrompt: "",
    gradingColors: {
        critical: '#000000',
        poor: '#FF0000',
        average: '#FF8C00',
        good: '#FFD700',
        excellent: '#FFFFE0',
        masterpiece: '#FFFFFF'
    },
    gradientMap: {
        startColor: '#ff0000',
        midColor: '#ffff00',
        endColor: '#00ff00'
    },
    projects: {},
    drives: [] 
};

export interface NlpMetrics {
    wordCount: number;
    sentenceCount: number;
    avgSentenceLength: number;
    adverbCount: number;
    readingLevel: string;
    technicalGrade: number;
    lexicalDiversity: number;
    sentenceVariance: number;
    dialogueRatio: number;
    voiceContrast: number;
    // Hard Metrics
    filterWordCount: number;
    weakVerbCount: number;
    pacingScore: number;
    adverbDensity?: number; // Added optional to fix TS error in CloudGen.ts
}

export interface MetricDetail {
    name: string;
    score: number; // 0-10
    reason: string; 
}

export interface MetricCategory {
    score: number; 
    items: MetricDetail[];
}

export interface SandersonMetrics {
    promise_payoff: number; 
    laws_of_magic: number;  
    character_agency: number;
    competence?: number; // 0-100
    proactivity?: number; // 0-100
    likability?: number; // 0-100
}

export interface NigsVibeCheck {
    score: number; // 0-100 (Soul Score)
    mood: string;
    critique: string;
}

export interface NigsFactReport {
    score: number; // 0-100 (Logic Score)
    inconsistencies: string[];
    luck_incidents: string[];
    deus_ex_machina_count: number;
}

export interface NigsArbitrationLog {
    final_verdict: number; // The Adjusted Score
    ruling: string;        // The Chief Justice's reasoning
    logic_score: number;
    soul_score: number;
    market_score: number;
    genre_modifier: number; // + / -
    luck_penalty: number;
}

export interface NigsResponse {
    commercial_score: number;
    commercial_reason: string; 
    niche_score: number;
    niche_reason: string;      
    cohesion_score: number;
    cohesion_reason: string;   
    
    content_warning: string;  
    log_line: string;         
    structure_map: UniversalOutlineNode[]; 
    tension_arc: number[];
    quality_arc?: number[]; // [UPDATED] Beat Quality (Signed Integers)
    third_act_score: number;
    novelty_score: number;
    sanderson_metrics: SandersonMetrics;
    detailed_metrics: {
        premise: MetricCategory;    
        structure: MetricCategory;  
        character: MetricCategory;  
        theme: MetricCategory;      
        world: MetricCategory;      
    };
    thought_process?: string; 
    modules?: any; 
    tribunal_breakdown?: {
        market: any;
        logic: any;
        soul: any; // [NEW] Separate Soul (Enjoyment)
        lit: any;  // [NEW] Separate Lit (Writing Quality)
        jester?: any; // [NEW] Optional Jester
    };
    arbitration_log?: NigsArbitrationLog;
}

export interface NigsLightGrade {
    score: string;          
    letter_grade: string;   
    summary_line: string;   
    synopsis: string;       
    thought_process?: string;
    key_improvement: string; 
    outline_summary: string[]; 
}

export interface NigsRepairItem {
    issue: string;
    instruction: string;
    why: string; 
}

export interface NigsActionPlan {
    weakest_link: string; 
    thought_process?: string;
    repairs: NigsRepairItem[]; 
    steps?: string[]; 
}

export interface NigsMetaResponse {
    symbol_web: string;
    story_world: string;
    visual_seven_steps: string;
}

export interface UniversalOutlineNode {
    title: string;          
    description: string;    
    type: 'promise' | 'progress' | 'payoff' | 'beat'; 
    characters: string[];   
    tension: number;        
    duration?: number; // [NEW] Relative duration/weight (1-10)
}

export interface CharacterBlock {
    id: string; 
    role: 'Protagonist' | 'Deuteragonist' | 'Contagonist' | 'Antagonist' | 'Support';
    name: string;
    description: string; 
    competence: number; 
    proactivity: number; 
    likability: number; 
    flaw: string;       
    revelation: string; 
    expanded: boolean;  
}

export interface StoryBlock {
    id: string;
    title: string;
    type: 'Setup' | 'Inciting Incident' | 'Plot Point' | 'Pinch Point' | 'Midpoint' | 'Crisis' | 'Climax' | 'Resolution' | 'Beat';
    description: string;
    characters: string; 
    tension: number; 
    expanded: boolean;
}

export type MiceType = 'Milieu' | 'Inquiry' | 'Character' | 'Event';

export interface TryFailBlock {
    id: string;
    goal: string;
    attempt1: string; 
    attempt2: string; 
    success: string;  
}

export interface NigsWizardState {
    concept: string;            
    targetScore: number;
    inspirationContext: string; 
    threePs: {
        promise: string;    
        progress: string;   
        payoff: string;     
    };
    sandersonLaws: {
        magicSystem: string;    
        limitations: string;    
        costs: string;          
        expansion: string;      
    };
    structureDNA: {
        primaryThread: MiceType;
        nestingOrder: string; 
        tryFailCycles: TryFailBlock[];
    };
    characters: CharacterBlock[];
    structure: StoryBlock[]; 
    philosopher: {
        controllingIdea: string;
        moralArg: string;
        counterpoint: string;
        symbols: string;
    };
    synthesisDrives: DriveBlock[];
}

export const DEFAULT_WIZARD_STATE: NigsWizardState = {
    concept: "",
    targetScore: 50, // Default to Masterpiece threshold
    inspirationContext: "",
    threePs: { promise: "", progress: "", payoff: "" },
    sandersonLaws: { magicSystem: "", limitations: "", costs: "", expansion: "" },
    structureDNA: {
        primaryThread: 'Event',
        nestingOrder: "",
        tryFailCycles: []
    },
    characters: [
        { id: 'c1', role: 'Protagonist', name: 'Hero', description: '', competence: 50, proactivity: 50, likability: 50, flaw: '', revelation: '', expanded: true },
        { id: 'c2', role: 'Deuteragonist', name: 'Ally', description: '', competence: 60, proactivity: 40, likability: 80, flaw: '', revelation: '', expanded: false },
        { id: 'c3', role: 'Contagonist', name: 'Rival', description: '', competence: 70, proactivity: 60, likability: 30, flaw: '', revelation: '', expanded: false },
        { id: 'c4', role: 'Antagonist', name: 'Villain', description: '', competence: 90, proactivity: 90, likability: 10, flaw: '', revelation: '', expanded: false }
    ],
    // [UPDATED]: Default 7-Act Truby Structure
    structure: [
        { id: 's1', title: '1. Weakness & Need', type: 'Setup', description: 'Internal flaw and external status quo.', characters: 'Hero', tension: 10, expanded: true },
        { id: 's2', title: '2. Desire', type: 'Inciting Incident', description: 'The goal is defined.', characters: 'Hero, Antagonist', tension: 30, expanded: false },
        { id: 's3', title: '3. Opponent', type: 'Plot Point', description: 'First major conflict with the antagonist.', characters: 'Hero, Villain', tension: 45, expanded: false },
        { id: 's4', title: '4. Plan', type: 'Midpoint', description: 'Strategy to win. Point of no return.', characters: 'Hero, Ally', tension: 60, expanded: false },
        { id: 's5', title: '5. Battle', type: 'Climax', description: 'The final confrontation.', characters: 'Hero, Villain', tension: 100, expanded: false },
        { id: 's6', title: '6. Self-Revelation', type: 'Resolution', description: 'The hero realizes the truth about themselves.', characters: 'Hero', tension: 20, expanded: false },
        { id: 's7', title: '7. New Equilibrium', type: 'Resolution', description: 'The world has changed.', characters: 'Hero', tension: 10, expanded: false }
    ],
    philosopher: { controllingIdea: "", moralArg: "", counterpoint: "", symbols: "" },
    synthesisDrives: []
};

export interface ProjectData {
    filePath: string;
    wizardState: NigsWizardState;
    lastAiResult: NigsResponse | null;
    lastLightResult: NigsLightGrade | null;
    lastActionPlan: NigsActionPlan | null;
    lastMetaResult: NigsMetaResponse | null;
    lastNlpMetrics?: NlpMetrics; 
    archivistContext: string; 
    archivistPrompt: string;
    repairFocus: string; 
    updatedAt: number;
    lastAnalysisMtime: number | null;
}
