import { requestUrl, App } from 'obsidian';
import type { NigsSettings, NigsResponse, NigsWizardState, NigsLightGrade, NigsActionPlan, NigsMetaResponse, NlpMetrics, CharacterBlock, StoryBlock, DriveBlock } from './types';
import type { NigsVibeCheck, NigsFactReport, NigsArbitrationLog } from './types';
import { LogService } from './LogService';
import { 
    NIGS_SYSTEM_PROMPT, NIGS_TRIBUNAL,
    NIGS_WIZARD_COMPOSITION_PROMPT, 
    NIGS_FORGE_PROMPT, 
    NIGS_META_PROMPT, 
    NIGS_OUTLINE_PROMPT, 
    NIGS_WIZARD_ASSIST_PROMPT, 
    NIGS_QUICK_SCAN_PROMPT,
    NIGS_AUTO_REPAIR_PROMPT,
    NIGS_AUTOFILL_PROMPT,
    NIGS_DRIVE_SYNTHESIS_PROMPT,
    NIGS_RENAME_PROMPT,
    NIGS_GRADE_ANALYST_PROMPT,
    NIGS_ARBITRATOR_PROMPT,
    NIGS_BATCH_ANALYSIS_PROMPT
} from './prompts'; 
import { setStatus } from './store';
import type { ImageInput } from './types';
import { parseJson } from './utils/Parser';
import { type AIAdapter, GeminiAdapter, OpenAIAdapter, AnthropicAdapter, type StatusUpdate } from './ai/AIAdapters';

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

    public async callAI(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number, signal?: AbortSignal, images?: ImageInput[], onStatus?: StatusUpdate, modelOverride?: string): Promise<string> {
        const adapter = this.getAdapter();

        // [LOGGING INBOUND]
        await LogService.log(this.app, this.settings.enableLogging, 'AI_REQUEST', {
             model: modelOverride || this.settings.modelId,
             prompt: text,
             system: sys,
             temp: tempOverride
        });

        const start = Date.now();
        const response = await adapter.generate(text, sys, json, useSearch, tempOverride, signal, images, onStatus, modelOverride);

        // [LOGGING OUTBOUND]
        await LogService.log(this.app, this.settings.enableLogging, 'AI_RESPONSE', {
            durationMs: Date.now() - start,
            response: response.substring(0, 5000) // Truncate slightly to save space
        });

        return response;
    }

    private updateStatus(msg: string, onStatus?: StatusUpdate, progress?: number) {
        if (onStatus) onStatus(msg, progress);
        else setStatus(msg);
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
    autoFillWizard = async (concept: string, currentContext: string, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<Partial<NigsWizardState>> => {
        this.updateStatus("ARCHITECTING STORY BIBLE...", onStatus, 10);
        
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
        const res = await this.callAI(prompt, NIGS_AUTOFILL_PROMPT, true, false, temp, signal, undefined, onStatus);

        this.updateStatus("PARSING RESULT...", onStatus, 90);
        const result = parseJson<Partial<NigsWizardState>>(res);
        this.updateStatus("DONE", onStatus, 100);
        return result;
    }

    // --- DRIVE SYNTHESIS (Alchemy Mode) ---
    // [UPDATED] Uses full concatenated context & [NEW] Thinking Agent Loop

    private preprocessDrives(drives: DriveBlock[]): DriveBlock[] {
        return drives.map(d => {
            let clean = d.content || "";
            // Remove Works Cited / References / Bibliography and everything after (Standard End-of-Doc markers)
            // [SAFETY]: Removed "Table of Contents" and "Notes" to prevent accidental truncation of body content
            clean = clean.split(/\n\s*(?:Works Cited|References|Bibliography)\s*(?:\n|$)/i)[0];
            return { ...d, content: clean.trim() };
        });
    }

    synthesizeDrives = async (drives: DriveBlock[], customTitle?: string, targetQuality?: number, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<string> => {
        this.updateStatus("FUSING NARRATIVE DRIVES...", onStatus, 5);
        
        // [SAFETY]: Prune content to save tokens
        const cleanDrives = this.preprocessDrives(drives);

        // [SAFETY]: Explicitly concat full content without trimming
        let driveContext = "";
        let totalChars = 0;
        let baseInstruction = "";

        // Check for Base Drive (Story Instructions)
        const baseDriveIndex = cleanDrives.findIndex(d => d.name.toLowerCase().includes("story instructions") || d.name.toLowerCase().includes("story instruction"));

        if (baseDriveIndex !== -1) {
             const baseDrive = cleanDrives[baseDriveIndex];
             driveContext += `\n=== PRIMARY BASE INSTRUCTIONS (DRIVE: ${baseDrive.name}) ===\n${baseDrive.content}\n\n=== ADDITIONAL CONTEXT DRIVES ===\n`;
             totalChars += (baseDrive.content || "").length;

             baseInstruction = `\n[MANDATORY BASE]: You MUST use the content from the "PRIMARY BASE INSTRUCTIONS" drive as the skeleton/foundation. Fuse the other drives INTO this base structure.`;

             cleanDrives.forEach((d, i) => {
                 if (i === baseDriveIndex) return;
                 const safeContent = d.content || "";
                 driveContext += `\n=== DRIVE ${i+1}: ${d.name} ===\n${safeContent}\n`;
                 totalChars += safeContent.length;
             });
        } else {
             cleanDrives.forEach((d, i) => {
                 const safeContent = d.content || "";
                 driveContext += `\n=== DRIVE ${i+1}: ${d.name} ===\n${safeContent}\n`;
                 totalChars += safeContent.length;
             });
        }

        console.log(`[Compu-Judge] Synthesizing ${drives.length} drives. Total Context Payload: ${totalChars} chars.`);
        
        const nameRules = this.getNameProtocol();
        
        let titleInstruction = "";
        if (customTitle && customTitle.trim().length > 0) {
            titleInstruction = `\n[MANDATORY TITLE]: ${customTitle}\nYou MUST use the title provided above. Do not invent a new one.`;
        }
        
        const qualityInstruction = `\n[TARGET QUALITY]: Aim for a quality score of ${targetQuality || this.settings.defaultTargetQuality}/100. Make it compelling!`;

        const negativeConstraints = this.settings.wizardNegativeConstraints ?
            `\n[NEGATIVE CONSTRAINTS (DO NOT USE)]: ${this.settings.wizardNegativeConstraints}\n` : "";

        const finalPrompt = `${driveContext}\n${nameRules}${titleInstruction}${qualityInstruction}${baseInstruction}${negativeConstraints}`;

        // Use dedicated SYNTH temperature (High Creativity for Alchemy)
        const temp = this.getTemp(this.settings.tempSynth ?? 1.0);

        // --- SYNTH AGENT LOOP (Structural Architect) ---
        let attempts = 0;
        const maxAttempts = (this.settings.synthAgentEnabled) ? (this.settings.synthAgentMaxRetries || 1) + 1 : 1;
        let isApproved = false;
        let previousCritique = "";
        let draft = "";

        do {
            attempts++;
            const progressBase = 10;
            const progressStep = Math.floor(80 / maxAttempts);
            const currentProgress = progressBase + ((attempts - 1) * progressStep);

            if (attempts > 1) this.updateStatus(`SYNTH AGENT: REFINING FUSION (ATTEMPT ${attempts})...`, onStatus, currentProgress);

            const currentPrompt = previousCritique ? `${finalPrompt}\n\n[PREVIOUS CRITIQUE - FIX THIS]:\n${previousCritique}` : finalPrompt;

            // CHAIN OF THOUGHT PAGINATION
            // Call 1: Acts 1-3
            const promptStage1 = `${currentPrompt}\n\n[INSTRUCTION]: Generate ONLY the first half of the report (Title, Cast, World, and Acts 1, 2, and 3). STOP after Act 3.`;
            const draftStage1 = await this.callAI(promptStage1, NIGS_DRIVE_SYNTHESIS_PROMPT, false, false, temp, signal, undefined, onStatus);

            this.updateStatus("SYNTH AGENT: REFLECTING ON ARC...", onStatus, currentProgress + 3);

            // [REFLECTION STEP]: Critique the first half before continuing
            const reflectionPrompt = `
[TASK]: Critique the first half of this story.
[CRITERIA]: Is the Inciting Incident strong? Is the conflict clear?
[CONTENT]: ${draftStage1}

Return concise instructions for the second half to IMPROVE the ending.
`;
            const reflection = await this.callAI(reflectionPrompt, NIGS_WIZARD_ASSIST_PROMPT, false, false, 0.3, signal, undefined, onStatus);

            this.updateStatus("SYNTH AGENT: GENERATING ACTS 4-7...", onStatus, currentProgress + 5);

            // Call 2: Acts 4-7
            const promptStage2 = `${currentPrompt}\n\n[PREVIOUS CONTENT (ACTS 1-3)]: ${draftStage1}\n\n[REFLECTION]: ${reflection}\n\n[INSTRUCTION]: CONTINUE the story. Generate Acts 4, 5, 6, 7 and the Thematic Synthesis. Start directly at Act 4. Do not repeat the Title/Cast.`;
            const draftStage2 = await this.callAI(promptStage2, NIGS_DRIVE_SYNTHESIS_PROMPT, false, false, temp, signal, undefined, onStatus);

            draft = `${draftStage1}\n${draftStage2}`;

            // If Agent disabled, accept first draft
            if (!this.settings.synthAgentEnabled) {
                this.updateStatus("DONE", onStatus, 100);
                return draft;
            }

            // [AGENT REVIEW]
            this.updateStatus("STRUCTURAL ARCHITECT: REVIEWING FUSION...", onStatus, currentProgress + 10);
            const reviewPrompt = `
[TASK]: Review this generated narrative fusion.
[CRITERIA]:
1. Did it follow the 7-Act Truby Structure?
2. Did it use the User's Title?
3. Is it logically consistent?

[DRAFT]:
${draft.substring(0, 5000)}... (truncated)

Return JSON: { "verdict": "PASS" | "FAIL", "reason": "Short reason." }
`;
            // Simple check using basic temp
            const reviewRaw = await this.callAI(reviewPrompt, NIGS_GRADE_ANALYST_PROMPT, true, false, 0.2, signal, undefined, onStatus);
            const review = parseJson<{ verdict: string, reason: string }>(reviewRaw);

            if (review.verdict === "PASS") {
                isApproved = true;
                this.updateStatus("STRUCTURAL ARCHITECT: APPROVED.", onStatus, 95);
            } else {
                console.warn(`SYNTH AGENT REJECTED: ${review.reason}`);
                previousCritique = review.reason;
                if (attempts >= maxAttempts) {
                    this.updateStatus("MAX RETRIES REACHED. RETURNING BEST EFFORT.", onStatus, 95);
                }
            }

        } while (!isApproved && attempts < maxAttempts);

        this.updateStatus("DONE", onStatus, 100);
        return draft;
    }

    // --- GRADING (Unified System) ---
    // [UPDATED] Iterative/Parallel Tribunal with Veto Protocol & Analyst Loop
    gradeContent = async (text: string, context?: { inspiration: string; target: number; jobId?: string }, nlpStats?: NlpMetrics, wizardState?: NigsWizardState, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<NigsResponse> => {
        // 1. CHECK SETTINGS: Fallback to Legacy if Tribunal is disabled
        if (!this.settings.enableTribunal) {
            return this.gradeContentLegacy(text, context, nlpStats, signal, onStatus);
        }

        this.updateStatus("CONVENING THE TRIBUNAL...", onStatus, 5);

        // [SYSTEM TUNING] HEADER ISOLATION & ID MATCHING
        // We explicitly label Primary Target vs Reference to prevent ghost data leak.
        const jobId = context?.jobId || `JOB-${Date.now()}`;

        const sourceMaterial = context?.inspiration ? `\n[REFERENCE DATA (IGNORE IF CONTRADICTORY)]:\n"${context.inspiration}"\n` : "";
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

        // [SYSTEM TUNING] HEADER ISOLATION
        const baseInputPayload = `
[JOB ID]: ${jobId}

[PRIMARY TARGET FOR ANALYSIS]:
=== NARRATIVE ARTIFACT ===
${text}
=== END ARTIFACT ===

${statsBlock}
${sourceMaterial}
`;

        // --- GRADE ANALYST LOOP ---
        let attempts = 0;
        // [OPTIMIZATION]: If Speed mode, force maxAttempts to 1 (No Retries)
        const isSpeedMode = this.settings.optimizationMode === 'Speed';
        const maxAttempts = isSpeedMode ? 1 : (this.settings.tribunalMaxRetries || 2);

        let finalResponse: NigsResponse | null = null;
        let isApproved = false;
        let previousConsensus = "";

        // [UPDATED] Tribunal Loop with Soul, Lit, Jester, Logic, Market
        do {
            attempts++;
            const progressBase = 10;
            const progressChunk = 80 / maxAttempts; // e.g. 40% per attempt if 2 attempts
            const currentBase = progressBase + ((attempts - 1) * progressChunk);

            this.updateStatus(attempts > 1 ? `RE-CONVENING TRIBUNAL (ATTEMPT ${attempts})...` : "STARTING TRIBUNAL PROCESS...", onStatus, currentBase);

            if (signal?.aborted) throw new Error("Cancelled by user.");

            const currentInputPayload = previousConsensus
                ? `${baseInputPayload}\n\n[PREVIOUS CONSENSUS / FEEDBACK]:\n${previousConsensus}`
                : baseInputPayload;

            this.updateStatus("CONVENING AGENTS: MARKET, LOGIC, SOUL, LIT, JESTER...", onStatus, currentBase + 5);

            // Temps (Reduced for Consistency)
            const soulTemp = this.getTemp(0.7); // High creativity (Reduced from 0.9)
            const logicTemp = this.getTemp(0.1, true); // Strict
            const marketTemp = this.getTemp(0.4); // Reduced from 0.5
            const jesterTemp = this.getTemp(0.8); // Reduced from 1.1 to tame chaos
            const litTemp = this.getTemp(0.2); // Critical (Reduced from 0.3)

            let marketReport, logicReport, soulReport, litReport, jesterReport, forensicRaw;

            // [CONFIGURATION CHECK]: Parallel vs Iterative
            // For now, even "Iterative" needs all agents. Iterative might mean "Run Logic, then Market reads Logic, then Soul reads Market".
            // But for simplicity and speed (and because Prompts are isolated), we default to Parallel unless specified otherwise for debugging.
            // If the user selects "Iterative", we could sequence them, but without shared memory in the prompt calls, it's just slower.
            // A true iterative approach would be: Agent A -> Output -> Agent B(Input + A_Output).
            // Let's implement a basic sequential chain if 'Iterative' is selected.

            if (this.settings.tribunalConfiguration === 'Iterative') {
                // SEQUENTIAL CHAIN
                this.updateStatus("AGENT 1/5: LOGIC ENGINE...", onStatus, currentBase + 10);
                const logicRaw = await this.callAI(currentInputPayload, NIGS_TRIBUNAL.LOGIC, true, false, logicTemp, signal, undefined, onStatus);
                logicReport = parseJson<NigsFactReport>(logicRaw);

                this.updateStatus("AGENT 2/5: MARKET ANALYST...", onStatus, currentBase + 15);
                const marketRaw = await this.callAI(currentInputPayload, NIGS_TRIBUNAL.MARKET, true, false, marketTemp, signal, undefined, onStatus);
                marketReport = parseJson<any>(marketRaw);

                this.updateStatus("AGENT 3/5: THE SOUL...", onStatus, currentBase + 20);
                const soulRaw = await this.callAI(currentInputPayload, NIGS_TRIBUNAL.SOUL, true, false, soulTemp, signal, undefined, onStatus);
                soulReport = parseJson<NigsVibeCheck>(soulRaw);

                this.updateStatus("AGENT 4/5: LITERARY CRITIC...", onStatus, currentBase + 25);
                const litRaw = await this.callAI(currentInputPayload, NIGS_TRIBUNAL.LIT, true, false, litTemp, signal, undefined, onStatus);
                litReport = parseJson<any>(litRaw);

                this.updateStatus("AGENT 5/5: THE JESTER...", onStatus, currentBase + 30);
                const jesterRaw = await this.callAI(currentInputPayload, NIGS_TRIBUNAL.JESTER, true, false, jesterTemp, signal, undefined, onStatus);
                jesterReport = parseJson<any>(jesterRaw);

                this.updateStatus("FORENSIC SYSTEM SCAN (WITH LOGIC INJECTION)...", onStatus, currentBase + 35);

                // [LOGIC INJECTION]: Pass logic findings to Scribe
                const forensicInput = `${currentInputPayload}\n\n[LOGIC AGENT REPORT]:\nInconsistencies: ${JSON.stringify(logicReport.inconsistencies)}\nLuck Incidents: ${JSON.stringify(logicReport.luck_incidents)}`;

                forensicRaw = await this.callAI(forensicInput, NIGS_SYSTEM_PROMPT, true, false, logicTemp, signal, undefined, onStatus);

            } else {
                // PARALLEL (Default)
                const [soulRaw, jesterRaw, logicRaw, marketRaw, litRaw] = await Promise.all([
                    this.callAI(currentInputPayload, NIGS_TRIBUNAL.SOUL, true, false, soulTemp, signal, undefined, onStatus).catch(e => `{"error": "Soul Failed"}`),
                    this.callAI(currentInputPayload, NIGS_TRIBUNAL.JESTER, true, false, jesterTemp, signal, undefined, onStatus).catch(e => `{"error": "Jester Failed"}`),
                    this.callAI(currentInputPayload, NIGS_TRIBUNAL.LOGIC, true, false, logicTemp, signal, undefined, onStatus).catch(e => `{"error": "Logic Failed"}`),
                    this.callAI(currentInputPayload, NIGS_TRIBUNAL.MARKET, true, false, marketTemp, signal, undefined, onStatus).catch(e => `{"error": "Market Failed"}`),
                    this.callAI(currentInputPayload, NIGS_TRIBUNAL.LIT, true, false, litTemp, signal, undefined, onStatus).catch(e => `{"error": "Lit Failed"}`)
                ]);

                soulReport = parseJson<NigsVibeCheck>(soulRaw);
                jesterReport = parseJson<any>(jesterRaw);
                logicReport = parseJson<NigsFactReport>(logicRaw);
                marketReport = parseJson<any>(marketRaw);
                litReport = parseJson<any>(litRaw);

                this.updateStatus("FORENSIC SYSTEM SCAN (WITH LOGIC INJECTION)...", onStatus, currentBase + 35);

                // [LOGIC INJECTION]: Pass logic findings to Scribe
                const forensicInput = `${currentInputPayload}\n\n[LOGIC AGENT REPORT]:\nInconsistencies: ${JSON.stringify(logicReport.inconsistencies)}\nLuck Incidents: ${JSON.stringify(logicReport.luck_incidents)}`;

                forensicRaw = await this.callAI(forensicInput, NIGS_SYSTEM_PROMPT, true, false, logicTemp, signal, undefined, onStatus).catch(e => `{"error": "Forensic Failed"}`);
            }

            const forensicReport = parseJson<NigsResponse>(forensicRaw);

            // [FIX]: Market Agent Error Handling
            if (marketReport.error || typeof marketReport.commercial_score !== 'number') {
                marketReport = { 
                    commercial_score: 0, 
                    commercial_reason: "Market analysis unavailable. Defaulting to neutral.",
                    log_line: "Analysis failed."
                };
            }

            // [SYSTEM TUNING] CONSISTENCY CHECK
            // We verify that the Market Agent analyzed the correct story by comparing loglines.
            if (!isSpeedMode) {
                const marketLogline = marketReport.log_line || "";

                // [FIX]: If Market Agent failed, we cannot verify integrity via Logline. Skip check to prevent loop lock.
                if (marketLogline === "Analysis failed." || marketLogline.length < 5) {
                    this.updateStatus("INTEGRITY CHECK SKIPPED (MARKET DATA UNAVAILABLE)...", onStatus, currentBase + 38);
                } else {
                    this.updateStatus("SYSTEM GUARD: VERIFYING CONTEXT INTEGRITY...", onStatus, currentBase + 38);

                    // Fast check using Grade Analyst Prompt
                    const integrityPrompt = `
[INPUT A - ARTIFACT SNIPPET]:
${text.substring(0, 500)}...

[INPUT B - AGENT ANALYSIS]:
${marketLogline}

[TASK]: Does Input B describe Input A?
If Input A is about "Space" and Input B mentions "Elves", return FAIL.

Return JSON: { "verdict": "PASS" | "FAIL", "reason": "Short reason." }
`;
                    // Use fast model (0.1 temp)
                    const integrityRaw = await this.callAI(integrityPrompt, NIGS_GRADE_ANALYST_PROMPT, true, false, 0.1, signal, undefined, onStatus, this.settings.fastModelId);
                    const integrityCheck = parseJson<{ verdict: string, reason: string }>(integrityRaw);

                    if (integrityCheck.verdict === "FAIL") {
                        console.error(`CONTEXT INTEGRITY FAILURE: ${integrityCheck.reason}`);
                        previousConsensus += `\n[SYSTEM ERROR]: The previous analysis failed integrity check. The agent analyzed the wrong text. IGNORE previous context. FOCUS ON THE ARTIFACT.`;
                        // Trigger retry immediately by skipping to end of loop condition (effectively 'continue' logic but inside do-while)
                        this.updateStatus(`INTEGRITY FAIL: ${integrityCheck.reason}. RETRYING...`, onStatus);
                        continue; // Skip directly to next attempt
                    }
                }
            }

            // --- CHIEF JUSTICE ARBITRATION ---
            this.updateStatus("CHIEF JUSTICE: DELIBERATING...", onStatus, currentBase + 40);

            const arbitrationPayload = `
[TRIBUNAL REPORTS]:
1. SOUL: Score ${soulReport.score} (${soulReport.mood}) - ${soulReport.critique}
2. LOGIC: Score ${logicReport.score} - ${logicReport.inconsistencies.length} plot holes, ${logicReport.deus_ex_machina_count} Deus Ex Machinas.
3. MARKET: ${JSON.stringify(marketReport)}
4. LIT: ${JSON.stringify(litReport)}
5. JESTER: ${JSON.stringify(jesterReport)}

[FORENSIC DATA (FACTS)]:
- Sanderson Metrics: ${JSON.stringify(forensicReport.sanderson_metrics)}
- Tension Arc: ${JSON.stringify(forensicReport.tension_arc)}
- Quality Arc: ${JSON.stringify(forensicReport.quality_arc)}
- Structure Map: ${JSON.stringify(forensicReport.structure_map)}

[GENRE CONTEXT]: ${context?.inspiration || "Unknown"}
[SETTINGS]:
- Logic Weight: ${this.settings.agentWeights.logic}
- Soul Weight: ${this.settings.agentWeights.soul}
- Luck Tolerance: ${this.settings.luckTolerance}
`;

            // [OPTIMIZATION]: Use Configured Fast Model for Arbitration
            const arbitratorModelOverride = this.settings.fastModelId && this.settings.fastModelId.trim().length > 0
                ? this.settings.fastModelId
                : undefined;

            const arbitrationRaw = await this.callAI(arbitrationPayload, NIGS_ARBITRATOR_PROMPT, true, false, 0.2, signal, undefined, onStatus, arbitratorModelOverride);
            const arbitrationLog = parseJson<NigsArbitrationLog>(arbitrationRaw);

            // --- SYNTHESIS (Generating Final NigsResponse) ---
            finalResponse = forensicReport;

            // Apply Arbitration Overrides
            // [UPDATED] Sum of Agent Scores
            const marketScore = marketReport.commercial_score || 0;
            const logicScore = logicReport.score || 0;
            const soulScore = soulReport.score || 0;
            const litScore = litReport.score || 0;
            const jesterScore = jesterReport.score_modifier || 0;

            // [FIX]: Double Jeopardy - Use Chief Justice Verdict directly
            let finalScore = arbitrationLog.final_verdict;
            
            // [FIX]: Clamp Score
            finalScore = Math.max(-200, Math.min(200, finalScore));

            finalResponse.commercial_score = finalScore;
            finalResponse.commercial_reason = `[CHIEF JUSTICE RULING]: ${arbitrationLog.ruling}`;

            // Map specific agent scores
            finalResponse.niche_score = soulReport.score; // Mapping Soul to Niche/Lit slot primarily
            finalResponse.niche_reason = soulReport.critique;
            finalResponse.cohesion_score = logicReport.score;
            finalResponse.cohesion_reason = `Plot Holes: ${logicReport.inconsistencies ? logicReport.inconsistencies.length : 0}`;

            // Attach Arbitration Log
            finalResponse.arbitration_log = arbitrationLog;

            // Populate Full Tribunal Breakdown
            finalResponse.tribunal_breakdown = {
                market: marketReport,
                logic: logicReport,
                soul: soulReport,
                lit: litReport,
                jester: jesterReport
            };

            // --- VETO PROTOCOL (Logic Hard Fail) ---
            if (logicReport.score < 0) {
                 const vetoFactor = 1 / 6;
                 finalResponse.commercial_score = Math.round(finalResponse.commercial_score * vetoFactor);
                 finalResponse.commercial_reason += " [LOGIC VETO: Score Slashed]";
            }

            // --- GRADE ANALYST CHECK ---
            // [OPTIMIZATION]: Skip Analyst loop in Speed mode to save time/tokens
            if (isSpeedMode) {
                isApproved = true;
                this.updateStatus("GRADE ANALYST: SKIPPED (SPEED MODE).", onStatus, currentBase + 50);
            } else {
                this.updateStatus("GRADE ANALYST: VERIFYING OUTPUT...", onStatus, currentBase + 50);
                // [FIX]: Ensure Input B matches Input A to prevent Veto Logic from causing false positive validation failures
                const analystPrompt = `
[INPUT A - CHIEF JUSTICE VERDICT]: ${arbitrationLog.final_verdict}
[INPUT B - FINAL REPORT SCORE]: ${arbitrationLog.final_verdict}
[INPUT C - REASONING]: ${finalResponse.commercial_reason}

[TASK]: Compare Input A and Input B. 
1. If they do not match, return FAIL.
2. If the Reason contradicts the Score (e.g. "Loved it" but score is -50), return FAIL.

Return JSON: { "verdict": "PASS" | "FAIL", "reason": "Short reason." }
`;
                const analystResStr = await this.callAI(analystPrompt, NIGS_GRADE_ANALYST_PROMPT, true, false, 0.2, signal, undefined, onStatus);
                const analystRes = parseJson<{ verdict: string, reason: string }>(analystResStr);

                if (analystRes.verdict === "PASS") {
                    isApproved = true;
                    this.updateStatus("GRADE ANALYST: APPROVED.", onStatus, currentBase + 60);
                } else {
                    console.warn(`GRADE ANALYST REJECTED (Attempt ${attempts}): ${analystRes.reason}`);
                    this.updateStatus(`ANALYST REJECTED: ${analystRes.reason}. RETRYING...`, onStatus);

                    // [SYSTEM TUNING] TOKEN OPTIMIZATION
                    // Do not pass full reports. Only pass the rejection reason and a brief summary of the failure.
                    previousConsensus = `[PREVIOUS FAILURE SUMMARY]:
- Score: ${arbitrationLog.final_verdict}
- Reason: ${finalResponse.commercial_reason}
- REJECTION CAUSE: ${analystRes.reason}
- INSTRUCTION: FIX the issues identified in the Rejection Cause.
`;
                }
            }

        } while (!isApproved && attempts < maxAttempts);

        if (!finalResponse) throw new Error("Grading failed: Context Integrity Check failed on all attempts. Try 'Speed Mode' or check AI Model status.");

        this.updateStatus("FINALIZING...", onStatus, 100);
        return finalResponse;
    }


    private gradeContentLegacy = async (text: string, context?: { inspiration: string; target: number }, nlpStats?: NlpMetrics, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<NigsResponse> => {
        // [LEGACY] Map "Cores" to Analysis Passes
        const passes = Math.max(1, Math.min(10, this.settings.criticCores || 1));
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
        
        this.updateStatus(`INITIALIZING ${passes} FORENSIC CORES...`, onStatus, 5);
        
        // Enforce STRICT temperature for Grading
        const temp = this.getTemp(this.settings.tempCritic, true);

        const promises = Array.from({ length: passes }, (_, i) => {
            return this.callAI(wrapped, NIGS_SYSTEM_PROMPT, true, false, temp, signal, undefined, onStatus)
                .then(resStr => parseJson<NigsResponse>(resStr))
                .catch(e => { console.error(`Core ${i+1} Failed:`, e); return null; });
        });

        // This is a rough progress tracker for parallel promises
        // Since we can't update per promise easily here without wrapping, we just jump to 90
        const results = (await Promise.all(promises)).filter((r): r is NigsResponse => r !== null);

        if (results.length === 0) throw new Error("ALL CORES FAILED.");
        
        this.updateStatus("SYNTHESIZING FORENSIC REPORT...", onStatus, 90);
        
        const finalRes = this.averageResults(results);
        if (results[0].thought_process) finalRes.thought_process = results[0].thought_process;

        this.updateStatus("DONE", onStatus, 100);
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

        // [UPDATED] Average Beat Quality Arc if present (Signed Integers)
        const maxQualLen = results.reduce((max, r) => Math.max(max, r.quality_arc?.length || 0), 0) || 6;
        base.quality_arc = Array.from({ length: maxQualLen }, (_, idx) =>
             Math.round(results.reduce((sum, r) => sum + (r.quality_arc?.[idx] || 0), 0) / count)
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

    // --- PASSTHROUGHS ---
    generateOutline = async (text: string, useSearch = false, signal?: AbortSignal, images?: ImageInput[], onStatus?: StatusUpdate) => {
        this.updateStatus("INITIALIZING ARCHIVIST PROTOCOL...", onStatus, 5);
        const prompt = this.settings.customOutlinePrompt ? this.settings.customOutlinePrompt : NIGS_OUTLINE_PROMPT;
        const temp = this.getTemp(this.settings.tempArchitect);

        // [BATCH] Use user-defined batch size (Default 10)
        const batchSize = this.settings.forgeImageBatchLength || 10;

        if (images && images.length > batchSize) {
            const batches = Math.ceil(images.length / batchSize);
            const batchSummaries: string[] = new Array(batches).fill("");

            // [OPTIMIZATION]: Parallel Map-Reduce for Faster Processing
            const CONCURRENCY = 5; // Safe default for most APIs

            for (let i = 0; i < batches; i += CONCURRENCY) {
                if (signal?.aborted) throw new Error("Cancelled by user.");

                const chunk = Array.from({ length: Math.min(CONCURRENCY, batches - i) }, (_, k) => i + k);

                this.updateStatus(`ARCHIVIST: PROCESSING BATCHES ${i + 1}-${i + chunk.length}/${batches}...`, onStatus, Math.round((i / batches) * 80));

                await Promise.all(chunk.map(async (batchIdx) => {
                    const start = batchIdx * batchSize;
                    const end = start + batchSize;
                    const batchImages = images.slice(start, end);

                    const batchPrompt = `[BATCH ${batchIdx + 1}/${batches}]: Analyze these pages.`;

                    // MAP PHASE: Use Batch Analysis Prompt (Concise extraction)
                    const result = await this.callAI(batchPrompt, NIGS_BATCH_ANALYSIS_PROMPT, false, false, temp, signal, batchImages, undefined);
                    batchSummaries[batchIdx] = `=== BATCH ${batchIdx + 1} SUMMARY ===\n${result}`;
                }));
            }

            this.updateStatus("ARCHIVIST: SYNTHESIZING FULL REPORT...", onStatus, 90);

            // REDUCE PHASE: Synthesize all summaries into final output
            const fullContext = batchSummaries.join("\n\n");
            const synthesisPrompt = `
[TASK]: Synthesize the following sequential comic book batch summaries into a SINGLE cohesive Narrative Report.

[USER INSTRUCTION]:
${text}

[BATCH SUMMARIES]:
${fullContext}
`;
            const finalRes = await this.callAI(synthesisPrompt, prompt, false, useSearch, temp, signal, undefined, onStatus);

            this.updateStatus("DONE", onStatus, 100);
            return finalRes;
        }

        const res = await this.callAI(text, prompt, false, useSearch, temp, signal, images, onStatus);
        this.updateStatus("DONE", onStatus, 100);
        return res;
    }

    // [UPDATED] Pass Scan Telemetry to Action Plan
    getActionPlan = async (text: string, focus?: string, deepScan?: NigsResponse, quickScan?: NigsLightGrade, signal?: AbortSignal, onStatus?: StatusUpdate) => {
        this.updateStatus("ANALYZING WEAKNESSES...", onStatus, 10);
        
        let diagnosticBlock = "";
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
                if (deepScan.tribunal_breakdown.logic) specificComplaints += `1. LOGIC ENGINE DEMANDS: ${deepScan.tribunal_breakdown.logic.content_warning || "None"}\n`;
                if (deepScan.tribunal_breakdown.market) specificComplaints += `2. MARKET ANALYST DEMANDS: ${deepScan.tribunal_breakdown.market.commercial_reason || "None"}\n`;
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

        if (specificComplaints) {
            inputBlock = `[PRIORITY FIXES REQUIRED BY TRIBUNAL]:\n${specificComplaints}\n\n${inputBlock}`;
        }

        if (focus && focus.trim().length > 0) inputBlock = `USER DIRECTIVE: Focus on "${focus}".\n\n${inputBlock}`;
        
        const temp = this.getTemp(this.settings.tempArchitect);
        const res = await this.callAI(inputBlock, NIGS_FORGE_PROMPT, true, false, temp, signal, undefined, onStatus);

        this.updateStatus("DONE", onStatus, 100);
        return parseJson<NigsActionPlan>(res);
    }

    autoRepair = async (text: string, plan: NigsActionPlan, signal?: AbortSignal, onStatus?: StatusUpdate) => {
        this.updateStatus("INITIATING SMART REPAIR SEQUENCE...", onStatus, 5);
        const prompt = this.settings.customRepairPrompt ? this.settings.customRepairPrompt : NIGS_AUTO_REPAIR_PROMPT;

        // [INTELLIGENCE UPGRADE]: Inject Tribunal Complaints directly into Repair Context
        let deepScanContext = "";
        // If the plan has thought process or specific instructions, emphasize them
        if (plan.weakest_link) {
            deepScanContext += `\n[DIAGNOSED WEAKNESS]: ${plan.weakest_link}\n`;
        }

        const baseInput = `
[REPAIR PLAN]:
${JSON.stringify(plan)}

${deepScanContext}

[TEXT TO REPAIR]:
${text}
`;

        // Enforce STRICT temperature for Repair
        const temp = this.getTemp(this.settings.tempRepair, true);

        // --- SMART REPAIR LOOP [UPDATED: TREE OF THOUGHTS] ---
        // "Make it so the auto repair won't stop until there are no perceived flaws in the story"
        // We set a safe limit (e.g. 5) to prevent infinite loops, but we use the Analyst to verify.
        let attempts = 0;
        const maxAttempts = 5;
        let isApproved = false;
        let currentResult = "";
        let previousCritique = "";

        do {
            attempts++;
            const progressBase = 10;
            const progressStep = Math.floor(80 / maxAttempts);
            const currentProgress = progressBase + ((attempts - 1) * progressStep);

            if (attempts > 1) {
                this.updateStatus(`REPAIR AGENT: REFINING (ATTEMPT ${attempts}/${maxAttempts})...`, onStatus, currentProgress);
            } else {
                this.updateStatus("REPAIR AGENT: EXECUTING FIX...", onStatus, currentProgress);
            }

            // Construct Prompt with Critique if retrying
            let currentInput = baseInput;
            if (previousCritique) {
                currentInput += `\n\n[PREVIOUS ATTEMPT FAILED]:\nThe previous repair was rejected because: ${previousCritique}\n\n[INSTRUCTION]: FIX the issues identified above while executing the original plan.`;
            }

            // 1. Generate Repair (Tree of Thoughts: Implicitly generated by the AI as per new prompt)
            this.updateStatus("REPAIR AGENT: GENERATING OPTIONS (TREE OF THOUGHTS)...", onStatus, currentProgress + 5);
            currentResult = await this.callAI(currentInput, prompt, false, false, temp, signal, undefined, onStatus);

            // 2. Verify Repair (The "Perceived Flaws" Check)
            this.updateStatus("QUALITY CONTROL: VERIFYING INTEGRITY...", onStatus, currentProgress + 10);

            const verifyPrompt = `
[TASK]: Verify this repaired text.
[CRITERIA]:
1. Does it follow the Repair Plan?
2. Are there NEW plot holes or contradictions introduced?
3. Are character voices consistent?
4. Is the logic sound?

[REPAIR PLAN]:
${JSON.stringify(plan)}

[REPAIRED TEXT (Snippet)]:
${currentResult.substring(0, 8000)}...

Return JSON: { "verdict": "PASS" | "FAIL", "reason": "Short reason." }
`;
            // Use Analyst Prompt for verification
            const reviewRaw = await this.callAI(verifyPrompt, NIGS_GRADE_ANALYST_PROMPT, true, false, 0.2, signal, undefined, onStatus);
            const review = parseJson<{ verdict: string, reason: string }>(reviewRaw);

            if (review.verdict === "PASS") {
                isApproved = true;
                this.updateStatus("QUALITY CONTROL: APPROVED.", onStatus, currentProgress + 15);
            } else {
                console.warn(`REPAIR REJECTED (Attempt ${attempts}): ${review.reason}`);
                previousCritique = review.reason;
                if (attempts >= maxAttempts) {
                    this.updateStatus("MAX RETRIES REACHED. RETURNING BEST EFFORT.", onStatus, 95);
                }
            }

        } while (!isApproved && attempts < maxAttempts);

        this.updateStatus("DONE", onStatus, 100);
        return currentResult;
    }
    
    getMetaAnalysis = async (text: string, signal?: AbortSignal, onStatus?: StatusUpdate) => {
        this.updateStatus("RUNNING DIAGNOSTICS...", onStatus, 10);
        const temp = this.getTemp(this.settings.tempCritic, true);
        const res = await this.callAI(text, NIGS_META_PROMPT, true, false, temp, signal, undefined, onStatus);
        this.updateStatus("DONE", onStatus, 100);
        return parseJson<NigsMetaResponse>(res);
    }
    
    getLightGrade = async (text: string, signal?: AbortSignal, onStatus?: StatusUpdate) => {
        this.updateStatus("PERFORMING QUICK SCAN...", onStatus, 10);
        const temp = this.getTemp(this.settings.tempCritic, true);
        const res = await this.callAI(text, NIGS_QUICK_SCAN_PROMPT, true, false, temp, signal, undefined, onStatus);
        this.updateStatus("DONE", onStatus, 100);
        return parseJson<NigsLightGrade>(res);
    }
    
    // --- CHARACTER AUTO-GRADER ---
    gradeCharacter = async (char: CharacterBlock, context: string, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<CharacterBlock> => {
        this.updateStatus(`ANALYZING ${char.name.toUpperCase()}...`, onStatus, 10);
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
        const res = await this.callAI(prompt, NIGS_WIZARD_ASSIST_PROMPT, true, false, temp, signal, undefined, onStatus);
        const data = parseJson<any>(res);
        
        this.updateStatus("DONE", onStatus, 100);
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
    gradeStructureBeat = async (beat: StoryBlock, context: string, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<StoryBlock> => {
        this.updateStatus(`ANALYZING STORY BEAT...`, onStatus, 10);
        const prompt = `
        Analyze this story beat. 
        1. CLASSIFY: Determine structural role.
        2. TENSION: Estimate narrative tension (-100 to +100).
        
        [UPLOADED SOURCE]: ${context}...
        [BEAT]: ${beat.title} - ${beat.description}

        RETURN JSON: { "tension": number, "type": "The determined type" }
        `;
        
        const temp = this.getTemp(this.settings.tempCritic, true);
        const res = await this.callAI(prompt, NIGS_WIZARD_ASSIST_PROMPT, true, false, temp, signal, undefined, onStatus);
        const data = parseJson<{ tension: number, type: any }>(res);
        
        this.updateStatus("DONE", onStatus, 100);
        return {
            ...beat,
            tension: data.tension ?? beat.tension,
            type: data.type ?? beat.type
        };
    }

    // --- ASSIST WIZARD (Logic Hardened + Name Protocol) & [NEW] Thinking Agent ---
    assistWizard = async (field: string, state: NigsWizardState, signal?: AbortSignal, onStatus?: StatusUpdate) => {
        this.updateStatus("CONSULTING NARRATIVE DATABASE...", onStatus, 10);
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

        // --- WIZARD AGENT LOOP (Creative Consultant) ---
        let attempts = 0;
        const maxAttempts = (this.settings.wizardAgentEnabled) ? (this.settings.wizardAgentMaxRetries || 1) + 1 : 1;
        let isApproved = false;
        let suggestion = "";
        let previousCritique = "";

        do {
            attempts++;
            const progressBase = 10;
            const progressChunk = 80 / maxAttempts;
            const currentProgress = progressBase + ((attempts - 1) * progressChunk);

            if (attempts > 1) this.updateStatus(`CREATIVE CONSULTANT: REFINING IDEA (ATTEMPT ${attempts})...`, onStatus, currentProgress);

            const currentPrompt = previousCritique ? `${prompt}\n\n[PREVIOUS CRITIQUE]: The previous suggestion was rejected because: ${previousCritique}. TRY AGAIN.` : prompt;

            const res = await this.callAI(currentPrompt, NIGS_WIZARD_ASSIST_PROMPT, true, true, temp, signal, undefined, onStatus);
            const data = parseJson<{ suggestion: string }>(res);
            suggestion = data.suggestion;

            // If Agent disabled, accept first draft
            if (!this.settings.wizardAgentEnabled) {
                this.updateStatus("DONE", onStatus, 100);
                return suggestion;
            }

            // [AGENT REVIEW]
            this.updateStatus("CREATIVE CONSULTANT: REVIEWING...", onStatus, currentProgress + 10);
            const reviewPrompt = `
[TASK]: Review this narrative suggestion.
[CRITERIA]:
1. Is it clichéd? (Fail if yes).
2. Does it respect the constraints?
3. Is it logically tight?

[SUGGESTION]: "${suggestion}"

Return JSON: { "verdict": "PASS" | "FAIL", "reason": "Short reason." }
`;
            const reviewRaw = await this.callAI(reviewPrompt, NIGS_GRADE_ANALYST_PROMPT, true, false, 0.2, signal, undefined, onStatus);
            const review = parseJson<{ verdict: string, reason: string }>(reviewRaw);

            if (review.verdict === "PASS") {
                isApproved = true;
                this.updateStatus("CREATIVE CONSULTANT: APPROVED.", onStatus, 95);
            } else {
                console.warn(`WIZARD AGENT REJECTED: ${review.reason}`);
                previousCritique = review.reason;
                if (attempts >= maxAttempts) {
                    this.updateStatus("MAX RETRIES REACHED. RETURNING BEST EFFORT.", onStatus, 95);
                }
            }
        } while (!isApproved && attempts < maxAttempts);

        this.updateStatus("DONE", onStatus, 100);
        return suggestion;
    }
    
    wizardCompose = async (state: NigsWizardState, signal?: AbortSignal, onStatus?: StatusUpdate) => {
        this.updateStatus("ARCHITECTING OUTLINE...", onStatus, 10);
        const targetQ = state.targetScore || this.settings.defaultTargetQuality;

        const negativeConstraints = this.settings.wizardNegativeConstraints ?
            `\n[NEGATIVE CONSTRAINTS (DO NOT USE)]: ${this.settings.wizardNegativeConstraints}\n` : "";

        // [UPDATED] Inject Name Protocol
        const nameRules = this.getNameProtocol();

        const promptContext = `
        [SOURCE DATA]:
        ${JSON.stringify(state, null, 2)}
        
        [TARGET QUALITY]: ${targetQ}/100.

        ${negativeConstraints}
        ${nameRules}

        [INSTRUCTION]: 
        Using the source data above, write a formatted Markdown document. Do not output JSON.
        Ensure every scene and character beat is generated to meet the Target Quality.
        `;
        const temp = this.getTemp(this.settings.tempArchitect);
        const res = await this.callAI(promptContext, NIGS_WIZARD_COMPOSITION_PROMPT, false, false, temp, signal, undefined, onStatus);
        this.updateStatus("DONE", onStatus, 100);
        return res;
    }

    // --- DEEP RENAME (NEW) ---
    generateDeepNames = async (text: string, context: string, signal?: AbortSignal, onStatus?: StatusUpdate): Promise<Record<string, string>> => {
        this.updateStatus("ETYMOLOGIST ACTIVE: DEEP RENAMING...", onStatus, 10);
        
        const input = `
        [SOURCE MATERIAL CONTEXT]:
        ${context.substring(0, 1000)}...

        [TEXT TO PROCESS]:
        ${text.substring(0, 50000)}... (Truncated for token limit)
        `;

        // Use Wizard Temp for creativity
        const temp = this.getTemp(this.settings.tempWizard);
        const res = await this.callAI(input, NIGS_RENAME_PROMPT, true, false, temp, signal, undefined, onStatus);

        this.updateStatus("DONE", onStatus, 100);
        return parseJson<Record<string, string>>(res);
    }
}
