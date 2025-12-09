<script lang="ts">
    import { onMount } from 'svelte';
    import { TFile, App, Notice } from 'obsidian';
    import type { CloudGenService } from './CloudGen';
    import type { NigsSettings, ProjectData, CharacterBlock, StoryBlock, DriveBlock, NigsWizardState, NigsActionPlan } from './types';
    import { DEFAULT_WIZARD_STATE } from './types'; 
    import { db, type GlobalForgeData } from './db';
    import { NlpService } from './nlp';
    import { autoResize, debounce } from './utils';
    import { ForgeOps } from './ForgeOps';
    import { ReportGen } from './ReportGen';
    import WizardView from './WizardView.svelte';
    import CriticDisplay from './CriticDisplay.svelte';
    import Win95ProgressBar from './Win95ProgressBar.svelte';
    import TuneView from './TuneView.svelte';
    import { processRegistry, processOrigin, startProcess, updateProcessStatus, activeProcesses, finishProcess, cancelProcess } from './store';

    interface Props {
        app: App;
        cloud: CloudGenService;
        settings: NigsSettings;
        onUpdateSettings: (s: Partial<NigsSettings>) => void;
    }

    let { app, cloud, settings: initialSettings, onUpdateSettings }: Props = $props();
    let settings = $state(initialSettings);
    let activeFile: TFile | null = $state(null);
    let projectData: ProjectData | null = $state(null);
    let wizardData: NigsWizardState | null = $state(null);
    let forgeData: GlobalForgeData | null = $state(null);
    let currentTab = $state('critic');
    let isSaving = $state(false);
    let estimatedDuration = $state(4000);
    let wizardLoadingField: string | null = $state(null);
    let uploadedImages: { data: string, mimeType: string }[] = $state([]);
    
    // Sync States
    let isContextSynced = $state(false);
    let isArchivistSynced = $state(false);
    
    // [WIN95 UPDATE] Quick Scan Dropdown State
    let showQuickScanMenu = $state(false);

    let archivistLength = $derived(forgeData?.archivistContext ? forgeData.archivistContext.length : 0);
    let hasArchivistData = $derived(archivistLength > 0);
    let hasImages = $derived(uploadedImages.length > 0);

    // [FIX]: Moved logic from template to script to prevent build errors with Optional Chaining in HTML
    let activeFileStatus = $derived(
        activeFile && $processRegistry[activeFile.path] ? 'PROCESSING' : 'READY'
    );

    // [FIX]: Loading state for project data
    let isProjectDataLoading = $derived(activeFile && !projectData);

    // Tracks active process IDs for UI placement
    let processMap: Record<string, string> = $state({}); // key: context (e.g. 'critic_main'), value: processId

    // [OPTIMIZATION] Debounced save for text inputs
    const debouncedSave = debounce(() => saveAll(false), 1000);

    function handleSettingsUpdate(updates: Partial<NigsSettings>) {
        Object.assign(settings, updates);
        onUpdateSettings(updates);
    }
    
    // [NEW] Handle Drive Updates Locally
    function handleDrivesUpdate(newDrives: DriveBlock[]) {
        if (!wizardData) return;
        wizardData.synthesisDrives = newDrives;
        saveAll(false);
    }

    function handleError(context: string, error: any, processId?: string) {
        console.error(`[Compu-Judge] ${context} Error:`, error);
        let msg = error instanceof Error ? error.message : String(error);
        msg = msg.replace(/^Error:\s*/i, "").replace(/^Gemini Error:\s*/i, "");
        if (msg.includes("429")) msg = "Rate Limit Exceeded. Please wait.";
        if (msg.includes("401") || msg.includes("403")) msg = "Invalid API Key or Permissions.";
        if (msg.includes("TIMEOUT")) msg = "AI Timeout. Task was too heavy.";
        
        new Notice(`❌ ${context}: ${msg}`, 6000);
        wizardLoadingField = null;

        if (processId) {
            cancelProcess(processId);
        }
    }

    export const updateActiveFile = async (file: TFile | null) => {
        if (activeFile?.path === file?.path) return;

        // [FIX]: Robust null check to prevent clearing if unnecessary
        if (file === null && activeFile !== null) {
            // Verify if we really want to clear (e.g. all files closed)
            const leaves = app.workspace.getLeavesOfType("markdown");
            if (leaves.length > 0) return; // Keep last state if markdown files exist
        }

        activeFile = file;
        projectData = null; 
        if (file) await loadProjectData(file);
    };

    // Removed updateTheme as theme is constant now

    async function loadProjectData(file: TFile) {
        try { 
            const loadedData = await db.getProjectData(file.path);
            if (activeFile && activeFile.path === file.path) {
                projectData = loadedData;
                await checkAllSyncs();
            }
        } catch (e: any) { 
            handleError("Load Data", e);
        }
    }

    async function loadGlobalData() {
        try {
            wizardData = await db.getGlobalWizardData();
            forgeData = await db.getGlobalForgeData();
            await checkAllSyncs();
        } catch (e: any) {
            handleError("Load Global Data", e);
        }
    }

    async function saveAll(updateMtime: boolean = false) {
        isSaving = true;
        try {
            // Save Critic Data (File Specific)
            if (projectData && activeFile) {
                if (updateMtime && activeFile instanceof TFile) {
                    projectData.lastAnalysisMtime = activeFile.stat.mtime;
                }
                await db.saveProjectData(projectData, projectData.lastAnalysisMtime);
            }

            // Save Global Wizard Data
            if (wizardData) {
                await db.saveGlobalWizardData(wizardData);
            }

            // Save Global Forge Data
            if (forgeData) {
                await db.saveGlobalForgeData(forgeData);
            }

            await checkAllSyncs();
        } catch(e) {
            handleError("Save Failed", e);
        } finally {
            setTimeout(() => isSaving = false, 300);
        }
    }

    async function checkAllSyncs() {
        if (!activeFile || !wizardData || !forgeData) {
            isContextSynced = false;
            isArchivistSynced = false;
            return;
        }
        try {
            const content = (await app.vault.read(activeFile)).trim();
            if (!content) {
                isContextSynced = true;
                isArchivistSynced = true;
                return;
            }
            const wizCtx = wizardData.inspirationContext || "";
            isContextSynced = wizCtx.includes(content);
            const arcCtx = forgeData.archivistContext || "";
            isArchivistSynced = arcCtx === content || (arcCtx.length > 0 && arcCtx.includes(content.substring(0, 100)));
        } catch {
            isContextSynced = false;
            isArchivistSynced = false;
        }
    }

    async function getActiveFileContent(): Promise<string> {
        if (!activeFile) return "";
        return await app.vault.read(activeFile);
    }

    async function updateActiveFileContent(newContent: string) {
        if (!activeFile) return;
        await app.vault.modify(activeFile, newContent);
    }

    async function updateFrontMatter(grade: any) {
        if (!activeFile) return;
        try {
            await app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                // BASIC SCORING
                frontmatter['critic_score'] = grade.score || grade.commercial_score;
                frontmatter['critic_grade'] = grade.letter_grade || (grade.commercial_score >= 90 ? 'S' : grade.commercial_score >= 80 ? 'A' : grade.commercial_score >= 60 ? 'B' : 'C');
                frontmatter['critic_date'] = new Date().toISOString().split('T')[0];

                // QUICK SCAN DATA
                if (grade.summary_line) frontmatter['critic_summary'] = grade.summary_line;
                if (grade.synopsis) frontmatter['critic_synopsis'] = grade.synopsis;
                if (grade.key_improvement) frontmatter['critic_key_improvement'] = grade.key_improvement;
                if (grade.outline_summary) frontmatter['critic_outline_summary'] = grade.outline_summary;

                // DEEP SCAN / TRIBUNAL DATA
                if (grade.commercial_score !== undefined) {
                    if (grade.log_line) frontmatter['critic_logline'] = grade.log_line;
                    if (grade.commercial_reason) frontmatter['critic_commercial_reason'] = grade.commercial_reason;
                    if (grade.niche_score !== undefined) frontmatter['critic_niche_score'] = grade.niche_score;
                    if (grade.niche_reason) frontmatter['critic_niche_reason'] = grade.niche_reason;
                    if (grade.cohesion_score !== undefined) frontmatter['critic_cohesion_score'] = grade.cohesion_score;
                    if (grade.cohesion_reason) frontmatter['critic_cohesion_reason'] = grade.cohesion_reason;
                    if (grade.content_warning) frontmatter['critic_content_warning'] = grade.content_warning;
                    if (grade.third_act_score !== undefined) frontmatter['critic_third_act_score'] = grade.third_act_score;
                    if (grade.novelty_score !== undefined) frontmatter['critic_novelty_score'] = grade.novelty_score;

                    // COMPLEX OBJECTS
                    if (grade.sanderson_metrics) frontmatter['critic_sanderson_metrics'] = grade.sanderson_metrics;
                    if (grade.detailed_metrics) frontmatter['critic_detailed_metrics'] = grade.detailed_metrics;
                    if (grade.tribunal_breakdown) frontmatter['critic_tribunal_breakdown'] = grade.tribunal_breakdown;
                    if (grade.arbitration_log) frontmatter['critic_arbitration_log'] = grade.arbitration_log;
                    if (grade.structure_map) frontmatter['critic_structure_map'] = grade.structure_map;
                    if (grade.tension_arc) frontmatter['critic_tension_arc'] = grade.tension_arc;
                    if (grade.quality_arc) frontmatter['critic_quality_arc'] = grade.quality_arc;
                }
            });
        } catch (e) {
            console.error("Failed to update frontmatter", e);
        }
    }

    async function handleUploadContext() {
        if (!activeFile || !wizardData) return;
        try {
            const content = await app.vault.read(activeFile);
            if (!content.trim()) return new Notice("File is empty.");
            const currentContext = wizardData.inspirationContext || "";
            const newContext = currentContext ?
            `${currentContext}\n\n[IMPORTED SOURCE]:\n${content}` : `[IMPORTED SOURCE]:\n${content}`;
            wizardData.inspirationContext = newContext;
            new Notice("Wizard Memory Updated.");
            await saveAll(false);
        } catch (e: any) { handleError("Memory Upload", e); }
    }

    function handleScrubContext() {
        if (!wizardData) return;
        if (confirm("Purge Inspiration Memory?")) {
            wizardData.inspirationContext = "";
            saveAll(false);
            new Notice("Wizard Memory Purged.");
        }
    }

    function handleClearWizardState() {
        if (!wizardData) return;
        if (confirm("Clear all Wizard fields? (Memory/Context will be kept)")) {
            const currentContext = wizardData.inspirationContext;
            const defaults = JSON.parse(JSON.stringify(DEFAULT_WIZARD_STATE));
            wizardData = {
                ...defaults,
                inspirationContext: currentContext
            };
            saveAll(false);
            new Notice("Wizard Fields Cleared.");
        }
    }

    async function handleUploadArchivist() {
        if (!activeFile || !forgeData) return;
        try {
            const content = await app.vault.read(activeFile);
            if (!content.trim()) return new Notice("File is empty.");
            forgeData.archivistContext = content;
            new Notice("Archivist Memory Loaded.");
            await saveAll(false);
        } catch (e: any) { handleError("Buffer Load", e);
        }
    }

    // New function to handle image upload
    function handleImageUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        const files = target.files;
        if (!files || files.length === 0) return;

        let loadedCount = 0;
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                // result is data:image/jpeg;base64,....
                const parts = result.split(',');
                if (parts.length === 2) {
                    const mimeType = parts[0].split(':')[1].split(';')[0];
                    const base64 = parts[1];
                    uploadedImages = [...uploadedImages, { data: base64, mimeType }];
                    loadedCount++;
                }
            };
            reader.readAsDataURL(file);
        });
        setTimeout(() => new Notice(`${files.length} Images Loaded into Buffer.`), 500);
    }

    function clearImages() {
        uploadedImages = [];
        new Notice("Image Buffer Cleared.");
    }

    function handleScrubArchivist() {
        if (!forgeData) return;
        if (confirm("Clear Archivist Memory?")) {
            forgeData.archivistContext = "";
            uploadedImages = [];
            saveAll(false);
            new Notice("Archivist Memory Cleared.");
        }
    }

    // Modified startLoading to support new process system
    function startLoading(contextKey: string, duration = 4000, label = "PROCESSING...") {
        estimatedDuration = duration;

        // Generate a unique ID for this run
        const pid = `${contextKey}_${Date.now()}`;

        // Start process in store
        const controller = startProcess(pid, label, duration);

        // Track locally to render the correct bar
        processMap[contextKey] = pid;

        return { pid, controller };
    }
    
    function stopLoading(contextKey: string) {
        const pid = processMap[contextKey];
        if (pid) {
            finishProcess(pid);
            delete processMap[contextKey];
            wizardLoadingField = null;
        }
    }

    async function safeCreateFile(filename: string, content: string) {
        let finalPath = filename;
        const exists = await app.vault.adapter.exists(finalPath);
        if (exists) {
            finalPath = filename.replace(".md", `_${Date.now()}.md`);
        }
        const file = await app.vault.create(finalPath, content);
        new Notice(`Created: ${file.path}`);
        return file.path;
    }

    async function handleGradeCharacter(char: CharacterBlock): Promise<CharacterBlock> {
        if (!wizardData) return char;
        const contextKey = "WIZARD_GLOBAL"; // Independent of file
        const { pid, controller } = startLoading(contextKey, 3000, `ANALYZING ${char.name.toUpperCase()}...`);
        try {
            const context = wizardData.inspirationContext || "No context provided.";
            const updated = await cloud.gradeCharacter(
                char,
                context,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            new Notice(`Metrics Updated for ${char.name}`);
            return updated;
        } catch(e: any) { handleError("Character Grading", e, pid); return char; }
        finally { stopLoading(contextKey);
        }
    }

    async function handleGradeStructure(beat: StoryBlock): Promise<StoryBlock> {
        if (!wizardData) return beat;
        const contextKey = "WIZARD_GLOBAL";
        const { pid, controller } = startLoading(contextKey, 3000, `ANALYZING ${beat.type.toUpperCase()}...`);
        try {
            const context = wizardData.inspirationContext || "No context provided.";
            const updated = await cloud.gradeStructureBeat(
                beat,
                context,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            new Notice(`Tension Calculated for ${beat.title}`);
            return updated;
        } catch(e: any) { handleError("Structure Grading", e, pid); return beat; }
        finally { stopLoading(contextKey);
        }
    }

    async function runAnalysis() { 
        const file = activeFile;
        if (!file || !projectData || !wizardData) return;
        const content = await app.vault.read(file);
        const estTime = cloud.estimateDuration(content, 'scan');

        // Use file path as context key for critic operations
        const contextKey = file.path + "_CRITIC";

        const { pid, controller } = startLoading(contextKey, estTime, "CALCULATING METRICS...");
        try { 
            const nlpStats = NlpService.analyze(content);
            updateProcessStatus(pid, "SYNTHESIZING DEEP SCAN...", 10);
            const context = { inspiration: wizardData.inspirationContext, target: wizardData.targetScore };

            const result = await cloud.gradeContent(
                content,
                context,
                nlpStats,
                undefined, // wizardState
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );

            if (activeFile?.path !== file.path) return;
            projectData.lastAiResult = result; 
            projectData.lastAnalysisMtime = file.stat.mtime;
            await updateFrontMatter(result);
            await saveAll(true);
            new Notice("Deep Scan Complete.");
        } catch (e: any) { handleError("Deep Scan", e, pid);
        } 
        finally { stopLoading(contextKey);
        } 
    }

    async function runQuickScan() { 
        const file = activeFile;
        if (!file || !projectData) return; 
        const content = await app.vault.read(file);
        const estTime = cloud.estimateDuration(content, 'quick');

        const contextKey = file.path + "_CRITIC";
        const { pid, controller } = startLoading(contextKey, estTime, "QUICK SCANNING...");

        try { 
            const aiGrade = await cloud.getLightGrade(
                content,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            if (activeFile?.path !== file.path) return;
            const summary = `${aiGrade.summary_line}`;
            projectData.lastLightResult = { ...aiGrade, summary_line: summary };
            await updateFrontMatter(aiGrade);
            await saveAll(false);
        } catch (e: any) { handleError("Quick Scan", e, pid);
        } 
        finally { stopLoading(contextKey);
        } 
    }

    async function runMeta() { 
        if (!activeFile || !projectData) return;
        const path = activeFile.path; 
        const contextKey = path + "_CRITIC";
        const { pid, controller } = startLoading(contextKey, 4000, "META-ANALYSIS...");

        try { 
            const content = await app.vault.read(activeFile);
            const meta = await cloud.getMetaAnalysis(
                content,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            if (activeFile.path !== path) return;
            projectData.lastMetaResult = meta;
            await saveAll(false);
        } catch (e: any) { handleError("System Diagnostics", e, pid); }
        finally { stopLoading(contextKey);
        } 
    }

    async function runWizardAssist(fieldPath: string) { 
        if (!wizardData) return;
        const contextKey = "WIZARD_GLOBAL";
        wizardLoadingField = fieldPath;
        const { pid, controller } = startLoading(contextKey, 3000, "CONSULTING...");

        try { 
            const suggestion = await cloud.assistWizard(
                fieldPath,
                wizardData,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );

            const parts = fieldPath.split('.');
            let target: any = wizardData;
            for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
            const key = parts[parts.length - 1];
            if (target) {
                target[key] = suggestion;
                new Notice("Suggestion Applied.");
                await saveAll(false);
            }
        } catch(e: any) { handleError("Wizard Assist", e, pid);
        } 
        finally { stopLoading(contextKey);
        } 
    }

    async function runGhostwriter() { 
        if (!wizardData) return;
        const contextKey = "WIZARD_GLOBAL";
        const estTime = cloud.estimateDuration("generate comprehensive outline", 'architect');
        const { pid, controller } = startLoading(contextKey, estTime, "ARCHITECTING FULL OUTLINE...");

        try { 
            const synopsis = await cloud.wizardCompose(
                wizardData,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            const outputName = (wizardData.concept ? wizardData.concept.substring(0, 20).replace(/[^a-z0-9]/gi, '_') : "Untitled") + "_FULL_OUTLINE.md";
            await safeCreateFile(outputName, synopsis);
            new Notice(`Full Outline Created.`);
        } catch(e: any) { handleError("Ghostwriter", e, pid);
        } 
        finally { stopLoading(contextKey);
        } 
    }

    async function runAutoFill() {
        if (!wizardData) return;
        const concept = wizardData.concept;
        if (!concept || concept.length < 5) {
            new Notice("Please enter a Concept/Logline first.");
            return;
        }
        if (!confirm("AUTO-FILL WARNING:\nThis will overwrite your current characters, structure, and 3 Ps.\n\nContinue?")) return;
        const contextKey = "WIZARD_GLOBAL";
        const { pid, controller } = startLoading(contextKey, 8000, "ARCHITECTING STORY BIBLE...");

        try {
            const context = wizardData.inspirationContext || "";
            const generatedState = await cloud.autoFillWizard(
                concept,
                context,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );

            wizardData = {
                ...wizardData,
                ...generatedState,
                concept: concept,
                inspirationContext: context,
                characters: generatedState.characters || [],
                structure: generatedState.structure || [],
                structureDNA: generatedState.structureDNA || wizardData.structureDNA,
                threePs: generatedState.threePs || wizardData.threePs,
                sandersonLaws: generatedState.sandersonLaws || wizardData.sandersonLaws,
                philosopher: generatedState.philosopher || wizardData.philosopher
            };

            await saveAll(false);
            new Notice("Story Bible Generated Successfully.");
        } catch (e: any) { handleError("Auto-Fill", e, pid);
        } 
        finally { stopLoading(contextKey);
        } 
    }

    // [UPDATED] RUN SYNTHESIS WITH OPTIONAL TITLE
    async function runDriveSynthesis(customTitle?: string) {
        if (!wizardData) return;
        // [UPDATED] Use Local Project Drives
        const drives = wizardData.synthesisDrives || [];
        if (drives.length === 0) {
            new Notice("No drives found. Create a drive first.");
            return;
        }
        if (!confirm("INITIATE FUSION?\nThis will generate a new Universal Outline document from your drives.\n\nProceed?")) return;
        const contextKey = "WIZARD_GLOBAL";
        const { pid, controller } = startLoading(contextKey, 10000, "FUSING NARRATIVE DRIVES...");

        try {
            // Returns MARKDOWN string
            const outlineMarkdown = await cloud.synthesizeDrives(
                drives,
                customTitle,
                undefined, // targetQuality
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            
            // [UPDATED] Filename Logic based on User Request
            let outputName = "";
            
            if (customTitle && customTitle.trim().length > 0) {
                // Use Target Codename ONLY if provided
                const safeTitle = customTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                outputName = `${safeTitle}.md`;
            } else {
                // Fallback to Active File Name if no codename provided
                outputName = `UNIVERSAL_OUTLINE_${Date.now()}.md`;
            }

            await safeCreateFile(outputName, outlineMarkdown);
            new Notice("Universal Outline Created.");
        } catch (e: any) { handleError("Synthesis", e, pid);
        } 
        finally { stopLoading(contextKey);
        }
    }

    async function runForge() { 
        if (!activeFile || !projectData || !forgeData) return;
        const path = activeFile.path; 
        const content = await app.vault.read(activeFile);
        const estTime = cloud.estimateDuration(content, 'scan');
        const contextKey = "FORGE_GLOBAL";
        const { pid, controller } = startLoading(contextKey, estTime, "FORGING ACTION PLAN...");

        try { 
            // [UPDATED] Pass Scan Results to getActionPlan
            const plan = await cloud.getActionPlan(
                content, 
                forgeData.repairFocus,
                projectData.lastAiResult || undefined, 
                projectData.lastLightResult || undefined,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            
            if (activeFile.path !== path) return;
            forgeData.lastActionPlan = plan;
            await saveAll(false);
        } catch (e: any) { handleError("Forge", e, pid); }
        finally { stopLoading(contextKey);
        } 
    }

    async function runOutlineGeneration() { 
        if (!forgeData) return;
        const contextKey = "FORGE_GLOBAL";

        try { 
            const sourceText = forgeData.archivistContext ? forgeData.archivistContext.trim() : "";
            const instructions = forgeData.archivistPrompt ? forgeData.archivistPrompt.trim() : "";
            const hasImage = uploadedImages.length > 0;

            if (sourceText.length === 0 && instructions.length === 0 && !hasImage) throw new Error("ARCHIVIST IDLE: Please Upload Text, Image, OR enter a Title/Concept.");

            let combinedInput = "";
            let modeLabel = "";
            let useSearch = false;
            let outputFilename = "ARCHIVIST_OUTLINE.md";
            const estTime = cloud.estimateDuration(sourceText || instructions, 'architect');

            if (sourceText.length > 0) {
                modeLabel = "ANALYZING UPLOADED TEXT...";
                combinedInput = `INSTRUCTIONS: ${instructions}\n\nTEXT TO ANALYZE:\n${sourceText}`;
                outputFilename = "TEXT_ANALYSIS.md";
            } else if (hasImage) {
                 modeLabel = `ANALYZING ${uploadedImages.length} IMAGES...`;
                 combinedInput = `INSTRUCTIONS: ${instructions}\n\n[VISUAL INPUT PROVIDED]`;
                 outputFilename = "VISUAL_ANALYSIS.md";
            } else {
                modeLabel = "RESEARCHING & GENERATING...";
                combinedInput = `TARGET TITLE / CONCEPT: "${instructions}"\n\nDIRECTIVE: If this is an existing published story (Book/Movie), retrieve the accurate plot details and outline the published work. DO NOT include reviews, ratings, or critical reception. STRICTLY STORY ONLY.`;
                useSearch = true; 
                const sanitizedTitle = instructions.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_').substring(0, 40);
                if (sanitizedTitle.length > 0) outputFilename = sanitizedTitle + "_OUTLINE.md";
            }
            new Notice(modeLabel);

            const { pid, controller } = startLoading(contextKey, estTime, modeLabel);

            try {
                const images = uploadedImages.length > 0 ? uploadedImages : undefined;
                const outlineText = await cloud.generateOutline(
                    combinedInput,
                    useSearch,
                    controller.signal,
                    images,
                    (msg, progress) => updateProcessStatus(pid, msg, progress)
                );

                await safeCreateFile(outputFilename, outlineText);
                new Notice(`Archivist Created.`);
            } catch (e: any) {
                handleError("Archivist", e, pid);
            } finally {
                stopLoading(contextKey);
            }
        } catch (e: any) { handleError("Archivist", e);
        } 
    }

    async function runAutoRepair() {
        if (!activeFile || !projectData || !forgeData || !forgeData.lastActionPlan) return;
        const path = activeFile.path;
        const content = await app.vault.read(activeFile);
        const estTime = cloud.estimateDuration(content, 'repair');
        const contextKey = "FORGE_GLOBAL";
        const { pid, controller } = startLoading(contextKey, estTime, "APPLYING NARRATIVE PATCH...");

        try {
            const repairedText = await cloud.autoRepair(
                content,
                forgeData.lastActionPlan,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            const outputName = activeFile.basename + "_REPAIRED.md";
            await safeCreateFile(outputName, repairedText);
            new Notice(`Repaired File Created.`);
        } catch (e: any) { handleError("Auto-Patch", e, pid);
        } 
        finally { stopLoading(contextKey);
        }
    }

    // --- DEEP RENAME (NEW) ---
    async function runDeepRename() {
        if (!activeFile) return new Notice("Please open a file to rename.");

        // [FIX]: Capture active file immediately to prevent race conditions if user switches files during await
        const targetFile = activeFile;

        if (!confirm(`RENAME CAST WARNING:\nThis will analyze ${targetFile.basename} and rename characters, places, and items based on Deep Nomenclature logic. It will REPLACE text in your file. Undo is not supported via this tool (use Ctrl+Z).\n\nProceed?`)) return;
        
        // [FIX]: Use FORGE_GLOBAL context key so the progress bar appears in the Forge tab
        const contextKey = "FORGE_GLOBAL";
        const { pid, controller } = startLoading(contextKey, 8000, "ETYMOLOGIST: RENAMING...");
        
        try {
            const content = await app.vault.read(targetFile);

            // [FIX]: Enhance context with both Wizard and Forge data
            const wizardContext = wizardData?.inspirationContext || "";
            const forgeContext = forgeData?.archivistContext || "";
            const combinedContext = `Global Context:\n${wizardContext}\n\nArchivist Context:\n${forgeContext}`.trim();

            const nameMap = await cloud.generateDeepNames(
                content,
                combinedContext,
                controller.signal,
                (msg, progress) => updateProcessStatus(pid, msg, progress)
            );
            
            // Apply updates to File Content
            let newContent = content;
            let updateCount = 0;
            const updates = Object.entries(nameMap);

            if (updates.length === 0) {
                 new Notice("No rename suggestions found.");
                 return;
            }

            updates.forEach(([oldName, newName]) => {
                // Simple global replace, ensuring word boundaries if possible or just string replacement
                // Using regex with word boundary to avoid partial matches (e.g. 'Rob' inside 'Robert')
                // Escaping oldName for regex
                if (oldName && newName && oldName !== newName) {
                    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
                    if (regex.test(newContent)) {
                        newContent = newContent.replace(regex, newName);
                        updateCount++;
                    }
                }
            });
            
            if (updateCount > 0) {
                // [FIX]: Use targetFile instead of activeFile
                await app.vault.modify(targetFile, newContent);
                new Notice(`Renaming Complete. ${updateCount} entities updated in ${targetFile.basename}.`);

                // Also update Wizard Data if matches found
                if (wizardData && wizardData.characters) {
                     wizardData.characters = wizardData.characters.map(c => {
                         if (nameMap[c.name]) return { ...c, name: nameMap[c.name] };
                         return c;
                     });
                     await saveAll(false);
                }

                // Log to Archivist
                if (forgeData) {
                     const renameLog = `\n[SYSTEM NOTE - RENAMED ENTITIES IN ${targetFile.basename}]:\n` +
                        updates.map(([oldN, newN]) => `- ${oldN} is now ${newN}`).join('\n');
                     forgeData.archivistContext = (forgeData.archivistContext || "") + renameLog;
                     await saveAll(false);
                }
            } else {
                new Notice("No matching entities found in text to replace.");
            }
            
        } catch (e: any) { handleError("Deep Rename", e, pid); }
        finally { stopLoading(contextKey); }
    }

    async function resetCurrentDisc() { 
        if (activeFile) {
            // Cancel any active processes for this file
            const contextKey = activeFile.path + "_CRITIC";
            stopLoading(contextKey);
        }

        if (window.confirm("FORCE FORMAT DISC? Resets all data.")) { 
            if (projectData && activeFile) {
                // Clear Critic Data Only
                projectData.lastAiResult = null;
                projectData.lastLightResult = null;
                projectData.lastMetaResult = null;
                projectData.lastAnalysisMtime = null;
                await db.saveProjectData(projectData, 0); // Reset
            }

            // Should we clear Wizard/Forge? They are persistent now.
            // Maybe just clear the Critic part for the current file?
            new Notice("Critic Disc Formatted.");
        } 
    }

    // --- FORGE OPS HOOKS ---
    // --- FORGE HELPERS ---
    function handleAddRepairInstruction(instruction: string) {
        if (!forgeData) return;
        const current = forgeData.repairFocus ? forgeData.repairFocus.trim() : "";
        const entry = `- [TRIBUNAL]: ${instruction}`;
        if (current.includes(entry)) return; // Prevent dupes

        forgeData.repairFocus = current.length > 0 ? `${current}\n${entry}` : entry;
        new Notice("Instruction injected into Forge Repair Plan.");
        currentTab = 'forge'; // Auto-switch to Forge so user sees the change
        debouncedSave();
    }

    async function runFixDialogue() {
        if (!activeFile) return;
        try {
            const content = await getActiveFileContent();
            const fixed = ForgeOps.fixDialogue(content);
            if (fixed !== content) {
                await updateActiveFileContent(fixed);
            }
        } catch (e: any) { handleError("Dialogue Fix", e); }
    }

    async function runAdverbKiller(mode: 'highlight' | 'kill') {
        if (!activeFile) return;
        try {
            const content = await getActiveFileContent();
            const fixed = ForgeOps.assassinateAdverbs(content, mode);
            if (fixed !== content) {
                await updateActiveFileContent(fixed);
            }
        } catch (e: any) { handleError("Adverb Killer", e); }
    }

    async function runFilterHighlight() {
        if (!activeFile) return;
        try {
            const content = await getActiveFileContent();
            const fixed = ForgeOps.highlightFilters(content);
            if (fixed !== content) {
                await updateActiveFileContent(fixed);
            }
        } catch (e: any) { handleError("Filter Highlight", e); }
    }

    async function runGenerateReport() {
        if (!activeFile || !projectData) return;
        try {
            await ReportGen.generateReport(app, projectData, activeFile.basename);
        } catch (e: any) { handleError("Report Gen", e); }
    }


    onMount(async () => {
        const f = app.workspace.getActiveFile(); 
        await loadGlobalData();
        updateActiveFile(f); 
    });
</script>

<div class="compu-container theme-win95"
     style="--cj-grade-masterpiece: {settings.gradingColors.masterpiece}">
    
    <div class="title-bar">
        <div class="title-bar-text">
            Compu-Judge 98 {activeFile ? `[${activeFile.basename.toUpperCase()}]` : '[NO DISC]'}
        </div>
        {#if activeFile}
            <button class="reset-btn" onclick={resetCurrentDisc} title="Force Format / Stop">RST</button>
        {/if}
    </div>

    <div class="tab-strip">
        <button class:active={currentTab === 'critic'} onclick={() => currentTab = 'critic'}>CRITIC</button>
        <button class:active={currentTab === 'wizard'} onclick={() => currentTab = 'wizard'}>WIZARD</button>
        <button class:active={currentTab === 'forge'} onclick={() => currentTab = 'forge'}>FORGE</button>
        <button class:active={currentTab === 'tune'} onclick={() => currentTab = 'tune'}>TUNE</button>
    </div>

    <div class="window-body">

        <!-- TUNE TAB -->
        {#if currentTab === 'tune'}
            <TuneView {app} {cloud} />
        {/if}

        <!-- WIZARD TAB (GLOBAL) -->
        {#if currentTab === 'wizard'}
             {#if !wizardData}
                 <div class="empty-state">BOOTING WIZARD OS...</div>
             {:else}
                 <WizardView
                    app={app}
                    settings={settings}
                    activeFileStatus={!!(processMap['WIZARD_GLOBAL'])}
                    processOrigin={processMap['WIZARD_GLOBAL'] ? 'WIZARD_GLOBAL' : undefined}
                    estimatedDuration={estimatedDuration}
                    processId={processMap['WIZARD_GLOBAL']}

                    wizardState={wizardData}
                    onSave={debouncedSave}
                    onAssist={runWizardAssist}
                    onUploadContext={handleUploadContext}
                    onScrubContext={handleScrubContext}
                    onClear={handleClearWizardState}
                    onAutoFill={runAutoFill}
                    isContextSynced={isContextSynced}
                    loadingField={wizardLoadingField}
                    onGradeCharacter={handleGradeCharacter}
                    onGradeStructure={handleGradeStructure}
                    onRunGhostwriter={runGhostwriter}

                    onUpdateDrives={handleDrivesUpdate}
                    onUpdateSettings={handleSettingsUpdate}
                    onRunSynthesis={runDriveSynthesis}
                    onGetActiveContent={getActiveFileContent}
                />
            {/if}

        <!-- FORGE TAB (GLOBAL + LOCAL TOOLS) -->
        {:else if currentTab === 'forge'}
             {#if !forgeData}
                 <div class="empty-state">IGNITING FORGE...</div>
             {:else}
                 <div class="panel-forge">
                     {#if activeFile && projectData}
                        <button class="action-btn primary" onclick={runForge}>GENERATE REPAIR PLAN (ACTIVE FILE)</button>
                     {:else}
                        <div class="weakness-alert">INSERT DISK (OPEN FILE) FOR REPAIR TOOLS</div>
                     {/if}
                     
                     {#if processMap['FORGE_GLOBAL']}
                        <Win95ProgressBar processId={processMap['FORGE_GLOBAL']} />
                     {/if}

                     <div class="repair-focus-area">
                         <label for="repairFocus" class="input-label">REPAIR FOCUS (OPTIONAL):</label>
                         <textarea 
                            id="repairFocus"
                            class="retro-input" 
                            rows="2" 
                            placeholder="E.g., 'Fix the pacing in Act 2' or 'Make the villain scarier'" 
                            bind:value={forgeData.repairFocus}
                            use:autoResize={forgeData.repairFocus}
                        ></textarea>
                    </div>

                    <div class="win95-popup-window" style="margin-bottom: 20px;">
                         <div class="win95-titlebar">
                            <div class="win95-titlebar-text">
                                <span>🔧</span> <span>Prose Tools (Active File)</span>
                            </div>
                        </div>
                        <div class="win95-content-inset">
                             <div class="button-grid">
                                <button class="action-btn secondary" onclick={runFixDialogue} disabled={!activeFile}>FIX DIALOGUE PUNCTUATION</button>
                                <button class="action-btn secondary" onclick={() => runAdverbKiller('highlight')} disabled={!activeFile}>HIGHLIGHT ADVERBS (RED)</button>
                                <button class="action-btn secondary" onclick={runFilterHighlight} disabled={!activeFile}>HIGHLIGHT FILTER WORDS (YELLOW)</button>
                            </div>
                        </div>
                    </div>

                    <div class="win95-popup-window" style="margin-bottom: 20px;">
                         <div class="win95-titlebar">
                            <div class="win95-titlebar-text">
                                <span>📚</span> <span>Structural Archivist (Global)</span>
                            </div>
                        </div>
                        <div class="win95-content-inset">
                            <div class="memory-core bevel-down">
                                <div class="memory-status">
                                    <div class="status-indicator">
                                        <span class="led {hasArchivistData || uploadedImages.length > 0 ? 'on' : 'off'}"></span>
                                        <span>{hasArchivistData || uploadedImages.length > 0 ? 'BUFFER LOADED' : 'BUFFER EMPTY'}</span>
                                    </div>
                                    <div class="status-details">{archivistLength} CHARS {uploadedImages.length > 0 ? `+ ${uploadedImages.length} IMG` : ''}</div>
                                </div>
                                <div class="context-controls">
                                    <button
                                        class="upload-btn {isArchivistSynced ? 'synced' : ''}"
                                        onclick={handleUploadArchivist}
                                        disabled={isArchivistSynced || !activeFile}
                                        title="Load active file into buffer"
                                    >
                                        {isArchivistSynced ? '✅ SYNCED' : '📥 LOAD BUFFER'}
                                    </button>
                                     <button class="scrub-btn" onclick={handleScrubArchivist} disabled={!hasArchivistData && uploadedImages.length === 0}>🗑️</button>
                                 </div>
                            </div>

                            <!-- IMAGE UPLOAD -->
                            <div style="margin-bottom: 8px; display: flex; gap: 5px; align-items: center;">
                                <label class="action-btn secondary" style="margin: 0; text-align: center; cursor: pointer;">
                                    📷 LOAD IMAGES ({uploadedImages.length})
                                    <input type="file" accept="image/*" multiple onchange={handleImageUpload} style="display: none;">
                                </label>
                                {#if uploadedImages.length > 0}
                                    <button class="scrub-btn" onclick={clearImages} title="Clear Images">X</button>
                                {/if}
                            </div>

                            <textarea
                                class="retro-input archivist-prompt"
                                rows="2"
                                placeholder="INSTRUCTIONS: Focus area OR Story Title (e.g. 'The Matrix')"
                                bind:value={forgeData.archivistPrompt}
                                use:autoResize={forgeData.archivistPrompt}
                            ></textarea>

                            <div class="grid-2">
                                <button class="action-btn tertiary outline-btn" onclick={runOutlineGeneration}>
                                    {hasArchivistData || uploadedImages.length > 0 ? 'ANALYZE BUFFER' : 'GENERATE FROM TITLE'}
                                </button>
                                <button class="action-btn secondary outline-btn" onclick={runDeepRename}>
                                    🏷️ RENAME CAST (DEEP)
                                </button>
                            </div>
                        </div>
                    </div>

                    {#if forgeData.lastActionPlan}
                        <div class="forge-report win95-popup-window">
                             <div class="win95-titlebar">
                                <div class="win95-titlebar-text">
                                    <span>🛡️</span> <span>Repair Plan</span>
                                </div>
                                 <div class="win95-controls">
                                    <button class="win95-close-btn" onclick={() => { if(forgeData) forgeData.lastActionPlan = null; saveAll(false); }}>X</button>
                                </div>
                            </div>
                            <div class="win95-menubar">
                                <span class="win95-menu-item">Actions</span>
                            </div>

                            <div class="win95-content-inset">
                                {#if forgeData.lastActionPlan.thought_process}
                                    <details class="thought-trace bevel-groove">
                                        <summary class="thought-header">COGNITIVE TRACE (RAW)</summary>
                                        <div class="thought-content">{forgeData.lastActionPlan.thought_process}</div>
                                    </details>
                                  {/if}

                                    <div class="weakness-alert">WEAK LINK: {forgeData.lastActionPlan.weakest_link}</div>

                                {#if forgeData.lastActionPlan.repairs}
                                    <div class="repair-list">
                                          {#each forgeData.lastActionPlan.repairs as repair, i}
                                            <div class="repair-item">
                                              <div class="repair-header">ISSUE {i+1}: {repair.issue}</div>
                                               <div class="repair-body">{repair.instruction}</div>
                                              <div class="repair-why">RATIONALE: {repair.why}</div>
                                            </div>
                                        {/each}
                                    </div>
                                {:else if forgeData.lastActionPlan.steps}
                                    <div class="repair-list legacy-mode">
                                       <p class="legacy-note">[LEGACY REPORT DETECTED - RE-RUN FOR DETAILS]</p>
                                        <ol class="forge-steps">
                                            {#each forgeData.lastActionPlan.steps as step}
                                                <li>{step}</li>
                                            {/each}
                                        </ol>
                                    </div>
                                {/if}

                                 <button class="action-btn secondary" onclick={runAutoRepair} disabled={!activeFile}>EXECUTE REPAIR PROTOCOL (AUTO-PATCH)</button>
                            </div>
                        </div>
                    {/if}
                 </div>
            {/if}

        <!-- CRITIC TAB (FILE SPECIFIC) -->
        {:else if currentTab === 'critic'}
            {#if !activeFile}
                 <div class="empty-state">INSERT DISK (OPEN MARKDOWN FILE)</div>
            {:else if isProjectDataLoading}
                 <div class="empty-state">READING DISK SECTORS...</div>
                 <Win95ProgressBar processId="MOUNTING" /> <!-- Placeholder -->
            {:else if projectData}
                <div class="panel-critic">
                    <div class="button-row">
                        <button class="action-btn primary" onclick={() => runAnalysis()}>
                            DEEP SCAN ({settings.enableTribunal ? 'TRIBUNAL' : `${settings.criticCores} CORES`})
                        </button>
                        <button class="action-btn secondary" onclick={runQuickScan}>QUICK SCAN</button>
                    </div>

                    {#if activeFile && processMap[activeFile.path + "_CRITIC"]}
                        <Win95ProgressBar processId={processMap[activeFile.path + "_CRITIC"]} />
                    {/if}

                    {#if projectData.lastLightResult}
                        <!-- WIN95 POPUP STYLE QUICK SCAN -->
                        <div class="win95-popup-window">
                            <div class="win95-titlebar">
                                <div class="win95-titlebar-text">
                                    <span>📨</span> <span>WinPopup - Quick Scan</span>
                                </div>
                                <div class="win95-controls">
                                </div>
                            </div>
                            <div class="win95-menubar" style="position: relative;">
                                <!-- [WIN95 UPDATE]: Smart Repair Removed from Quick Scan -->
                            </div>
                            <div class="win95-info-area">
                                Message from <b>CRITIC_SYS</b> to <b>USER</b><br/>
                                on {new Date().toLocaleTimeString()}
                            </div>
                            <div class="win95-content-inset">
                                <b>GRADE: {projectData.lastLightResult.letter_grade} ({projectData.lastLightResult.score})</b><br/><br/>
                                {#if projectData.lastLightResult.synopsis}
                                    LOG: {projectData.lastLightResult.synopsis}<br/><br/>
                                {/if}
                                {projectData.lastLightResult.summary_line}<br/><br/>
                                ----------------------------------------<br/>
                                FIX: {projectData.lastLightResult.key_improvement}
                            </div>
                            <div class="win95-statusbar">
                                <div class="win95-status-field">Current message: 1</div>
                                <div class="win95-status-field">Total number of messages: 1</div>
                            </div>
                        </div>
                    {/if}

                    {#if projectData.lastAiResult}
                        <CriticDisplay
                            data={projectData.lastAiResult}
                            meta={projectData.lastMetaResult}
                            isProcessing={!!($processRegistry[activeFile.path])}
                            settings={settings}
                            onRunMeta={runMeta}
                            onAddRepairInstruction={handleAddRepairInstruction}
                        />
                         <button class="action-btn tertiary" onclick={runGenerateReport} style="margin-top:10px;">📄 EXPORT FORENSIC REPORT</button>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>
    
   <div class="status-bar">
        <span>STATUS: {activeFileStatus}</span>
        <span class="spacer"></span>
        <span class="disk-led" class:active-led={isSaving}>DISK ACT</span>
    </div>
</div>

<style>
    :root { --cj-accent: #000080; --cj-bg: #c0c0c0; --cj-text: #000000; --cj-dim: #808080; }
    .compu-container { height: 100%; display: flex; flex-direction: column; font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 11px; font-weight: normal; }
    .window-body { flex: 1; overflow-y: auto; padding: 12px; background: var(--cj-bg); border-top: 1px solid #000; border-left: 1px solid #000; border-right: 1px solid #fff; border-bottom: 1px solid #fff; box-shadow: inset 1px 1px 0 #808080; }
    .title-bar { background: linear-gradient(90deg, #000080 0%, #1084d0 100%); color: #fff; padding: 4px 8px; display: flex; justify-content: space-between; font-weight: bold; }
    
    .tab-strip { display: flex; padding: 6px 4px 0 4px; gap: 2px; }
    .tab-strip button { background: var(--cj-bg); color: var(--cj-text); border-top: 1px solid #fff; border-left: 1px solid #fff; border-right: 1px solid #000; border-bottom: 1px solid #000; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #dfdfdf; padding: 4px 10px; font-weight: bold; cursor: pointer; border-bottom: none; font-size: 11px; }
    .tab-strip button.active { padding-bottom: 6px; margin-top: -2px; z-index: 10; border-top: 2px solid #dfdfdf; }
    
    .action-btn { width: 100%; padding: 6px; font-weight: bold; cursor: pointer; border-top: 1px solid #fff; border-left: 1px solid #fff; border-right: 1px solid #000; border-bottom: 1px solid #000; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #dfdfdf; background: var(--cj-bg); color: var(--cj-text); margin-bottom: 8px; font-size: 11px; }
    .action-btn:active { border-top: 1px solid #000; border-left: 1px solid #000; border-right: 1px solid #fff; border-bottom: 1px solid #fff; box-shadow: inset 1px 1px 0 #808080; padding: 7px 5px 5px 7px; }
    .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .outline-fieldset { margin-bottom: 20px; border: 2px groove var(--cj-dim); padding: 0; }
    .outline-fieldset legend { margin-left: 5px; }

    .repair-focus-area { margin-bottom: 15px; }
    .input-label { display: block; font-weight: 900; margin-bottom: 4px; color: var(--cj-dim); font-size: 0.9em; }
    .archivist-prompt { margin-bottom: 8px; }
    
    .forge-report { margin-top: 20px; color: var(--cj-text); font-weight: bold; }
    .weakness-alert { background: var(--cj-text); color: var(--cj-bg); padding: 8px; font-weight: 900; text-align: center; margin-bottom: 10px; border: 2px solid #fff; }
    .repair-item { margin-bottom: 15px; border-bottom: 2px dashed var(--cj-dim); padding-bottom: 10px; }
    .repair-header { font-weight: 900; color: var(--cj-accent); text-transform: uppercase; margin-bottom: 4px; }
    .repair-body { margin-bottom: 4px; line-height: 1.4; font-weight: bold; }
    .repair-why { font-size: 0.9em; font-style: italic; color: var(--cj-dim); font-weight: bold; }
    .legacy-mode { opacity: 0.7; border: 1px dashed red; padding: 10px; }
    .legacy-note { color: red; font-weight: bold; font-size: 10px; margin-bottom: 5px; }

    .quick-result { margin: 15px 0; padding: 12px; border: 2px dotted var(--cj-text); color: var(--cj-text); display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.05); }
    .quick-header { display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 2px dashed var(--cj-dim); padding-bottom: 5px; }
    .quick-grade { font-size: 2.5em; font-weight: 900; }
    .quick-score { font-size: 1.5em; opacity: 0.8; font-weight: 900; }
    .quick-summary { font-style: italic; font-weight: bold; }
    .quick-fix { background: var(--cj-accent); color: #fff; padding: 4px; font-weight: 900; width: 100%; text-align: center; }

    .memory-core { margin-bottom: 10px; background: rgba(0,0,0,0.05); padding: 5px; border: 2px solid var(--cj-dim); }
    .memory-status { display: flex; justify-content: space-between; align-items: center; background: #000; color: #00ff00; padding: 5px 8px; font-size: 12px; border: 2px inset #808080; margin-bottom: 5px; font-weight: bold; }
    .status-indicator { display: flex; gap: 8px; align-items: center; font-weight: 900; }
    .led { width: 8px; height: 8px; border-radius: 50%; background: #004400; border: 1px solid #00ff00; }
    .led.on { background: radial-gradient(circle at 30% 30%, #e0ffe0, #00ff00); border-color: #00ff00; }
    .context-controls { display: flex; gap: 5px; }
    .upload-btn { flex: 1; padding: 4px; font-size: 11px; background: var(--cj-bg); border: 2px outset #fff; cursor: pointer; font-weight: bold; }
    .upload-btn:active { border-style: inset; }
    .upload-btn.synced { opacity: 0.6; cursor: default; }
    .scrub-btn { width: 30px; padding: 0; background: var(--cj-bg); border: 2px outset #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }

    .thought-trace { margin-bottom: 8px; border: 1px dashed var(--cj-dim); padding: 2px; }
    .thought-header { cursor: pointer; font-weight: bold; font-size: 11px; padding: 4px; color: var(--cj-dim); list-style: none; }
    .thought-content { padding: 8px; font-family: 'Courier New', monospace; font-size: 11px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; border-top: 1px dashed var(--cj-dim); background: var(--cj-bg); color: var(--cj-text); opacity: 0.8; font-weight: bold; }

    .status-bar { border-top: 2px solid var(--cj-dim); padding: 4px 8px; background: var(--cj-bg); color: var(--cj-text); display: flex; gap: 15px; font-size: 12px; align-items: center; font-weight: 900; }
    .spacer { flex: 1; }
    .disk-led { font-weight: 900; color: #808080; border: 2px inset #808080; padding: 0 4px; background: #c0c0c0; transition: all 0.1s; }
    .active-led { background: radial-gradient(circle at 30% 30%, #ffaaaa, #ff0000); color: #fff; border-color: #ff0000; }
    .empty-state { padding: 40px; text-align: center; opacity: 0.5; font-weight: 900; }
    .reset-btn { font-size: 10px; padding: 0 4px; background: #ff0000; color: white; border: 2px outset #ffaaaa; cursor: pointer; }
    .reset-btn:active { border-style: inset; }

    @media (max-width: 600px) {
        .button-row { flex-direction: column; gap: 5px; }
        .action-btn { padding: 12px; margin-bottom: 5px; }
    }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }

    /* DROPDOWN MENU */
    .dropdown-list {
        position: absolute;
        top: 100%;
        left: 0;
        background: #c0c0c0;
        border-top: 1px solid #fff;
        border-left: 1px solid #fff;
        border-right: 1px solid #000;
        border-bottom: 1px solid #000;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
        z-index: 9999;
        min-width: 150px;
        padding: 2px;
    }

    .dd-item {
        padding: 4px 8px;
        cursor: pointer;
        color: #000;
    }

    .dd-item:hover {
        background: #000080;
        color: #fff;
    }
</style>
