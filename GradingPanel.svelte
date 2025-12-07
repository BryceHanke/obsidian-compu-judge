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
    import { AudioEngine } from './AudioEngine'; // NEW

    interface Props {
        app: App;
        cloud: CloudGenService;
        settings: NigsSettings;
        onUpdateSettings: (s: Partial<NigsSettings>) => void;
        audio: AudioEngine; // NEW
    }

    let { app, cloud, settings: initialSettings, onUpdateSettings, audio }: Props = $props();
    let settings = $state(initialSettings);
    let activeFile: TFile | null = $state(null);
    let projectData: ProjectData | null = $state(null);
    let currentTab = $state('critic');
    let themeClass = $state('');
    let isSaving = $state(false);
    let estimatedDuration = $state(4000);
    let wizardLoadingField: string | null = $state(null);
    
    let isMsDos = $derived(settings.theme === 'msdos' || (settings.theme === 'auto' && document.body.classList.contains('theme-dark')));

    // Sync States
    let isContextSynced = $state(false);
    let isArchivistSynced = $state(false);
    
    let archivistLength = $derived(projectData?.archivistContext ? projectData.archivistContext.length : 0);
    let hasArchivistData = $derived(archivistLength > 0);

    let activeFileStatus = $derived(
        activeFile && $processRegistry[activeFile.path] ? 'PROCESSING' : 'READY'
    );

    const debouncedSave = debounce(() => saveProject(false), 1000);

    function handleSettingsUpdate(updates: Partial<NigsSettings>) {
        Object.assign(settings, updates);
        onUpdateSettings(updates);
        // Audio theme might need update if theme changed
        if (updates.theme) {
            audio.setTheme(updates.theme);
            applyTheme(updates.theme);
        }
    }
    
    function handleDrivesUpdate(newDrives: DriveBlock[]) {
        if (!projectData) return;
        projectData.wizardState.synthesisDrives = newDrives;
        saveProject(false);
    }

    function handleError(context: string, error: any) {
        audio.playError(); // AUDIO
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

    export const updateTheme = (theme: string) => {
        applyTheme(theme);
        audio.setTheme(theme);
    };

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
        audio.playClick();
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
        audio.playClick();
        if (confirm("Purge Inspiration Memory?")) {
            projectData.wizardState.inspirationContext = "";
            projectData = { ...projectData };
            saveProject(false);
            new Notice("Wizard Memory Purged.");
        }
    }

    function handleClearWizardState() {
        if (!projectData) return;
        audio.playClick();
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
        audio.playClick();
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
        audio.playClick();
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
        audio.playProcess(); // AUDIO LOOP START
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
            audio.playSuccess();
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
            audio.playSuccess();
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
            audio.playSuccess();
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
            audio.playSuccess();
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
            audio.playSuccess();
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
                audio.playSuccess();
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
            audio.playSuccess();
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
            audio.playSuccess();
        } catch (e: any) { handleError("Auto-Fill", e);
        } 
        finally { stopLoading(path);
        } 
    }

    async function runDriveSynthesis(customTitle?: string) {
        if (!activeFile || !projectData) return;
        const drives = projectData.wizardState.synthesisDrives || [];
        if (drives.length === 0) {
            new Notice("No drives found. Create a drive first.");
            return;
        }
        if (!confirm("INITIATE FUSION?\nThis will generate a new Universal Outline document from your drives.\n\nProceed?")) return;
        const path = activeFile.path;
        startLoading(path, 10000, "FUSING NARRATIVE DRIVES...");

        try {
            const outlineMarkdown = await cloud.synthesizeDrives(drives, customTitle);
            let outputName = "";
            
            if (customTitle && customTitle.trim().length > 0) {
                const safeTitle = customTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                outputName = `${safeTitle}.md`;
            } else {
                outputName = `${activeFile.basename}_UNIVERSAL_OUTLINE.md`;
            }

            await safeCreateFile(outputName, outlineMarkdown);
            new Notice("Universal Outline Created.");
            audio.playSuccess();
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
            audio.playSuccess();
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
                combinedInput = `TARGET TITLE / CONCEPT: "${instructions}"\n\nDIRECTIVE: If this is an existing published story (Book/Movie), retrieve the accurate plot details and outline the published work.`;
                useSearch = true; 
                const sanitizedTitle = instructions.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_').substring(0, 40);
                if (sanitizedTitle.length > 0) outputFilename = sanitizedTitle + "_OUTLINE.md";
                startLoading(path, estTime, modeLabel); 
            }
            new Notice(modeLabel);
            const outlineText = await cloud.generateOutline(combinedInput, useSearch);
            await safeCreateFile(outputFilename, outlineText);
            new Notice(`Archivist Created.`);
            audio.playSuccess();
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
            audio.playSuccess();
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
            projectData = { ...projectData };
            await saveProject(false);
            
            new Notice(`Renaming Complete. ${updateCount} characters updated.`);
            audio.playSuccess();
            
        } catch (e: any) { handleError("Deep Rename", e); }
        finally { stopLoading(path); }
    }

    async function resetCurrentDisc() { 
        if (!activeFile) return;
        setFileLoading(activeFile.path, false); 
        if (!projectData) return;
        audio.playClick();
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

    function applyTheme(mode: string) { 
        const isDark = document.body.classList.contains('theme-dark');
        if (mode === 'win95') themeClass = 'theme-win95';
        else if (mode === 'msdos') themeClass = 'theme-msdos';
        else if (mode === 'invert') themeClass = isDark ? 'theme-win95' : 'theme-msdos';
        else themeClass = isDark ? 'theme-msdos' : 'theme-win95';
    }

    // --- UI HELPERS ---
    function switchTab(tab: string) {
        audio.playClick();
        currentTab = tab;
    }

    async function runFixDialogue() {
        if (!activeFile) return;
        audio.playClick();
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
        audio.playClick();
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
        audio.playClick();
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
        audio.playClick();
        try {
            await ReportGen.generateReport(app, projectData, activeFile.basename);
        } catch (e: any) { handleError("Report Gen", e); }
    }

    onMount(() => { 
        const f = app.workspace.getActiveFile(); 
        updateActiveFile(f); 
        applyTheme(settings.theme); 
    });
</script>

<div class="compu-container {themeClass}" 
     style="--cj-user-color: {settings.msDosColor || '#00FF00'}; --cj-grade-masterpiece: {settings.gradingColors.masterpiece}">
    
    <div class="title-bar">
        <div class="title-bar-text">
            Compu-Judge 98 {activeFile ? `[${activeFile.basename.toUpperCase()}]` : '[NO DISC]'}
        </div>
        {#if activeFile}
            <button class="reset-btn" onclick={resetCurrentDisc} title="Force Format / Stop">RST</button>
        {/if}
    </div>

    <!-- TAB STRIP: In MS-DOS mode, this might look like [ TAB 1 ] [ TAB 2 ] -->
    <div class="tab-strip">
        <button class:active={currentTab === 'critic'} onclick={() => switchTab('critic')}>
            {isMsDos ? '[ CRITIC ]' : 'CRITIC'}
        </button>
        <button class:active={currentTab === 'wizard'} onclick={() => switchTab('wizard')}>
            {isMsDos ? '[ WIZARD ]' : 'WIZARD'}
        </button>
        <button class:active={currentTab === 'synth'} onclick={() => switchTab('synth')}>
             {isMsDos ? '[ SYNTH ]' : 'SYNTH'}
        </button>
        <button class:active={currentTab === 'forge'} onclick={() => switchTab('forge')}>
             {isMsDos ? '[ FORGE ]' : 'FORGE'}
        </button>
    </div>

    <div class="window-body">
        {#if !activeFile}
             <div class="empty-state">INSERT DISK (OPEN MARKDOWN FILE)</div>
        {:else if projectData}
            
            {#if currentTab === 'critic'}
                <div class="panel-critic">
                    <div class="button-row">
                        <button class="action-btn primary" onclick={() => runAnalysis()}>
                             {isMsDos ? '[ RUN DEEP SCAN ]' : `DEEP SCAN (${settings.analysisPasses} CORE)`}
                        </button>
                        <button class="action-btn secondary" onclick={runQuickScan}>
                            {isMsDos ? '[ QUICK SCAN ]' : 'QUICK SCAN'}
                        </button>
                    </div>

                    {#if $processRegistry[activeFile.path] && $processOrigin[activeFile.path] === 'critic'} 
                        <Win95ProgressBar label="ANALYZING..." estimatedDuration={estimatedDuration} /> 
                    {/if}
                
                    {#if projectData.lastLightResult}
                        <div class="quick-result">
                              <div class="quick-header">
                                <span class="quick-grade">{projectData.lastLightResult.letter_grade}</span>
                                <span class="quick-score">{projectData.lastLightResult.score}</span>
                             </div>
                            {#if projectData.lastLightResult.synopsis}
                                <p class="quick-synopsis"><span class="prefix">LOG:</span> {projectData.lastLightResult.synopsis}</p>
                            {/if}
                            <p class="quick-summary">{projectData.lastLightResult.summary_line}</p>
                            <p class="quick-fix">FIX: {projectData.lastLightResult.key_improvement}</p>
                        </div>
                    {/if}

                    {#if projectData.lastAiResult}
                        <CriticDisplay 
                            data={projectData.lastAiResult} 
                            meta={projectData.lastMetaResult} 
                            isProcessing={$processRegistry[activeFile.path]}
                            settings={settings}
                            onRunMeta={runMeta} 
                            isMsDos={isMsDos}
                        />
                         <button class="action-btn tertiary" onclick={runGenerateReport} style="margin-top:10px;">
                             {isMsDos ? '[ EXPORT REPORT ]' : '📄 EXPORT FORENSIC REPORT'}
                         </button>
                    {/if}
                </div>

            {:else if currentTab === 'wizard'}
                <div class="panel-wizard">
                     <button class="action-btn secondary" onclick={runGhostwriter}>
                        {isMsDos ? '[ GENERATE FULL OUTLINE ]' : 'GENERATE FULL OUTLINE'}
                     </button>
                 
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
                     <button class="action-btn primary" onclick={runForge}>
                        {isMsDos ? '[ GENERATE REPAIR PLAN ]' : 'GENERATE REPAIR PLAN'}
                     </button>
                     
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

                    <fieldset class="outline-fieldset">
                        <legend>{isMsDos ? '[ PROSE TOOLS ]' : 'PROSE TOOLS'}</legend>
                        <div class="button-grid">
                            <button class="action-btn secondary" onclick={runFixDialogue}>
                                {isMsDos ? '[ FIX PUNCTUATION ]' : 'FIX DIALOGUE PUNCTUATION'}
                            </button>
                            <button class="action-btn secondary" onclick={() => runAdverbKiller('highlight')}>
                                {isMsDos ? '[ HIGHLIGHT ADVERBS ]' : 'HIGHLIGHT ADVERBS (RED)'}
                            </button>
                            <button class="action-btn secondary" onclick={runFilterHighlight}>
                                {isMsDos ? '[ HIGHLIGHT FILTER WORDS ]' : 'HIGHLIGHT FILTER WORDS (YELLOW)'}
                            </button>
                        </div>
                    </fieldset>

                    <fieldset class="outline-fieldset">
                        <legend>{isMsDos ? '[ ARCHIVIST ]' : 'STRUCTURAL ARCHIVIST'}</legend>
                        <div class="memory-core bevel-down">
                            <div class="memory-status">
                                <div class="status-indicator">
                                    {#if isMsDos}
                                         <span>{hasArchivistData ? '[ LOADED ]' : '[ EMPTY ]'}</span>
                                    {:else}
                                        <span class="led {hasArchivistData ? 'on' : 'off'}"></span>
                                        <span>{hasArchivistData ? 'BUFFER LOADED' : 'BUFFER EMPTY'}</span>
                                    {/if}
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
                                    {isArchivistSynced ? (isMsDos ? '[ SYNCED ]' : '✅ SYNCED') : (isMsDos ? '[ LOAD ]' : '📥 LOAD BUFFER')}
                                </button>
                                <button class="scrub-btn" onclick={handleScrubArchivist} disabled={!hasArchivistData}>
                                     {isMsDos ? '[ DEL ]' : '🗑️'}
                                </button>
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
                                {hasArchivistData ? (isMsDos ? '[ ANALYZE ]' : 'ANALYZE BUFFER') : (isMsDos ? '[ GEN FROM TITLE ]' : 'GENERATE FROM TITLE')}
                            </button>
                            <!-- NEW BUTTON HERE -->
                            <button class="action-btn secondary outline-btn" onclick={runDeepRename}>
                                {isMsDos ? '[ RENAME CAST ]' : '🏷️ RENAME CAST (DEEP)'}
                            </button>
                        </div>
                    </fieldset>

                    {#if projectData.lastActionPlan}
                        <div class="forge-report">
                            {#if projectData.lastActionPlan.thought_process}
                                <details class="thought-trace bevel-groove">
                                    <summary class="thought-header">{isMsDos ? '> TRACE' : 'COGNITIVE TRACE (RAW)'}</summary>
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
             
                             <button class="action-btn secondary" onclick={runAutoRepair}>
                                {isMsDos ? '[ AUTO-PATCH ]' : 'EXECUTE REPAIR PROTOCOL (AUTO-PATCH)'}
                             </button>
                        </div>
                    {/if}
                 </div>
            {/if}
        {/if}
    </div>
    
   <div class="status-bar">
        <span>STATUS: {activeFileStatus}</span>
        <span class="spacer"></span>
        <span class:active-led={isSaving} class="disk-led">{isMsDos ? '[DISK]' : 'DISK ACT'}</span>
    </div>
</div>

<style>
    /* GLOBAL OVERRIDES IN STYLES.CSS */
</style>
