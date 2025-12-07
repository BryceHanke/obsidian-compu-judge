import { requestUrl, App } from 'obsidian';
import type { NigsSettings, NigsResponse, NigsWizardState, NigsLightGrade, NigsActionPlan, NigsMetaResponse, NlpMetrics, CharacterBlock, StoryBlock, DriveBlock } from './types';
import { 
    NIGS_SYSTEM_PROMPT, NIGS_TRIBUNAL, NIGS_SYNTHESIS_PROMPT, 
    NIGS_WIZARD_COMPOSITION_PROMPT, 
    NIGS_FORGE_PROMPT, 
    NIGS_META_PROMPT, 
    NIGS_OUTLINE_PROMPT, 
    NIGS_WIZARD_ASSIST_PROMPT, 
    NIGS_QUICK_SCAN_PROMPT,
    NIGS_AUTO_REPAIR_PROMPT,
    NIGS_AUTOFILL_PROMPT,
    NIGS_DRIVE_SYNTHESIS_PROMPT,
    NIGS_RENAME_PROMPT
} from './prompts'; 
import { setStatus } from './store';

// [UPDATED] GRANDMASTER CALIBRATION (v20.0)
const FORENSIC_CALIBRATION = `
[SYSTEM OVERRIDE: NARRATIVE GRANDMASTER]
[PROTOCOL: THE ZERO-BASED SCORING SYSTEM]

1. **START AT ZERO:** 0 is the baseline for a "technically competent but boring/generic" story.
2. **NO CAP:** Scores can be positive (e.g. +50) or negative (e.g. -50).
3. **ADD POINTS:** Only for specific strengths (Innovation, Voice, Theme).
4. **SUBTRACT POINTS:** For ANY weakness (Plot Holes, Clichés, Confusion).
5. **IGNORE INTENT:** Judge only what is on the page.
`;

interface AIAdapter {
    generate(text: string, systemPrompt?: string, jsonMode?: boolean, useSearch?: boolean, tempOverride?: number): Promise<string>;
}

// --- GEMINI ADAPTER ---
class GeminiAdapter implements AIAdapter {
    constructor(private apiKey: string, private model: string, private settings: NigsSettings) {}

    async generate(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number): Promise<string> {
        if (!this.apiKey) throw new Error("MISSING GEMINI API KEY");
        
        const targetModel = useSearch ? (this.settings.searchModelId || this.model) : this.model;
        const temp = tempOverride !== undefined ? tempOverride : 0.7; 

        const body: any = {
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { 
                temperature: temp,
                maxOutputTokens: this.settings.maxOutputTokens
            }
        };
        
        const baseSys = sys || "";
        const userSys = this.settings.customSystemPrompt ? `[USER OVERRIDE]: ${this.settings.customSystemPrompt}` : FORENSIC_CALIBRATION;
        const thinkingLevel = this.settings.aiThinkingLevel || 3;
        
        // Inject Thinking Instructions for Gemini if level is high and supported
        let finalSys = `${baseSys}\n${userSys}`;
        
        // Note: Gemini 2.0 Flash Thinking model handles this natively, but we can nudge standard models
        if (thinkingLevel >= 4) {
             finalSys += "\n[THOUGHT PROCESS]: Think deeply and step-by-step before answering. Consider multiple angles.";
        }

        if (finalSys) body.systemInstruction = { parts: [{ text: finalSys }] };

        if (json && !useSearch) {
            body.generationConfig.responseMimeType = "application/json";
        }
        
        // Native Thinking Config for compatible models
        const supportsThinking = (targetModel.includes("2.0-flash-thinking") || targetModel.includes("thinking"));
        if (this.settings.showThinking || (thinkingLevel >= 4 && supportsThinking)) {
            // Adjust thinking budget based on level? Currently API doesn't support granular budget well, just toggle.
             body.generationConfig.thinking_config = { include_thoughts: true };
        } else if (useSearch) {
            body.tools = [{ googleSearch: {} }];
        }

        setStatus(`QUERYING ${targetModel}...`);

        const res = await requestUrl({
            url: `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${this.apiKey}`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (res.status >= 400) throw new Error(`GEMINI ERROR ${res.status}: ${res.text}`);
        const candidate = res.json.candidates?.[0];
        if (!candidate?.content?.parts) throw new Error("Empty Response");

        let finalOutput = "";
        let thoughtContent = "";
        for (const part of candidate.content.parts) {
            if (part.text) finalOutput += part.text;
            if (part.thought) thoughtContent += part.text + "\n"; 
        }

        if (json && thoughtContent && finalOutput.trim().endsWith('}')) {
             const trimmed = finalOutput.trim().replace(/```json/g, "").replace(/```/g, "");
             const lastBrace = trimmed.lastIndexOf('}');
             if (lastBrace > 0) {
                 const base = trimmed.substring(0, lastBrace);
                 return `${base}, "thought_process": ${JSON.stringify(thoughtContent)}}`;
             }
        }
        return finalOutput;
    }
}

// --- OPENAI ADAPTER ---
class OpenAIAdapter implements AIAdapter {
    constructor(private apiKey: string, private model: string, private settings: NigsSettings) {}

    async generate(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number): Promise<string> {
        if (!this.apiKey) throw new Error("MISSING OPENAI API KEY");
        setStatus(`CONNECTING TO OPENAI (${this.model})...`);
        
        const baseSys = sys || "";
        const userSys = this.settings.customSystemPrompt ? `[USER OVERRIDE]: ${this.settings.customSystemPrompt}` : FORENSIC_CALIBRATION;
        
        const body: any = {
            model: this.model || 'gpt-4o',
            messages: [{ role: "system", content: `${baseSys}\n${userSys}` }, { role: "user", content: text }],
            temperature: tempOverride !== undefined ? tempOverride : 0.7,
            max_tokens: this.settings.maxOutputTokens,
            response_format: json ? { type: "json_object" } : undefined
        };

        const res = await requestUrl({
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.status >= 400) throw new Error(`OPENAI ERROR ${res.status}`);
        return res.json.choices[0].message.content;
    }
}

// --- ANTHROPIC ADAPTER ---
class AnthropicAdapter implements AIAdapter {
    constructor(private apiKey: string, private model: string, private settings: NigsSettings) {}

    async generate(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number): Promise<string> {
        if (!this.apiKey) throw new Error("MISSING ANTHROPIC API KEY");
        setStatus(`CONNECTING TO CLAUDE (${this.model})...`);

        const baseSys = sys || "";
        const userSys = this.settings.customSystemPrompt ? `[USER OVERRIDE]: ${this.settings.customSystemPrompt}` : FORENSIC_CALIBRATION;

        const body: any = {
            model: this.model || 'claude-3-7-sonnet-20250219',
            max_tokens: this.settings.maxOutputTokens, 
            system: `${baseSys}\n${userSys}`,
            messages: [{ role: "user", content: text }],
            temperature: tempOverride !== undefined ? tempOverride : 0.7
        };
        
        if (json) body.messages.push({ role: "assistant", content: "{" });

        const res = await requestUrl({
            url: 'https://api.anthropic.com/v1/messages',
            method: 'POST',
            headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.status >= 400) throw new Error(`ANTHROPIC ERROR ${res.status}`);
        
        let textOutput = "";
        for (const block of res.json.content) {
            if (block.type === 'text') textOutput += block.text;
        }
        return json && !textOutput.trim().startsWith("{") ? "{" + textOutput : textOutput;
    }
}

// --- MAIN SERVICE ---
export class CloudGenService {
    constructor(public app: App, public settings: NigsSettings) {}

    private getAdapter(): AIAdapter {
        switch (this.settings.aiProvider) {
            case 'openai': return new OpenAIAdapter(this.settings.openaiKey, this.settings.openaiModel, this.settings);
            case 'anthropic': return new AnthropicAdapter(this.settings.anthropicKey, this.settings.anthropicModel, this.settings);
            case 'gemini': default: return new GeminiAdapter(this.settings.apiKey, this.settings.modelId, this.settings);
        }
    }

    private getTemp(baseTemp: number, strictCap = false): number {
        const mult = this.settings.tempMultiplier ?? 1.0;
        let val = baseTemp * mult;
        
        if (strictCap) {
            return Math.min(0.4, val);
        }
        
        return Math.max(0.0, Math.min(2.0, val));
    }

    public estimateDuration(text: string, taskType: string): number {
        const tokenCount = Math.ceil(text.length / 4);
        let baseTime = 3000;
        let mult = taskType === 'architect' ? 4.0 : 1.2;
        return Math.min(60000, baseTime + (tokenCount * 20 * mult));
    }

    public async callAI(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number): Promise<string> {
        const adapter = this.getAdapter();
        return await adapter.generate(text, sys, json, useSearch, tempOverride);
    }

    // [HELPER]: Generate Name Protocol String
    private getNameProtocol(): string {
        let rules = "";
        if (this.settings.namePool && this.settings.namePool.trim().length > 0) {
            rules += `\n- **PREFERRED NAMES (USE THESE):** ${this.settings.namePool}\n`;
        }
        if (this.settings.negativeNamePool && this.settings.negativeNamePool.trim().length > 0) {
            rules += `\n- **BANNED NAMES (DO NOT USE):** ${this.settings.negativeNamePool}\n`;
        }
        if (rules.length > 0) {
            return `\n[NAME PROTOCOL]:${rules}`;
        }
        return "";
    }

    // --- AUTO-FILL WIZARD (Architect Mode) ---
    autoFillWizard = async (concept: string, currentContext: string): Promise<Partial<NigsWizardState>> => {
        setStatus("ARCHITECTING STORY BIBLE...");
        
        const nameRules = this.getNameProtocol();

        const prompt = `
        [INPUT CONCEPT]: "${concept}"
        
        [UPLOADED SOURCE MATERIAL]:
        ${currentContext}
        
        Using the concept above and the source material, generate the full JSON Story Bible.
        Ensure you generate the "philosopher" section (Theme/Moral Argument) based on the conflict.
        ${nameRules}
        `;

        const temp = this.getTemp(this.settings.tempWizard);
        const res = await this.callAI(prompt, NIGS_AUTOFILL_PROMPT, true, false, temp);
        return this.parseJson<Partial<NigsWizardState>>(res);
    }

    // --- DRIVE SYNTHESIS (Alchemy Mode) ---
    // [UPDATED] Uses full concatenated context
    synthesizeDrives = async (drives: DriveBlock[], customTitle?: string, targetQuality?: number): Promise<string> => {
        setStatus("FUSING NARRATIVE DRIVES...");
        
        // [SAFETY]: Explicitly concat full content without trimming
        let driveContext = "";
        let totalChars = 0;

        drives.forEach((d, i) => {
            const safeContent = d.content || "";
            driveContext += `\n=== DRIVE ${i+1}: ${d.name} ===\n${safeContent}\n`;
            totalChars += safeContent.length;
        });

        console.log(`[Compu-Judge] Synthesizing ${drives.length} drives. Total Context Payload: ${totalChars} chars.`);
        
        const nameRules = this.getNameProtocol();
        
        let titleInstruction = "";
        if (customTitle && customTitle.trim().length > 0) {
            titleInstruction = `\n[MANDATORY TITLE]: ${customTitle}\nYou MUST use the title provided above. Do not invent a new one.`;
        }
        
        const qualityInstruction = `\n[TARGET QUALITY]: Aim for a quality score of ${targetQuality || this.settings.defaultTargetQuality}/100. Make it compelling!`;

        const finalPrompt = `${driveContext}\n${nameRules}${titleInstruction}${qualityInstruction}`;

        // Use dedicated SYNTH temperature (High Creativity for Alchemy)
        const temp = this.getTemp(this.settings.tempSynth ?? 1.0);
        return await this.callAI(finalPrompt, NIGS_DRIVE_SYNTHESIS_PROMPT, false, false, temp);
    }

    // --- GRADING (Unified System) ---
    gradeContent = async (text: string, context?: { inspiration: string; target: number }, nlpStats?: NlpMetrics, wizardState?: NigsWizardState): Promise<NigsResponse> => {
        // 1. CHECK SETTINGS: Fallback to Legacy if Tribunal is disabled
        if (!this.settings.enableTribunal) {
            return this.gradeContentLegacy(text, context, nlpStats);
        }

        setStatus("CONVENING THE TRIBUNAL...");
        
        // INJECT THINKING LEVEL into prompt if high
        const deepThought = this.settings.aiThinkingLevel >= 4 ? 
            "\n[THOUGHT PROCESS]: Use logic chains to verify every claim. Ignore bias." : "";

        const sourceMaterial = context?.inspiration ? `\n[SOURCE MATERIAL]: "${context.inspiration}"\n` : "";
        let statsBlock = "";
        
        if (nlpStats) {
            statsBlock = `
[FORENSIC EVIDENCE]:
- Word Count: ${nlpStats.wordCount}
- Pacing (Variance): ${nlpStats.sentenceVariance}
- Adverb Density: ${nlpStats.adverbDensity || 0}%
- Dialogue Ratio: ${nlpStats.dialogueRatio}%
`;
        }

        const inputPayload = `
=== NARRATIVE ARTIFACT ===
${text}
=== END ARTIFACT ===
${statsBlock}
${sourceMaterial}
`;

        // 2. SPAWN 4 PARALLEL AGENTS (Market, Logic, Lit, + Legacy Forensic)
        setStatus("DEPLOYING AGENTS (MARKET, LOGIC, LIT, FORENSIC)...");

        // Enforce STRICT temperature for Logic and Forensic
        const strictTemp = this.getTemp(0.1, true);

        // We use individual catches to ensure the system is robust against single-agent failure
        const [marketRaw, logicRaw, litRaw, forensicRaw] = await Promise.all([
            this.callAI(inputPayload + deepThought, NIGS_TRIBUNAL.MARKET, true, false, 0.7)
                .catch(e => `{"error": "Market Agent Failed: ${e.message}"}`),
            this.callAI(inputPayload + deepThought, NIGS_TRIBUNAL.LOGIC, true, false, strictTemp) // Logic is Strict
                .catch(e => `{"error": "Logic Agent Failed: ${e.message}"}`),
            this.callAI(inputPayload + deepThought, NIGS_TRIBUNAL.LITERARY, true, false, 0.9)
                .catch(e => `{"error": "Lit Agent Failed: ${e.message}"}`),
            // Legacy Pass as "Forensic Agent"
            this.callAI(inputPayload + deepThought, NIGS_SYSTEM_PROMPT, true, false, strictTemp) 
                .catch(e => `{"error": "Forensic Agent Failed: ${e.message}"}`)
        ]);

        // 3. SYNTHESIZE VERDICT
        setStatus("SYNTHESIZING VERDICT...");

        const synthesisPayload = `
[TRIBUNAL REPORTS]:
1. MARKET ANALYST:
${marketRaw}
2. LOGIC ENGINE:
${logicRaw}
3. LITERARY CRITIC:
${litRaw}
4. FORENSIC SCAN (Legacy):
${forensicRaw}

[TASK]: Synthesize a FINAL NigsResponse JSON.
- **ZERO-BASED SCORING:** Start at 0. Add for strengths, subtract for weaknesses.
- **LOGIC VETO:** If Logic/Forensic found a Plot Hole, the final score MUST be negative.
- **MARKET REALITY:** If Market says boring, the final score cannot be positive.
`;

        // Strict temp for the Judge
        const finalResStr = await this.callAI(synthesisPayload, NIGS_SYNTHESIS_PROMPT, true, false, strictTemp);
        const finalRes = this.parseJson<NigsResponse>(finalResStr);

        // 4. ATTACH BREAKDOWN FOR UI
        try {
            finalRes.tribunal_breakdown = {
                market: JSON.parse(marketRaw),
                logic: JSON.parse(logicRaw),
                lit: JSON.parse(litRaw)
            };
        } catch(e) { console.warn("Agent raw data parse error", e); }

        // [VETO PROTOCOL] - Enforce Capping if Tribunal Fails
        if (finalRes.tribunal_breakdown) {
            // Logic Veto: If Logic score is too low, cap market score
            if (finalRes.tribunal_breakdown.logic.cohesion_score <= -10) {
                if (finalRes.commercial_score > 50) {
                    finalRes.commercial_score = 50;
                    finalRes.commercial_reason += " [CAPPED BY LOGIC VETO]";
                }
            }
        }

        return finalRes;
    }


    private gradeContentLegacy = async (text: string, context?: { inspiration: string; target: number }, nlpStats?: NlpMetrics): Promise<NigsResponse> => {
        const passes = Math.max(1, Math.min(10, this.settings.analysisPasses));
        const contextBlock = context?.inspiration ? `\n[UPLOADED SOURCE CONTEXT]: "${context.inspiration}"\n` : "";
        
        let statsBlock = "";
        if (nlpStats) {
            statsBlock = `
[FORENSIC EVIDENCE]:
- Word Count: ${nlpStats.wordCount}
- Pacing (Variance): ${nlpStats.sentenceVariance}
- Adverb Density: ${nlpStats.adverbDensity}%
- Dialogue Ratio: ${nlpStats.dialogueRatio}%
`;
        }

        const instructionBlock = `
[STRICT GRADING INSTRUCTION]:
You are identifying FLAWS.
If the story is generic, score 0.
If it has plot holes, score negative.
Only score positive if it is innovative.
        `;

        const wrapped = `\n=== NARRATIVE TO ANALYZE ===\n${text}\n=== END ===\n${statsBlock}${contextBlock}\n${instructionBlock}`;
        
        setStatus(`INITIALIZING ${passes} FORENSIC CORES...`);
        
        // Enforce STRICT temperature for Grading
        const temp = this.getTemp(this.settings.tempCritic, true);

        const promises = Array.from({ length: passes }, (_, i) => {
            return this.callAI(wrapped, NIGS_SYSTEM_PROMPT, true, false, temp) 
                .then(resStr => this.parseJson<NigsResponse>(resStr))
                .catch(e => { console.error(`Core ${i+1} Failed:`, e); return null; });
        });

        const results = (await Promise.all(promises)).filter((r): r is NigsResponse => r !== null);
        if (results.length === 0) throw new Error("ALL CORES FAILED.");
        
        setStatus("SYNTHESIZING FORENSIC REPORT...");
        
        const finalRes = this.averageResults(results);
        if (results[0].thought_process) finalRes.thought_process = results[0].thought_process;
        return finalRes;
    }

    private averageResults(results: NigsResponse[]): NigsResponse {
        if (results.length === 1) return results[0];
        const base = JSON.parse(JSON.stringify(results[0]));
        const count = results.length;
        const avg = (fn: (r: NigsResponse) => number) => Math.round(results.reduce((a, r) => a + fn(r), 0) / count);

        // Simple averaging works for negative numbers too
        base.commercial_score = avg(r => r.commercial_score);
        base.niche_score = avg(r => r.niche_score);
        base.cohesion_score = avg(r => r.cohesion_score);
        base.third_act_score = avg(r => r.third_act_score);
        base.novelty_score = avg(r => r.novelty_score);

        if (base.sanderson_metrics) {
            base.sanderson_metrics.promise_payoff = avg(r => r.sanderson_metrics?.promise_payoff || 0);
            base.sanderson_metrics.laws_of_magic = avg(r => r.sanderson_metrics?.laws_of_magic || 0);
            base.sanderson_metrics.character_agency = avg(r => r.sanderson_metrics?.character_agency || 0);
        }

        // [UPDATED] Dynamic Tension Arc Averaging
        // Find maximum length of tension_arc in results
        const maxLen = results.reduce((max, r) => Math.max(max, r.tension_arc?.length || 0), 0) || 6;
        
        base.tension_arc = Array.from({ length: maxLen }, (_, idx) => 
            Math.round(results.reduce((sum, r) => sum + (r.tension_arc?.[idx] || 0), 0) / count)
        );

        const longest = (fn: (r: NigsResponse) => string) => results.reduce((a, b) => fn(a).length > fn(b).length ? a : b);
        base.content_warning = longest(r => r.content_warning || "").content_warning;
        base.log_line = longest(r => r.log_line || "").log_line;
        
        const longestMap = results.reduce((prev, curr) => {
            const prevLen = prev.structure_map ? prev.structure_map.length : 0;
            const currLen = curr.structure_map ? curr.structure_map.length : 0;
            return currLen > prevLen ? curr : prev;
        });
        base.structure_map = longestMap.structure_map;

        if (base.detailed_metrics) {
            for (const catKey in base.detailed_metrics) {
                const cat = base.detailed_metrics[catKey];
                cat.score = Math.round(results.reduce((acc, r) => acc + (r.detailed_metrics?.[catKey]?.score || 0), 0) / count);
                if (Array.isArray(cat.items)) {
                    cat.items = cat.items.map((item: any, idx: number) => {
                        const itemScore = Math.round(results.reduce((acc, r) => acc + (r.detailed_metrics?.[catKey]?.items?.[idx]?.score || 0), 0) / count);
                        const longestReason = results.reduce((best, r) => {
                            const current = r.detailed_metrics?.[catKey]?.items?.[idx]?.reason || "";
                            return current.length > best.length ? current : best;
                        }, "");
                        return { ...item, score: itemScore, reason: longestReason };
                    });
                }
            }
        }
        return base;
    }
    
    private parseJson<T>(text: string): T {
        try { 
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start === -1 || end === -1) throw new Error("No JSON found in response");
            const clean = text.substring(start, end + 1);
            const refined = clean.replace(/```json/g, "").replace(/```/g, "");
            return JSON.parse(refined); 
        } catch (e) { 
            console.error("JSON PARSE FAILURE", text);
            throw new Error("AI returned invalid JSON. Check console.");
        }
    }

    // --- PASSTHROUGHS ---
    generateOutline = async (text: string, useSearch = false) => {
        setStatus("INITIALIZING ARCHIVIST PROTOCOL...");
        const prompt = this.settings.customOutlinePrompt ? this.settings.customOutlinePrompt : NIGS_OUTLINE_PROMPT;
        const temp = this.getTemp(this.settings.tempArchitect);
        return await this.callAI(text, prompt, false, useSearch, temp);
    }

    // [UPDATED] Pass Scan Telemetry to Action Plan
    getActionPlan = async (text: string, focus?: string, deepScan?: NigsResponse, quickScan?: NigsLightGrade) => {
        setStatus("ANALYZING WEAKNESSES...");
        
        let diagnosticBlock = "";
        
        // [PHASE 2 UPDATE]: Format Specific Complaints for Forge
        let specificComplaints = "";

        if (deepScan) {
            diagnosticBlock += `
[DIAGNOSTIC TELEMETRY - DEEP SCAN]:
- Commercial Score: ${deepScan.commercial_score}
- Niche Score: ${deepScan.niche_score}
- Cohesion Score: ${deepScan.cohesion_score}
- Detected Issues: ${deepScan.content_warning}
`;
            if (deepScan.detailed_metrics) {
                diagnosticBlock += "\n[FAILED METRICS]:\n";
                // Only include low scores to save context
                for (const catKey in deepScan.detailed_metrics) {
                    // @ts-ignore
                    const cat = deepScan.detailed_metrics[catKey];
                    if (cat.score < 0) {
                        diagnosticBlock += `- ${catKey.toUpperCase()} (Avg: ${cat.score})\n`;
                        cat.items.forEach((i: any) => {
                            if (i.score < 0) diagnosticBlock += `  * ${i.name}: ${i.reason}\n`;
                        });
                    }
                }
            }

            // [PHASE 2]: Extract Tribunal Breakdown
            if (deepScan.tribunal_breakdown) {
                specificComplaints = `
[PRIORITY FIXES REQUIRED BY TRIBUNAL]:
1. LOGIC ENGINE DEMANDS: ${deepScan.tribunal_breakdown.logic.content_warning}
2. MARKET ANALYST DEMANDS: ${deepScan.tribunal_breakdown.market.commercial_reason}
`;
            }
        }

        if (quickScan) {
            diagnosticBlock += `
[DIAGNOSTIC TELEMETRY - QUICK SCAN]:
- Verdict: ${quickScan.letter_grade}
- Key Improvement: ${quickScan.key_improvement}
`;
        }

        let inputBlock = `TEXT TO ANALYZE:\n${text}`;
        
        if (diagnosticBlock) {
            inputBlock = `${diagnosticBlock}\n\n${inputBlock}`;
        }

        // Append specific complaints if they exist
        if (specificComplaints) {
            inputBlock = `${specificComplaints}\n\n${inputBlock}`;
        }

        if (focus && focus.trim().length > 0) inputBlock = `USER DIRECTIVE: Focus on "${focus}".\n\n${inputBlock}`;
        
        const temp = this.getTemp(this.settings.tempArchitect);
        return this.parseJson<NigsActionPlan>(await this.callAI(inputBlock, NIGS_FORGE_PROMPT, true, false, temp));
    }

    autoRepair = async (text: string, plan: NigsActionPlan) => {
        setStatus("INITIATING REPAIR...");
        const prompt = this.settings.customRepairPrompt ? this.settings.customRepairPrompt : NIGS_AUTO_REPAIR_PROMPT;
        // Enforce STRICT temperature for Repair
        const temp = this.getTemp(this.settings.tempRepair, true);
        return await this.callAI(JSON.stringify(plan) + "\n\n" + text, prompt, false, false, temp);
    }
    
    getMetaAnalysis = async (text: string) => {
        setStatus("RUNNING DIAGNOSTICS...");
        const temp = this.getTemp(this.settings.tempCritic, true);
        return this.parseJson<NigsMetaResponse>(await this.callAI(text, NIGS_META_PROMPT, true, false, temp));
    }
    
    getLightGrade = async (text: string) => {
        setStatus("PERFORMING QUICK SCAN...");
        const temp = this.getTemp(this.settings.tempCritic, true);
        return this.parseJson<NigsLightGrade>(await this.callAI(text, NIGS_QUICK_SCAN_PROMPT, true, false, temp));
    }
    
    // --- CHARACTER AUTO-GRADER ---
    gradeCharacter = async (char: CharacterBlock, context: string): Promise<CharacterBlock> => {
        setStatus(`ANALYZING ${char.name.toUpperCase()}...`);
        const prompt = `
        [TASK]: Calibrate Character Scales.
        [UPLOADED SOURCE]: ${context}...
        [PROFILE]:
        Name: ${char.name} (${char.role})
        Desc: ${char.description}
        Flaw: ${char.flaw}
        
        RETURN JSON: { "competence": number, "proactivity": number, "likability": number, "flaw": "Refined suggestion", "revelation": "Refined suggestion" }
        `;
        
        const temp = this.getTemp(this.settings.tempCritic, true);
        const res = await this.callAI(prompt, NIGS_WIZARD_ASSIST_PROMPT, true, false, temp);
        const data = this.parseJson<any>(res);
        
        return {
            ...char,
            competence: data.competence ?? char.competence,
            proactivity: data.proactivity ?? char.proactivity,
            likability: data.likability ?? char.likability,
            flaw: data.flaw || char.flaw,
            revelation: data.revelation || char.revelation
        };
    }

    // --- STRUCTURE AUTO-GRADER ---
    gradeStructureBeat = async (beat: StoryBlock, context: string): Promise<StoryBlock> => {
        setStatus(`ANALYZING STORY BEAT...`);
        const prompt = `
        Analyze this story beat. 
        1. CLASSIFY: Determine structural role.
        2. TENSION: Estimate narrative tension (-100 to +100).
        
        [UPLOADED SOURCE]: ${context}...
        [BEAT]: ${beat.title} - ${beat.description}

        RETURN JSON: { "tension": number, "type": "The determined type" }
        `;
        
        const temp = this.getTemp(this.settings.tempCritic, true);
        const res = await this.callAI(prompt, NIGS_WIZARD_ASSIST_PROMPT, true, false, temp);
        const data = this.parseJson<{ tension: number, type: any }>(res);
        
        return {
            ...beat,
            tension: data.tension ?? beat.tension,
            type: data.type ?? beat.type
        };
    }

    // --- ASSIST WIZARD (Logic Hardened + Name Protocol) ---
    assistWizard = async (field: string, state: NigsWizardState) => {
        setStatus("CONSULTING NARRATIVE DATABASE...");
        const sourceMaterial = state.inspirationContext || "No source file loaded.";
        
        // [REFACTOR] Targeted Context Injection
        let targetContext = "";
        let specificInstruction = "";
        
        const parts = field.split('.');
        
        // 1. CHARACTER TARGETING
        if (parts[0] === 'characters' && parts.length >= 3) {
            const idx = parseInt(parts[1]);
            const char = state.characters[idx];
            if (char) {
                targetContext = `
[TARGET CHARACTER]:
- Name: ${char.name}
- Role: ${char.role}
- Current Desc: ${char.description}
- Scales: Comp ${char.competence}%, Proac ${char.proactivity}%, Like ${char.likability}%
`;
                specificInstruction = `Suggest content for the '${parts[2]}' field of this specific character. Ensure it fits their Role (${char.role}).`;
            }
        }
        // 2. BEAT SHEET TARGETING (structure)
        else if (parts[0] === 'structure' && parts.length >= 3) {
            const idx = parseInt(parts[1]);
            const beat = state.structure[idx];
            if (beat) {
                targetContext = `
[TARGET BEAT]:
- Title: ${beat.title}
- Type: ${beat.type}
- Current Desc: ${beat.description}
`;
                specificInstruction = `Suggest content for this specific story beat. Ensure it fulfills the structural function of a '${beat.type}'.`;
            }
        }
        // 3. STRUCTURE DNA (Try/Fail Cycles)
        else if (parts[0] === 'structureDNA' && parts[1] === 'tryFailCycles' && parts.length >= 4) {
             const idx = parseInt(parts[2]);
             const cycle = state.structureDNA.tryFailCycles?.[idx];
             if (cycle) {
                 targetContext = `
[TARGET CYCLE ${idx+1}]:
- Goal: ${cycle.goal}
- Attempt 1 (Fail): ${cycle.attempt1}
- Attempt 2 (Fail): ${cycle.attempt2}
- Success: ${cycle.success}
`;
                 specificInstruction = `Suggest content for the '${parts[3]}' part of this Try/Fail cycle.`;
             }
        }
        // 4. THREE Ps (Plot Points)
        else if (parts[0] === 'threePs') {
            const map: any = {
                promise: "THE HOOK (Opening / Inciting Incident)",
                progress: "THE SHIFT (Middle / Investigation)",
                payoff: "THE CLIMAX (Ending / Resolution)"
            };
            const role = map[parts[1]] || parts[1];
            targetContext = `[TARGET PLOT POINT]: ${role}`;
            specificInstruction = `Suggest a compelling '${role}' for this story concept.`;
        }
        // 5. GENERIC FALLBACK
        else {
            specificInstruction = `Suggest content for the field: ${field}`;
        }

        const coreDna = {
            concept: state.concept,
            structureDNA: state.structureDNA, // Include generic structure DNA (MICE)
            theme: state.philosopher
        };

        const constraints = this.settings.wizardNegativeConstraints ? 
            `\n[NEGATIVE CONSTRAINTS (DO NOT USE)]: ${this.settings.wizardNegativeConstraints}\n` : "";

        // [UPDATED] Inject Name Protocol
        const nameRules = this.getNameProtocol();

        const prompt = `
        You are a narrative consultant. 
        [TASK]: ${specificInstruction}
        
        [GENRE & TONE CALIBRATION]:
        1. Analyze the [UPLOADED SOURCE MATERIAL] to determine the TONE.
        2. YOUR SUGGESTION MUST MATCH THIS TONE.
        
        ${constraints}
        ${nameRules}
        
        ${targetContext}

        [UPLOADED SOURCE MATERIAL]:
        ${sourceMaterial}

        [STORY DNA (Overview)]:
        ${JSON.stringify(coreDna, null, 2)}
        
        Return JSON ONLY: { "suggestion": "Your concise text suggestion." }
        `;

        const temp = this.getTemp(this.settings.tempWizard);
        const res = await this.callAI(prompt, NIGS_WIZARD_ASSIST_PROMPT, true, true, temp);
        const data = this.parseJson<{ suggestion: string }>(res);
        return data.suggestion;
    }
    
    wizardCompose = async (state: NigsWizardState) => {
        setStatus("ARCHITECTING OUTLINE...");
        const targetQ = state.targetScore || this.settings.defaultTargetQuality;
        const promptContext = `
        [SOURCE DATA]:
        ${JSON.stringify(state, null, 2)}
        
        [TARGET QUALITY]: ${targetQ}/100.
        [INSTRUCTION]: 
        Using the source data above, write a formatted Markdown document. Do not output JSON.
        Ensure every scene and character beat is generated to meet the Target Quality.
        `;
        const temp = this.getTemp(this.settings.tempArchitect);
        return await this.callAI(promptContext, NIGS_WIZARD_COMPOSITION_PROMPT, false, false, temp);
    }

    // --- DEEP RENAME (NEW) ---
    generateDeepNames = async (characters: CharacterBlock[], context: string): Promise<Record<string, string>> => {
        setStatus("ETYMOLOGIST ACTIVE: DEEP RENAMING...");
        
        // Prepare simplified character list for the prompt
        const charInput = characters.map(c => `- Name: ${c.name} (Role: ${c.role}) | Bio: ${c.description}`).join('\n');
        
        const input = `
        [SOURCE MATERIAL CONTEXT]:
        ${context.substring(0, 1000)}...

        [CHARACTERS TO RENAME]:
        ${charInput}
        `;

        // Use Wizard Temp for creativity
        const temp = this.getTemp(this.settings.tempWizard);
        const res = await this.callAI(input, NIGS_RENAME_PROMPT, true, false, temp);
        return this.parseJson<Record<string, string>>(res);
    }
}
