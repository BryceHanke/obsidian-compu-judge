<script lang="ts">
    import { onMount } from 'svelte';
    import { TFile, App, Notice } from 'obsidian';
    import type { CloudGenService } from './CloudGen';
    import type { NigsSettings, ProjectData, CharacterBlock, StoryBlock, DriveBlock } from './types';
    import { DEFAULT_WIZARD_STATE } from './types'; 
    import { db } from './db';
    import { NlpService } from './nlp';
    import { autoResize, debounce } from './utils';
    import { ForgeOps } from './ForgeOps';
    import { ReportGen } from './ReportGen';
    import WizardFields from './WizardFields.svelte';
    import SynthesizerView from './SynthesizerView.svelte';
    import CriticDisplay from './CriticDisplay.svelte';
    import Win95ProgressBar from './Win95ProgressBar.svelte';
    import { processRegistry, processOrigin, setFileLoading, setStatus } from './store';

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
    let currentTab = $state('critic');
    let isSaving = $state(false);
    let estimatedDuration = $state(4000);
    let wizardLoadingField: string | null = $state(null);
    
    // Sync States
    let isContextSynced = $state(false);
    let isArchivistSynced = $state(false);
    
    // [WIN95 UPDATE] Quick Scan Dropdown State
    let showQuickScanMenu = $state(false);

    let archivistLength = $derived(projectData?.archivistContext ? projectData.archivistContext.length : 0);
    let hasArchivistData = $derived(archivistLength > 0);

    // [FIX]: Moved logic from template to script to prevent build errors with Optional Chaining in HTML
    let activeFileStatus = $derived(
        activeFile && $processRegistry[activeFile.path] ? 'PROCESSING' : 'READY'
    );

    // [OPTIMIZATION] Debounced save for text inputs
    const debouncedSave = debounce(() => saveProject(false), 1000);

    function handleSettingsUpdate(updates: Partial<NigsSettings>) {
        Object.assign(settings, updates);
        onUpdateSettings(updates);
    }
    
    // [NEW] Handle Drive Updates Locally
    function handleDrivesUpdate(newDrives: DriveBlock[]) {
        if (!projectData) return;
        projectData.wizardState.synthesisDrives = newDrives;
        saveProject(false);
    }

    function handleError(context: string, error: any) {
        console.error(`[Compu-Judge] ${context} Error:`, error);
        let msg = error instanceof Error ? error.message : String(error);
        msg = msg.replace(/^Error:\s*/i, "").replace(/^Gemini Error:\s*/i, "");
        if (msg.includes("429")) msg = "Rate Limit Exceeded. Please wait.";
        if (msg.includes("401") || msg.includes("403")) msg = "Invalid API Key or Permissions.";
        if (msg.includes("TIMEOUT")) msg = "AI Timeout. Task was too heavy.";
        
        new Notice(`❌ ${context}: ${msg}`, 6000);
        wizardLoadingField = null;
    }

    export const updateActiveFile = async (file: TFile | null) => {
        if (activeFile?.path === file?.path) return;
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

    async function saveProject(updateMtime: boolean = false) {
        if (!projectData || !activeFile) return;
        if (projectData.filePath !== activeFile.path) {
            console.warn("Save aborted: State mismatch detected.");
            return;
        }

        isSaving = true;
        try {
            if (updateMtime && activeFile instanceof TFile) {
                projectData.lastAnalysisMtime = activeFile.stat.mtime;
            }
            await db.saveProjectData(projectData, projectData.lastAnalysisMtime);
            await checkAllSyncs();
        } catch(e) {
            handleError("Save Failed", e);
        } finally {
            setTimeout(() => isSaving = false, 300);
        }
    }

    async function checkAllSyncs() {
        if (!activeFile || !projectData) {
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
            const wizCtx = projectData.wizardState.inspirationContext || "";
            isContextSynced = wizCtx.includes(content);
            const arcCtx = projectData.archivistContext || "";
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

    async function handleUploadContext() {
        if (!activeFile || !projectData) return;
        try {
            const content = await app.vault.read(activeFile);
            if (!content.trim()) return new Notice("File is empty.");
            const currentContext = projectData.wizardState.inspirationContext || "";
            const newContext = currentContext ?
            `${currentContext}\n\n[IMPORTED SOURCE]:\n${content}` : `[IMPORTED SOURCE]:\n${content}`;
            projectData.wizardState.inspirationContext = newContext;
            projectData = { ...projectData }; 
            new Notice("Wizard Memory Updated.");
            await saveProject(false);
        } catch (e: any) { handleError("Memory Upload", e); }
    }

    function handleScrubContext() {
        if (!projectData) return;
        if (confirm("Purge Inspiration Memory?")) {
            projectData.wizardState.inspirationContext = "";
            projectData = { ...projectData };
            saveProject(false);
            new Notice("Wizard Memory Purged.");
        }
    }

    function handleClearWizardState() {
        if (!projectData) return;
        if (confirm("Clear all Wizard fields? (Memory/Context will be kept)")) {
            const currentContext = projectData.wizardState.inspirationContext;
            projectData.wizardState = {
                ...JSON.parse(JSON.stringify(DEFAULT_WIZARD_STATE)),
                inspirationContext: currentContext
            };
            projectData = { ...projectData };
            saveProject(false);
            new Notice("Wizard Fields Cleared.");
        }
    }

    async function handleUploadArchivist() {
        if (!activeFile || !projectData) return;
        try {
            const content = await app.vault.read(activeFile);
            if (!content.trim()) return new Notice("File is empty.");
            projectData.archivistContext = content;
            projectData = { ...projectData };
            new Notice("Archivist Memory Loaded.");
            await saveProject(false);
        } catch (e: any) { handleError("Buffer Load", e);
        }
    }

    function handleScrubArchivist() {
        if (!projectData) return;
        if (confirm("Clear Archivist Memory?")) {
            projectData.archivistContext = "";
            projectData = { ...projectData };
            saveProject(false);
            new Notice("Archivist Memory Cleared.");
        }
    }

    function startLoading(path: string, duration = 4000, label = "PROCESSING...") { 
        estimatedDuration = duration;
        setStatus(label);
        setFileLoading(path, true, currentTab); 
    }
    
    function stopLoading(path: string) { 
        setTimeout(() => setFileLoading(path, false), 200);
        wizardLoadingField = null;
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
        if (!activeFile || !projectData) return char;
        const path = activeFile.path;
        startLoading(path, 3000, `ANALYZING ${char.name.toUpperCase()}...`);
        try {
            const context = projectData.wizardState.inspirationContext || "No context provided.";
            const updated = await cloud.gradeCharacter(char, context);
            new Notice(`Metrics Updated for ${char.name}`);
            return updated;
        } catch(e: any) { handleError("Character Grading", e); return char; } 
        finally { stopLoading(path);
        }
    }

    async function handleGradeStructure(beat: StoryBlock): Promise<StoryBlock> {
        if (!activeFile || !projectData) return beat;
        const path = activeFile.path;
        startLoading(path, 3000, `ANALYZING ${beat.type.toUpperCase()}...`);
        try {
            const context = projectData.wizardState.inspirationContext || "No context provided.";
            const updated = await cloud.gradeStructureBeat(beat, context);
            new Notice(`Tension Calculated for ${beat.title}`);
            return updated;
        } catch(e: any) { handleError("Structure Grading", e); return beat; }
        finally { stopLoading(path);
        }
    }

    async function runAnalysis() { 
        const file = activeFile;
        if (!file || !projectData) return; 
        const content = await app.vault.read(file);
        const estTime = cloud.estimateDuration(content, 'scan');
        startLoading(file.path, estTime, "CALCULATING METRICS...");
        try { 
            const nlpStats = NlpService.analyze(content);
            setStatus("SYNTHESIZING DEEP SCAN...");
            const context = { inspiration: projectData.wizardState.inspirationContext, target: projectData.wizardState.targetScore };
            const result = await cloud.gradeContent(content, context, nlpStats);
            if (activeFile?.path !== file.path) return;
            projectData.lastAiResult = result; 
            projectData.lastAnalysisMtime = file.stat.mtime;
            projectData = { ...projectData }; 
            await saveProject(true);
            new Notice("Deep Scan Complete.");
        } catch (e: any) { handleError("Deep Scan", e);
        } 
        finally { stopLoading(file.path);
        } 
    }

    async function runQuickScan() { 
        const file = activeFile;
        if (!file || !projectData) return; 
        const content = await app.vault.read(file);
        const estTime = cloud.estimateDuration(content, 'quick');
        startLoading(file.path, estTime, "QUICK SCANNING...");
        try { 
            const aiGrade = await cloud.getLightGrade(content);
            if (activeFile?.path !== file.path) return;
            const summary = `${aiGrade.summary_line}`;
            projectData.lastLightResult = { ...aiGrade, summary_line: summary };
            projectData = { ...projectData }; 
            await saveProject(false);
        } catch (e: any) { handleError("Quick Scan", e);
        } 
        finally { stopLoading(file.path);
        } 
    }

    async function runMeta() { 
        if (!activeFile || !projectData) return;
        const path = activeFile.path; 
        startLoading(path, 4000, "META-ANALYSIS..."); 
        try { 
            const content = await app.vault.read(activeFile);
            const meta = await cloud.getMetaAnalysis(content); 
            if (activeFile.path !== path) return;
            projectData.lastMetaResult = meta;
            projectData = { ...projectData };
            await saveProject(false);
        } catch (e: any) { handleError("System Diagnostics", e); } 
        finally { stopLoading(path);
        } 
    }

    async function runWizardAssist(fieldPath: string) { 
        if (!projectData || !activeFile) return;
        const path = activeFile.path; 
        wizardLoadingField = fieldPath;
        startLoading(path, 3000, "CONSULTING...");
        try { 
            const suggestion = await cloud.assistWizard(fieldPath, projectData.wizardState);
            if (activeFile.path !== path) return;
            const parts = fieldPath.split('.');
            let target: any = projectData.wizardState;
            for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
            const key = parts[parts.length - 1];
            if (target) {
                target[key] = suggestion;
                projectData = { ...projectData }; 
                new Notice("Suggestion Applied.");
                await saveProject(false);
            }
        } catch(e: any) { handleError("Wizard Assist", e);
        } 
        finally { stopLoading(path);
        } 
    }

    async function runGhostwriter() { 
        if (!activeFile || !projectData) return;
        const path = activeFile.path;
        const estTime = cloud.estimateDuration("generate comprehensive outline", 'architect');
        startLoading(path, estTime, "ARCHITECTING FULL OUTLINE...");
        try { 
            const synopsis = await cloud.wizardCompose(projectData.wizardState);
            const outputName = activeFile.basename + "_FULL_OUTLINE.md";
            await safeCreateFile(outputName, synopsis);
            new Notice(`Full Outline Created.`);
        } catch(e: any) { handleError("Ghostwriter", e);
        } 
        finally { stopLoading(path);
        } 
    }

    async function runAutoFill() {
        if (!activeFile || !projectData) return;
        const concept = projectData.wizardState.concept;
        if (!concept || concept.length < 5) {
            new Notice("Please enter a Concept/Logline first.");
            return;
        }
        if (!confirm("AUTO-FILL WARNING:\nThis will overwrite your current characters, structure, and 3 Ps.\n\nContinue?")) return;
        const path = activeFile.path;
        startLoading(path, 8000, "ARCHITECTING STORY BIBLE...");
        try {
            const context = projectData.wizardState.inspirationContext || "";
            const generatedState = await cloud.autoFillWizard(concept, context);
            if (activeFile.path !== path) return;
            projectData.wizardState = {
                ...projectData.wizardState,
                ...generatedState,
                concept: concept,
                inspirationContext: context,
                characters: generatedState.characters || [],
                structure: generatedState.structure || [],
                structureDNA: generatedState.structureDNA || projectData.wizardState.structureDNA,
                threePs: generatedState.threePs || projectData.wizardState.threePs,
                sandersonLaws: generatedState.sandersonLaws || projectData.wizardState.sandersonLaws,
                philosopher: generatedState.philosopher || projectData.wizardState.philosopher
            };
            projectData = { ...projectData };
            await saveProject(false);
            new Notice("Story Bible Generated Successfully.");
        } catch (e: any) { handleError("Auto-Fill", e);
        } 
        finally { stopLoading(path);
        } 
    }

    // [UPDATED] RUN SYNTHESIS WITH OPTIONAL TITLE
    async function runDriveSynthesis(customTitle?: string) {
        if (!activeFile || !projectData) return;
        // [UPDATED] Use Local Project Drives
        const drives = projectData.wizardState.synthesisDrives || [];
        if (drives.length === 0) {
            new Notice("No drives found. Create a drive first.");
            return;
        }
        if (!confirm("INITIATE FUSION?\nThis will generate a new Universal Outline document from your drives.\n\nProceed?")) return;
        const path = activeFile.path;
        startLoading(path, 10000, "FUSING NARRATIVE DRIVES...");

        try {
            // Returns MARKDOWN string
            const outlineMarkdown = await cloud.synthesizeDrives(drives, customTitle);
            
            // [UPDATED] Filename Logic based on User Request
            let outputName = "";
            
            if (customTitle && customTitle.trim().length > 0) {
                // Use Target Codename ONLY if provided
                const safeTitle = customTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                outputName = `${safeTitle}.md`;
            } else {
                // Fallback to Active File Name if no codename provided
                outputName = `${activeFile.basename}_UNIVERSAL_OUTLINE.md`;
            }

            await safeCreateFile(outputName, outlineMarkdown);
            new Notice("Universal Outline Created.");
        } catch (e: any) { handleError("Synthesis", e);
        } 
        finally { stopLoading(path);
        }
    }

    async function runForge() { 
        if (!activeFile || !projectData) return;
        const path = activeFile.path; 
        const content = await app.vault.read(activeFile);
        const estTime = cloud.estimateDuration(content, 'scan');
        startLoading(path, estTime, "FORGING ACTION PLAN...");
        try { 
            // [UPDATED] Pass Scan Results to getActionPlan
            const plan = await cloud.getActionPlan(
                content, 
                projectData.repairFocus, 
                projectData.lastAiResult || undefined, 
                projectData.lastLightResult || undefined
            );
            
            if (activeFile.path !== path) return;
            projectData.lastActionPlan = plan; 
            projectData = { ...projectData };
            await saveProject(false);
        } catch (e: any) { handleError("Forge", e); } 
        finally { stopLoading(path);
        } 
    }

    async function runOutlineGeneration() { 
        if (!activeFile || !projectData) return;
        const path = activeFile.path;
        try { 
            const sourceText = projectData.archivistContext ? projectData.archivistContext.trim() : "";
            const instructions = projectData.archivistPrompt ? projectData.archivistPrompt.trim() : "";
            if (sourceText.length === 0 && instructions.length === 0) throw new Error("ARCHIVIST IDLE: Please Upload Text OR enter a Title/Concept.");
            let combinedInput = "";
            let modeLabel = "";
            let useSearch = false;
            let outputFilename = activeFile.basename + "_OUTLINE.md";
            const estTime = cloud.estimateDuration(sourceText || instructions, 'architect');

            if (sourceText.length > 0) {
                modeLabel = "ANALYZING UPLOADED TEXT...";
                combinedInput = `INSTRUCTIONS: ${instructions}\n\nTEXT TO ANALYZE:\n${sourceText}`;
                startLoading(path, estTime, modeLabel);
            } else {
                modeLabel = "RESEARCHING & GENERATING...";
                combinedInput = `TARGET TITLE / CONCEPT: "${instructions}"\n\nDIRECTIVE: If this is an existing published story (Book/Movie), retrieve the accurate plot details and outline the published work. DO NOT include reviews, ratings, or critical reception. STRICTLY STORY ONLY.`;
                useSearch = true; 
                const sanitizedTitle = instructions.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_').substring(0, 40);
                if (sanitizedTitle.length > 0) outputFilename = sanitizedTitle + "_OUTLINE.md";
                startLoading(path, estTime, modeLabel); 
            }
            new Notice(modeLabel);
            const outlineText = await cloud.generateOutline(combinedInput, useSearch);
            await safeCreateFile(outputFilename, outlineText);
            new Notice(`Archivist Created.`);
        } catch (e: any) { handleError("Archivist", e);
        } 
        finally { stopLoading(path);
        } 
    }

    async function runAutoRepair() {
        if (!activeFile || !projectData || !projectData.lastActionPlan) return;
        const path = activeFile.path;
        const content = await app.vault.read(activeFile);
        const estTime = cloud.estimateDuration(content, 'repair');
        startLoading(path, estTime, "APPLYING NARRATIVE PATCH...");
        try {
            const repairedText = await cloud.autoRepair(content, projectData.lastActionPlan);
            const outputName = activeFile.basename + "_REPAIRED.md";
            await safeCreateFile(outputName, repairedText);
            new Notice(`Repaired File Created.`);
        } catch (e: any) { handleError("Auto-Patch", e);
        } 
        finally { stopLoading(path);
        }
    }

    // --- DEEP RENAME (NEW) ---
    async function runDeepRename() {
        if (!activeFile || !projectData) return;
        const chars = projectData.wizardState.characters;
        if (!chars || chars.length === 0) {
            new Notice("No characters found in Wizard.");
            return;
        }
        if (!confirm("RENAME CAST WARNING:\nThis will permanently update character names in your Wizard based on Deep Nomenclature logic. Undo is not supported.\n\nProceed?")) return;
        
        const path = activeFile.path;
        startLoading(path, 6000, "ETYMOLOGIST: RENAMING...");
        
        try {
            const context = projectData.wizardState.inspirationContext || "";
            const nameMap = await cloud.generateDeepNames(chars, context);
            
            // Apply updates
            let updateCount = 0;
            const newChars = chars.map(c => {
                if (nameMap[c.name]) {
                    updateCount++;
                    return { ...c, name: nameMap[c.name] };
                }
                return c;
            });
            
            projectData.wizardState.characters = newChars;

            // [PHASE 2 - UPDATE 4]: Add note to archivistContext
            if (updateCount > 0) {
                 const renameLog = `\n[SYSTEM NOTE - RENAMED CHARACTERS]:\n` +
                    Object.entries(nameMap).map(([oldN, newN]) => `- ${oldN} is now ${newN}`).join('\n');
                 projectData.archivistContext = (projectData.archivistContext || "") + renameLog;
            }

            projectData = { ...projectData };
            await saveProject(false);
            
            new Notice(`Renaming Complete. ${updateCount} characters updated.`);
            
        } catch (e: any) { handleError("Deep Rename", e); }
        finally { stopLoading(path); }
    }

    async function resetCurrentDisc() { 
        if (!activeFile) return;
        setFileLoading(activeFile.path, false); 
        if (!projectData) return;
        if (window.confirm("FORCE FORMAT DISC? Resets all data.")) { 
            const blankState = JSON.parse(JSON.stringify(DEFAULT_WIZARD_STATE));
            projectData.wizardState = blankState; 
            projectData.lastAiResult = null; 
            projectData.lastLightResult = null; 
            projectData.lastActionPlan = null; 
            projectData.lastMetaResult = null;
            projectData.lastAnalysisMtime = null;
            projectData.archivistPrompt = ""; 
            projectData.archivistContext = "";
            projectData.repairFocus = ""; 
            projectData = { ...projectData }; 
            await saveProject(true); 
            new Notice("Disc Formatted.");
        } 
    }

    // --- FORGE OPS HOOKS ---
    // --- FORGE HELPERS ---
    function handleAddRepairInstruction(instruction: string) {
        if (!projectData) return;
        const current = projectData.repairFocus ? projectData.repairFocus.trim() : "";
        const entry = `- [TRIBUNAL]: ${instruction}`;
        if (current.includes(entry)) return; // Prevent dupes

        projectData.repairFocus = current.length > 0 ? `${current}\n${entry}` : entry;
        new Notice("Instruction added to Forge.");
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


    onMount(() => { 
        const f = app.workspace.getActiveFile(); 
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
        <button class:active={currentTab === 'synth'} onclick={() => currentTab = 'synth'}>SYNTH</button>
        <button class:active={currentTab === 'forge'} onclick={() => currentTab = 'forge'}>FORGE</button>
    </div>

    <div class="window-body">
        {#if !activeFile}
             <div class="empty-state">INSERT DISK (OPEN MARKDOWN FILE)</div>
        {:else if projectData}
            
            {#if currentTab === 'critic'}
                <div class="panel-critic">
                    <div class="button-row">
                        <button class="action-btn primary" onclick={() => runAnalysis()}>
                            DEEP SCAN ({settings.enableTribunal ? 'TRIBUNAL' : `${settings.criticCores} CORES`})
                        </button>
                        <button class="action-btn secondary" onclick={runQuickScan}>QUICK SCAN</button>
                    </div>

                    {#if $processRegistry[activeFile.path] && $processOrigin[activeFile.path] === 'critic'} 
                        <Win95ProgressBar label="ANALYZING..." estimatedDuration={estimatedDuration} /> 
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
                                <!-- [WIN95 UPDATE]: 'Help' Replaced with Dynamic Smart Repair -->
                                <span class="win95-menu-item">Messages</span>
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <!-- svelte-ignore a11y-no-static-element-interactions -->
                                <span class="win95-menu-item" onclick={(e) => { e.stopPropagation(); showQuickScanMenu = !showQuickScanMenu; }}>
                                    Smart Repair...
                                </span>

                                {#if showQuickScanMenu}
                                    <div class="dropdown-list">
                                        <!-- Quick Scan specific improvement -->
                                        <div class="dd-item" onclick={() => { handleAddRepairInstruction(projectData?.lastLightResult?.key_improvement || "General Fix"); showQuickScanMenu = false; }}>
                                            Inject Fix: {projectData.lastLightResult.key_improvement.substring(0, 30)}...
                                        </div>

                                        <!-- Deep Scan Issues if Available -->
                                        {#if projectData.lastAiResult}
                                            <div style="border-top:1px dashed #000; margin:2px 0;"></div>
                                            {#if projectData.lastAiResult.content_warning && projectData.lastAiResult.content_warning !== 'None'}
                                                <div class="dd-item" onclick={() => { handleAddRepairInstruction(`Fix Critical: ${projectData?.lastAiResult?.content_warning}`); showQuickScanMenu = false; }}>Fix Warning</div>
                                            {/if}
                                            {#if projectData.lastAiResult.tribunal_breakdown?.logic.content_warning}
                                                <div class="dd-item" onclick={() => { handleAddRepairInstruction(`Logic Fix: ${projectData?.lastAiResult?.tribunal_breakdown?.logic.content_warning}`); showQuickScanMenu = false; }}>Logic Repair</div>
                                            {/if}
                                        {/if}
                                    </div>
                                {/if}
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
                            isProcessing={$processRegistry[activeFile.path]}
                            settings={settings}
                            onRunMeta={runMeta}
                            onAddRepairInstruction={handleAddRepairInstruction}
                        />
                         <button class="action-btn tertiary" onclick={runGenerateReport} style="margin-top:10px;">📄 EXPORT FORENSIC REPORT</button>
                    {/if}
                </div>

            {:else if currentTab === 'wizard'}
                <div class="panel-wizard">
                     <button class="action-btn secondary" onclick={runGhostwriter}>GENERATE FULL OUTLINE</button>
                 
                    {#if $processRegistry[activeFile.path] && $processOrigin[activeFile.path] === 'wizard'} 
                        <Win95ProgressBar label="ARCHITECTING..." estimatedDuration={estimatedDuration} /> 
                    {/if}

                    <WizardFields 
                        wizardState={projectData.wizardState} 
                        settings={settings}
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
                    />
                </div>

            {:else if currentTab === 'synth'}
                <div class="panel-synth">
                    {#if $processRegistry[activeFile.path] && $processOrigin[activeFile.path] === 'synth'} 
                        <Win95ProgressBar label="SYNTHESIZING..." estimatedDuration={10000} /> 
                    {/if}
                    <SynthesizerView 
                        app={app}
                        settings={settings}
                        drives={projectData.wizardState.synthesisDrives || []} 
                        onUpdateDrives={handleDrivesUpdate}
                        onUpdateSettings={handleSettingsUpdate}
                        onRunSynthesis={runDriveSynthesis}
                        onGetActiveContent={getActiveFileContent}
                    />
                </div>

            {:else if currentTab === 'forge'}
                 <div class="panel-forge">
                     <button class="action-btn primary" onclick={runForge}>GENERATE REPAIR PLAN</button>
                     
                     {#if $processRegistry[activeFile.path] && $processOrigin[activeFile.path] === 'forge'} 
                        <Win95ProgressBar label="FORGING..." estimatedDuration={estimatedDuration} /> 
                     {/if}

                     <div class="repair-focus-area">
                         <label for="repairFocus" class="input-label">REPAIR FOCUS (OPTIONAL):</label>
                         <textarea 
                            id="repairFocus"
                            class="retro-input" 
                            rows="2" 
                            placeholder="E.g., 'Fix the pacing in Act 2' or 'Make the villain scarier'" 
                            bind:value={projectData.repairFocus}
                            use:autoResize={projectData.repairFocus}
                        ></textarea>
                    </div>

                    <fieldset class="outline-fieldset win95-popup-window">
                         <div class="win95-titlebar">
                            <div class="win95-titlebar-text">
                                <span>🔧</span> <span>Prose Tools</span>
                            </div>
                        </div>
                        <div class="win95-content-inset" style="border:none; box-shadow:none; padding:10px;">
                             <div class="button-grid">
                                <button class="action-btn secondary" onclick={runFixDialogue}>FIX DIALOGUE PUNCTUATION</button>
                                <button class="action-btn secondary" onclick={() => runAdverbKiller('highlight')}>HIGHLIGHT ADVERBS (RED)</button>
                                <button class="action-btn secondary" onclick={runFilterHighlight}>HIGHLIGHT FILTER WORDS (YELLOW)</button>
                            </div>
                        </div>
                    </fieldset>

                    <fieldset class="outline-fieldset win95-popup-window">
                         <div class="win95-titlebar">
                            <div class="win95-titlebar-text">
                                <span>📚</span> <span>Structural Archivist</span>
                            </div>
                        </div>
                        <div class="win95-content-inset" style="border:none; box-shadow:none; padding:10px;">
                            <div class="memory-core bevel-down">
                                <div class="memory-status">
                                    <div class="status-indicator">
                                        <span class="led {hasArchivistData ? 'on' : 'off'}"></span>
                                        <span>{hasArchivistData ? 'BUFFER LOADED' : 'BUFFER EMPTY'}</span>
                                    </div>
                                    <div class="status-details">{archivistLength} CHARS</div>
                                </div>
                                <div class="context-controls">
                                    <button
                                        class="upload-btn {isArchivistSynced ? 'synced' : ''}"
                                        onclick={handleUploadArchivist}
                                        disabled={isArchivistSynced}
                                        title="Load active file into buffer"
                                    >
                                        {isArchivistSynced ? '✅ SYNCED' : '📥 LOAD BUFFER'}
                                    </button>
                                    <button class="scrub-btn" onclick={handleScrubArchivist} disabled={!hasArchivistData}>🗑️</button>
                                 </div>
                            </div>

                            <textarea
                                class="retro-input archivist-prompt"
                                rows="2"
                                placeholder="INSTRUCTIONS: Focus area OR Story Title (e.g. 'The Matrix')"
                                bind:value={projectData.archivistPrompt}
                                use:autoResize={projectData.archivistPrompt}
                            ></textarea>

                            <div class="grid-2">
                                <button class="action-btn tertiary outline-btn" onclick={runOutlineGeneration}>
                                    {hasArchivistData ? 'ANALYZE BUFFER' : 'GENERATE FROM TITLE'}
                                </button>
                                <!-- NEW BUTTON HERE -->
                                <button class="action-btn secondary outline-btn" onclick={runDeepRename}>
                                    🏷️ RENAME CAST (DEEP)
                                </button>
                            </div>
                        </div>
                    </fieldset>

                    {#if projectData.lastActionPlan}
                        <div class="forge-report win95-popup-window">
                             <div class="win95-titlebar">
                                <div class="win95-titlebar-text">
                                    <span>🛡️</span> <span>Repair Plan</span>
                                </div>
                                 <div class="win95-controls">
                                    <button class="win95-close-btn">X</button>
                                </div>
                            </div>
                            <div class="win95-menubar">
                                <span class="win95-menu-item">Actions</span>
                            </div>

                            <div class="win95-content-inset">
                                {#if projectData.lastActionPlan.thought_process}
                                    <details class="thought-trace bevel-groove">
                                        <summary class="thought-header">COGNITIVE TRACE (RAW)</summary>
                                        <div class="thought-content">{projectData.lastActionPlan.thought_process}</div>
                                    </details>
                                  {/if}

                                    <div class="weakness-alert">WEAK LINK: {projectData.lastActionPlan.weakest_link}</div>

                                {#if projectData.lastActionPlan.repairs}
                                    <div class="repair-list">
                                          {#each projectData.lastActionPlan.repairs as repair, i}
                                            <div class="repair-item">
                                              <div class="repair-header">ISSUE {i+1}: {repair.issue}</div>
                                               <div class="repair-body">{repair.instruction}</div>
                                              <div class="repair-why">RATIONALE: {repair.why}</div>
                                            </div>
                                        {/each}
                                    </div>
                                {:else if projectData.lastActionPlan.steps}
                                    <div class="repair-list legacy-mode">
                                       <p class="legacy-note">[LEGACY REPORT DETECTED - RE-RUN FOR DETAILS]</p>
                                        <ol class="forge-steps">
                                            {#each projectData.lastActionPlan.steps as step}
                                                <li>{step}</li>
                                            {/each}
                                        </ol>
                                    </div>
                                {/if}

                                 <button class="action-btn secondary" onclick={runAutoRepair}>EXECUTE REPAIR PROTOCOL (AUTO-PATCH)</button>
                            </div>
                        </div>
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
    .led.on { background: #00ff00; box-shadow: 0 0 5px #00ff00; }
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
    .active-led { background: #ff0000; color: #fff; border-color: #ff0000; box-shadow: 0 0 5px #ff0000; }
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
