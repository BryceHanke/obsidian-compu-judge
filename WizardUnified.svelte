<script lang="ts">
    import { slide } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { autoResize } from './utils';
    import { Notice, App } from 'obsidian';
    import type { NigsWizardState, NigsSettings, CharacterBlock, StoryBlock, DriveBlock } from './types';

    interface Props {
        // Common
        app: App;
        settings: NigsSettings;

        // State
        wizardState: NigsWizardState; // Used by Detailed, and contains synthesisDrives for Simple

        // Actions
        onSave: () => void;
        onAssist: (field: string) => void;
        onUploadContext: () => void;
        onScrubContext: () => void;
        onClear: () => void;
        onAutoFill: () => void;

        // Status
        isContextSynced: boolean;
        loadingField: string | null;

        // Simple Mode specific
        onUpdateDrives: (d: DriveBlock[]) => void;
        onUpdateSettings: (s: Partial<NigsSettings>) => void;
        onRunSynthesis: (title?: string, quality?: number) => void;
        onGetActiveContent: () => Promise<string>;

        // Detailed Mode specific
        onGradeCharacter?: (char: CharacterBlock) => Promise<CharacterBlock>;
        onGradeStructure?: (beat: StoryBlock) => Promise<StoryBlock>;
        onRunGhostwriter: () => void;
    }

    let {
        app, settings, wizardState,
        onSave, onAssist, onUploadContext, onScrubContext, onClear, onAutoFill,
        isContextSynced, loadingField,
        onUpdateDrives, onUpdateSettings, onRunSynthesis, onGetActiveContent,
        onGradeCharacter, onGradeStructure, onRunGhostwriter
    }: Props = $props();

    // --- UNIFIED STATE ---
    let wizardMode = $state<'none' | 'simple' | 'detailed'>('none');
    let currentStep = $state(0);

    // Derived
    let drives = $derived(wizardState.synthesisDrives || []);
    let contextLength = $derived(wizardState.inspirationContext ? wizardState.inspirationContext.length : 0);
    let hasContext = $derived(contextLength > 0);

    // Simple Mode Local State
    let targetTitle = $state("");
    let targetQuality = $state(settings.defaultTargetQuality);
    let libraryDrives: DriveBlock[] = $state([]);
    let isLibraryOpen = $state(false);
    const LIBRARY_PATH = "_NARRATIVE_DRIVES.md";

    // Constants
    const SIMPLE_STEPS = 3; // After welcome
    const DETAILED_STEPS = 4; // After welcome

    // --- NAVIGATION ---
    function setMode(mode: 'simple' | 'detailed') {
        wizardMode = mode;
        currentStep = 1; // Start at step 1 of the specific mode
    }

    function resetToHome() {
        wizardMode = 'none';
        currentStep = 0;
    }

    function nextStep() {
        const max = wizardMode === 'simple' ? SIMPLE_STEPS : DETAILED_STEPS;
        if (currentStep < max) currentStep++;
    }

    function prevStep() {
        if (currentStep > 1) {
            currentStep--;
        } else {
            resetToHome();
        }
    }

    function finishSimpleWizard() {
        onRunSynthesis(targetTitle, targetQuality);
    }

    function finishDetailedWizard() {
        onRunGhostwriter();
    }

    // ==========================================================================================
    // LOGIC: SIMPLE WIZARD (ALCHEMY)
    // ==========================================================================================

    function addDrive() {
        const id = 'd' + Date.now();
        const currentDrives = drives || [];
        const newDrives = [...currentDrives, {
            id, name: 'New Narrative Drive', content: '', expanded: true
        }];
        onUpdateDrives(newDrives);
    }

    function removeDrive(index: number) {
        if (confirm("Delete this Drive from Active Project?")) {
            const newDrives = [...drives];
            newDrives.splice(index, 1);
            onUpdateDrives(newDrives);
        }
    }

    async function uploadToDrive(index: number) {
        const content = await onGetActiveContent();
        if (!content || content.trim().length === 0) {
            new Notice("Active file is empty.");
            return;
        }
        const newDrives = JSON.parse(JSON.stringify(drives));
        newDrives[index].content = content;
        new Notice(`Drive "${newDrives[index].name}" updated with ${content.length} chars.`);
        onUpdateDrives(newDrives);
    }

    function toggleExpandDrive(index: number) {
        const newDrives = [...drives];
        newDrives[index].expanded = !newDrives[index].expanded;
        onUpdateDrives(newDrives);
    }

    function handleDriveInput() {
        onUpdateDrives(drives);
    }

    // Library
    async function loadLibrary() {
        try {
            const exists = await app.vault.adapter.exists(LIBRARY_PATH);
            if (!exists) {
                libraryDrives = [];
                return;
            }
            const content = await app.vault.adapter.read(LIBRARY_PATH);
            libraryDrives = parseLibrary(content);
        } catch (e) {
            console.error("Library Load Error", e);
            new Notice("Failed to load Drive Library.");
        }
    }

    async function saveLibrary() {
        try {
            const content = serializeLibrary(libraryDrives);
            await app.vault.adapter.write(LIBRARY_PATH, content);
            new Notice("Library Saved.");
        } catch (e) {
            console.error("Library Save Error", e);
            new Notice("Failed to save Drive Library.");
        }
    }

    function parseLibrary(text: string): DriveBlock[] {
        const lines = text.split('\n');
        const d: DriveBlock[] = [];
        let current: Partial<DriveBlock> | null = null;
        let buffer: string[] = [];

        for (const line of lines) {
            if (line.startsWith('## DRIVE:')) {
                if (current) {
                    current.content = buffer.join('\n').trim();
                    d.push(current as DriveBlock);
                }
                const name = line.replace('## DRIVE:', '').trim();
                current = { id: 'lib_' + Date.now() + Math.random(), name, expanded: false };
                buffer = [];
            } else if (current) {
                buffer.push(line);
            }
        }
        if (current) {
            current.content = buffer.join('\n').trim();
            d.push(current as DriveBlock);
        }
        return d;
    }

    function serializeLibrary(libDrives: DriveBlock[]): string {
        return libDrives.map(d => `## DRIVE: ${d.name}\n${d.content}\n`).join('\n');
    }

    async function saveToLibrary(drive: DriveBlock) {
        await loadLibrary();
        const existing = libraryDrives.find(d => d.name === drive.name);
        if (existing) {
            if (!confirm(`Overwrite existing library drive "${drive.name}"?`)) return;
            existing.content = drive.content;
        } else {
            libraryDrives.push({ ...drive, id: 'lib_' + Date.now() });
        }
        await saveLibrary();
    }

    async function mountFromLibrary(libDrive: DriveBlock) {
        const id = 'd' + Date.now();
        const newDrives = [...drives, { ...libDrive, id, expanded: true }];
        onUpdateDrives(newDrives);
        new Notice(`Mounted "${libDrive.name}" to Active Project.`);
    }

    async function deleteFromLibrary(index: number) {
        if (!confirm("Permanently delete this drive from the Library File?")) return;
        libraryDrives.splice(index, 1);
        libraryDrives = libraryDrives;
        await saveLibrary();
    }

    function toggleLibrary() {
        isLibraryOpen = !isLibraryOpen;
        if (isLibraryOpen) loadLibrary();
    }

    // ==========================================================================================
    // LOGIC: DETAILED WIZARD (ARCHITECT)
    // ==========================================================================================

    function handleInput() { onSave(); }
    function handleBlur() { onSave(); }

    // Character Logic
    function addCharacter() {
        const id = 'c' + Date.now();
        wizardState.characters.push({
            id, role: 'Support', name: 'New Character', description: '',
            competence: 50, proactivity: 50, likability: 50,
            flaw: '', revelation: '', expanded: true
        });
        onSave();
    }

    function removeCharacter(index: number) {
        if (confirm("Delete this character block?")) {
            wizardState.characters.splice(index, 1);
            onSave();
        }
    }

    function toggleExpandChar(index: number) {
        wizardState.characters[index].expanded = !wizardState.characters[index].expanded;
    }

    async function autoGrade(index: number) {
        if (!onGradeCharacter) return;
        const char = wizardState.characters[index];
        const updated = await onGradeCharacter(char);
        wizardState.characters[index] = updated;
        onSave();
    }

    function handleScoreClick(e: MouseEvent, index: number, field: 'competence' | 'proactivity' | 'likability') {
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, Math.round((x / rect.width) * 100)));
        wizardState.characters[index][field] = percentage;
        onSave();
    }

    // Try/Fail Logic
    function addTryFailCycle() {
        const id = 'tf' + Date.now();
        if (!wizardState.structureDNA.tryFailCycles) wizardState.structureDNA.tryFailCycles = [];
        wizardState.structureDNA.tryFailCycles.push({
            id, goal: '', attempt1: '', attempt2: '', success: ''
        });
        onSave();
    }

    function removeTryFailCycle(index: number) {
        if (confirm("Delete this cycle?")) {
            wizardState.structureDNA.tryFailCycles.splice(index, 1);
            onSave();
        }
    }

    // Structure Logic
    function addStoryBlock() {
        const id = 's' + Date.now();
        wizardState.structure.push({
            id, title: 'New Beat', type: 'Beat', description: '',
            characters: '', tension: 50, expanded: true
        });
        onSave();
    }

    function removeStoryBlock(index: number) {
        if (confirm("Delete this story beat?")) {
            wizardState.structure.splice(index, 1);
            onSave();
        }
    }

    function moveStoryBlock(index: number, direction: -1 | 1) {
        if (index + direction < 0 || index + direction >= wizardState.structure.length) return;
        const temp = wizardState.structure[index];
        wizardState.structure[index] = wizardState.structure[index + direction];
        wizardState.structure[index + direction] = temp;
        onSave();
    }

    function toggleExpandStory(index: number) {
        wizardState.structure[index].expanded = !wizardState.structure[index].expanded;
    }

    async function autoGradeStructure(index: number) {
        if (!onGradeStructure) return;
        const beat = wizardState.structure[index];
        const updated = await onGradeStructure(beat);
        wizardState.structure[index] = updated;
        onSave();
    }

    function handleTensionClick(e: MouseEvent, index: number) {
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, Math.round((x / rect.width) * 100)));
        wizardState.structure[index].tension = percentage;
        onSave();
    }

    // Utils
    function getTensionColor(val: number): string {
        const hue = 240 + (val / 100) * 60;
        return `hsl(${hue}, 70%, 50%)`;
    }

    function getScoreColor(val: number): string {
        const c = settings.gradingColors;
        if (val > 50) return c.masterpiece;
        if (val >= 40) return c.excellent;
        if (val >= 25) return c.good;
        if (val > -25) return c.average;
        if (val > -40) return c.poor;
        return c.critical;
    }

    function isCritical(val: number): boolean {
        return val <= -60;
    }
</script>

<div class="unified-wizard-container win95-window">
    <div class="win95-titlebar">
        <div class="win95-titlebar-text">
            {#if wizardMode === 'none'}
                Narrative Wizard - Home
            {:else if wizardMode === 'simple'}
                Narrative Synthesis Wizard (Alchemy)
            {:else}
                Narrative Architect Wizard (Story Bible)
            {/if}
        </div>
        <div class="win95-titlebar-controls">
            <!-- X button or similar could go here -->
        </div>
    </div>

    <div class="wizard-body">
        <!-- LEFT SIDEBAR -->
        <div class="wizard-sidebar" class:alchemy={wizardMode === 'simple'} class:architect={wizardMode === 'detailed'}>
            <div class="sidebar-image-placeholder">
                <div class="sidebar-computer-icon">
                    {#if wizardMode === 'simple'}⚗️
                    {:else if wizardMode === 'detailed'}🧙‍♂️
                    {:else}🖥️
                    {/if}
                </div>
                {#if wizardMode !== 'none'}
                    <div class="step-indicator">
                        STEP {currentStep} / {wizardMode === 'simple' ? SIMPLE_STEPS : DETAILED_STEPS}
                    </div>
                {/if}
            </div>
        </div>

        <!-- RIGHT CONTENT AREA -->
        <div class="wizard-content">

            <!-- ======================= HOME / WELCOME ======================= -->
            {#if wizardMode === 'none'}
                <div class="step-content" transition:slide>
                    <h3>Welcome to the Narrative Synthesis Wizard</h3>
                    <p>Select your operational mode:</p>

                    <div class="mode-selection">
                         <button class="mode-card" onclick={() => setMode('simple')}>
                             <span class="mode-icon">⚗️</span>
                             <div class="mode-info">
                                 <span class="mode-title">Narrative Synthesis (Alchemy)</span>
                                 <span class="mode-desc">Fuse multiple "Drives" (ideas, snippets, characters) into a new cohesive story.</span>
                             </div>
                         </button>

                         <button class="mode-card" onclick={() => setMode('detailed')}>
                            <span class="mode-icon">🧙‍♂️</span>
                            <div class="mode-info">
                                <span class="mode-title">Narrative Architect (Story Bible)</span>
                                <span class="mode-desc">Build a complete Story Bible (Characters, Structure, Theme) from a single concept.</span>
                            </div>
                        </button>
                    </div>
                    <p>It is recommended that you have your source materials (Drives) ready before proceeding with Synthesis.</p>
                </div>

            <!-- ======================= ALCHEMY MODE ======================= -->
            {:else if wizardMode === 'simple'}

                {#if currentStep === 1}
                    <div class="step-content" transition:slide>
                        <h3>Step 1: Mount Narrative Drives</h3>
                        <p>Please mount the context drives you wish to fuse.</p>

                        <div class="drive-scroll-area bevel-down">
                            <div class="drive-list">
                                {#if drives}
                                    {#each drives as drive, i (drive.id)}
                                        <div class="drive-block bevel-up">
                                            <div class="drive-header" onclick={() => toggleExpandDrive(i)}>
                                                <div class="drive-title-row">
                                                    <span class="drive-icon">💾</span>
                                                    <span class="drive-id-badge">DRIVE {i+1}:</span>
                                                    <input type="text" class="drive-name-input"
                                                        bind:value={drive.name}
                                                        oninput={handleDriveInput}
                                                        onclick={(e) => e.stopPropagation()}
                                                        placeholder="Drive Label" />
                                                </div>
                                                <div class="drive-controls">
                                                    <button onclick={(e) => { e.stopPropagation(); saveToLibrary(drive); }} class="win95-btn small" title="Save to Library">💾</button>
                                                    <button onclick={(e) => { e.stopPropagation(); removeDrive(i); }} class="win95-btn small" title="Unmount">×</button>
                                                </div>
                                            </div>

                                            {#if drive.expanded}
                                                <div class="drive-body">
                                                    <div class="memory-indicator">
                                                        <span class="led {drive.content.length > 0 ? 'on' : 'off'}"></span>
                                                        <span class="mem-text">{drive.content.length > 0 ? `BUFFER: ${drive.content.length} BYTES` : 'BUFFER EMPTY'}</span>
                                                    </div>

                                                    <div class="input-wrap">
                                                        <textarea class="retro-input" rows="4"
                                                            bind:value={drive.content}
                                                            use:autoResize={drive.content}
                                                            oninput={handleDriveInput}
                                                            placeholder="Paste raw narrative data or..."></textarea>

                                                        <button class="win95-btn full-width" onclick={() => uploadToDrive(i)}>
                                                            📥 IMPORT FROM ACTIVE FILE
                                                        </button>
                                                    </div>
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                {/if}
                                <button class="win95-btn dashed-btn" onclick={addDrive}>+ MOUNT NEW EMPTY DRIVE</button>
                            </div>
                        </div>
                    </div>

                {:else if currentStep === 2}
                    <div class="step-content" transition:slide>
                        <h3>Step 2: Drive Library (Optional)</h3>
                        <p>You can load existing drives from your local library.</p>

                        <button class="win95-btn library-toggle" onclick={toggleLibrary}>
                            {isLibraryOpen ? '▼ CLOSE DRIVE LIBRARY' : '► OPEN DRIVE LIBRARY'}
                        </button>

                        {#if isLibraryOpen}
                            <div class="library-container bevel-down" transition:slide>
                                <div class="library-header">
                                    <span>SOURCE: _NARRATIVE_DRIVES.MD</span>
                                    <button class="refresh-btn" onclick={loadLibrary}>↻</button>
                                </div>

                                {#if libraryDrives.length === 0}
                                    <div class="empty-lib">LIBRARY IS EMPTY. SAVE ACTIVE DRIVES TO POPULATE.</div>
                                {:else}
                                    {#each libraryDrives as libDrive, i}
                                        <div class="lib-item">
                                            <span class="lib-icon">💿</span>
                                            <span class="lib-name">{libDrive.name}</span>
                                            <div class="lib-actions">
                                                <button onclick={() => mountFromLibrary(libDrive)} class="win95-btn small" title="Mount to Project">▲ LOAD</button>
                                                <button onclick={() => deleteFromLibrary(i)} class="win95-btn small del-btn" title="Delete from Library">×</button>
                                            </div>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        {/if}
                    </div>

                {:else if currentStep === 3}
                    <div class="step-content" transition:slide>
                        <h3>Step 3: Fusion Parameters</h3>
                        <p>Configure the final parameters for the synthesis engine.</p>

                        <fieldset class="bevel-groove control-panel">
                            <legend>SETTINGS</legend>

                            <div class="input-row">
                                <label for="synth-title">TARGET CODENAME:</label>
                                <input type="text" id="synth-title" class="retro-input"
                                    bind:value={targetTitle}
                                    placeholder="e.g. PROJECT CHIMERA (Optional)" />
                            </div>

                            <div class="input-row">
                                <label for="synth-quality">TARGET QUALITY: {targetQuality}</label>
                                <input type="range" id="synth-quality" class="retro-range" min="-100" max="100" step="5" style="flex:1"
                                    bind:value={targetQuality} />
                            </div>

                            <p class="synth-desc">
                                <strong>Status:</strong> {drives?.length || 0} Drives Mounted.<br>
                                Ready to Initialize Fusion Sequence.
                            </p>
                        </fieldset>
                    </div>
                {/if}

            <!-- ======================= ARCHITECT MODE ======================= -->
            {:else if wizardMode === 'detailed'}

                {#if currentStep === 1}
                    <div class="step-content" transition:slide>
                        <h3>Step 1: Core Engine & Memory</h3>
                        <p>Establish the narrative foundation and load context memory.</p>

                        <fieldset class="bevel-groove memory-core">
                            <legend>MEMORY CORE</legend>
                            <div class="memory-status">
                                <div class="status-indicator">
                                    <span class="led {hasContext ? 'on' : 'off'}"></span>
                                    <span>{hasContext ? 'DATA LOADED' : 'EMPTY'}</span>
                                </div>
                                <div class="status-details">SIZE: {contextLength} CHARS</div>
                            </div>
                            <div class="context-controls">
                                <button class="win95-btn {isContextSynced ? 'synced' : ''}" style="flex:1;" onclick={isContextSynced ? null : onUploadContext} disabled={isContextSynced}>
                                    {isContextSynced ? '✅ SYNCED' : '📥 IMPORT ACTIVE NOTE'}
                                </button>
                                <button class="win95-btn" onclick={onScrubContext} disabled={!hasContext}>🗑️ PURGE</button>
                            </div>
                        </fieldset>

                        <fieldset class="bevel-groove">
                            <legend>SANDERSON'S 1ST LAW</legend>
                            <label for="w_concept">Concept / Logline</label>
                            <div class="input-wrap">
                                <textarea id="w_concept" class="retro-input" rows="2"
                                    bind:value={wizardState.concept} use:autoResize={wizardState.concept} oninput={handleInput} onblur={handleBlur}
                                    disabled={loadingField === 'concept'}
                                    placeholder="High concept summary..."></textarea>
                                <button class="assist-btn {loadingField === 'concept' ? 'loading' : ''}" onclick={() => onAssist('concept')} disabled={!!loadingField}>?</button>
                            </div>

                            <label for="w_target">TARGET QUALITY SCORE: {wizardState.targetScore || settings.defaultTargetQuality}</label>
                            <div class="input-wrap">
                                <input type="range" id="w_target" class="retro-range" min="-100" max="100" step="5"
                                    bind:value={wizardState.targetScore} onchange={handleInput} />
                            </div>

                            <button class="win95-btn full-width" onclick={onAutoFill} disabled={!!loadingField}>
                                ✨ AUTO-GENERATE STORY BIBLE
                            </button>

                            <div class="grid-3-p">
                                <div class="p-col">
                                    <label title="What plot/tonal promise do you make in the first chapter?">THE PROMISE (HOOK)</label>
                                    <div class="input-wrap">
                                        <textarea class="retro-input" rows="4"
                                            bind:value={wizardState.threePs.promise} use:autoResize={wizardState.threePs.promise} oninput={handleInput} onblur={handleBlur}
                                            disabled={loadingField === 'threePs.promise'}></textarea>
                                        <button class="assist-btn {loadingField === 'threePs.promise' ? 'loading' : ''}" onclick={() => onAssist('threePs.promise')} disabled={!!loadingField}>?</button>
                                    </div>
                                </div>
                                <div class="p-col">
                                    <label title="How does the story move forward? (Travel, Discovery, Clues)">THE PROGRESS (SHIFT)</label>
                                    <div class="input-wrap">
                                        <textarea class="retro-input" rows="4"
                                            bind:value={wizardState.threePs.progress} use:autoResize={wizardState.threePs.progress} oninput={handleInput} onblur={handleBlur}
                                            disabled={loadingField === 'threePs.progress'}></textarea>
                                        <button class="assist-btn {loadingField === 'threePs.progress' ? 'loading' : ''}" onclick={() => onAssist('threePs.progress')} disabled={!!loadingField}>?</button>
                                    </div>
                                </div>
                                <div class="p-col">
                                    <label title="How is the promise fulfilled? (Must match the promise type)">THE PAYOFF (CLIMAX)</label>
                                    <div class="input-wrap">
                                        <textarea class="retro-input" rows="4"
                                            bind:value={wizardState.threePs.payoff} use:autoResize={wizardState.threePs.payoff} oninput={handleInput} onblur={handleBlur}
                                            disabled={loadingField === 'threePs.payoff'}></textarea>
                                        <button class="assist-btn {loadingField === 'threePs.payoff' ? 'loading' : ''}" onclick={() => onAssist('threePs.payoff')} disabled={!!loadingField}>?</button>
                                    </div>
                                </div>
                            </div>
                        </fieldset>
                    </div>

                {:else if currentStep === 2}
                    <div class="step-content" transition:slide>
                        <h3>Step 2: Structure DNA</h3>
                        <p>Define the structural threads and scene escalation cycles.</p>

                        <fieldset class="bevel-groove">
                            <legend>M.I.C.E. QUOTIENT & CYCLES</legend>
                            <div class="grid-2">
                                <div>
                                    <label>Primary M.I.C.E. Thread</label>
                                    <div class="input-wrap">
                                        <select class="retro-input" bind:value={wizardState.structureDNA.primaryThread} onchange={handleInput}>
                                            <option value="Event">EVENT (Status Quo)</option>
                                            <option value="Character">CHARACTER (Identity)</option>
                                            <option value="Milieu">MILIEU (Place)</option>
                                            <option value="Inquiry">INQUIRY (Mystery)</option>
                                        </select>
                                        <button class="assist-btn {loadingField === 'structureDNA.primaryThread' ? 'loading' : ''}" onclick={() => onAssist('structureDNA.primaryThread')} disabled={!!loadingField}>?</button>
                                    </div>
                                </div>
                                <div>
                                    <label>Nesting Order</label>
                                    <div class="input-wrap">
                                        <input type="text" class="retro-input"
                                            placeholder="e.g. Milieu > Inquiry > Character"
                                            bind:value={wizardState.structureDNA.nestingOrder}
                                            oninput={handleInput} />
                                        <button class="assist-btn {loadingField === 'structureDNA.nestingOrder' ? 'loading' : ''}" onclick={() => onAssist('structureDNA.nestingOrder')} disabled={!!loadingField}>?</button>
                                    </div>
                                </div>
                            </div>

                            <label style="margin-top: 15px; color: var(--cj-accent); border-bottom: 1px dashed var(--cj-dim);">TRY / FAIL CYCLES (SCENE ESCALATION)</label>
                            {#if wizardState.structureDNA.tryFailCycles}
                                {#each wizardState.structureDNA.tryFailCycles as cycle, i}
                                    <div class="char-block bevel-down" style="margin-bottom: 10px; margin-top: 10px;">
                                        <div class="char-header">
                                            <span class="char-name-display" style="font-size: 12px;">CYCLE {i+1}</span>
                                            <button class="del-btn" onclick={() => removeTryFailCycle(i)}>×</button>
                                        </div>
                                        <div class="char-body">
                                            <label>The Goal</label>
                                            <div class="input-wrap">
                                                <input class="retro-input" bind:value={cycle.goal} onblur={handleBlur} placeholder="What do they want right now?" disabled={loadingField === `structureDNA.tryFailCycles.${i}.goal`} />
                                                <button class="assist-btn {loadingField === `structureDNA.tryFailCycles.${i}.goal` ? 'loading' : ''}" onclick={() => onAssist(`structureDNA.tryFailCycles.${i}.goal`)} disabled={!!loadingField}>?</button>
                                            </div>
                                            <div class="grid-3-p" style="margin-top: 5px;">
                                                <div>
                                                    <label style="color:#800000; font-size: 0.8em;">1. FAIL (NO, AND)</label>
                                                    <div class="input-wrap">
                                                        <textarea class="retro-input" rows="3" bind:value={cycle.attempt1} onblur={handleBlur} placeholder="Disaster strikes..." disabled={loadingField === `structureDNA.tryFailCycles.${i}.attempt1`}></textarea>
                                                        <button class="assist-btn {loadingField === `structureDNA.tryFailCycles.${i}.attempt1` ? 'loading' : ''}" onclick={() => onAssist(`structureDNA.tryFailCycles.${i}.attempt1`)} disabled={!!loadingField}>?</button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style="color:#808000; font-size: 0.8em;">2. FAIL (NO, BUT)</label>
                                                    <div class="input-wrap">
                                                        <textarea class="retro-input" rows="3" bind:value={cycle.attempt2} onblur={handleBlur} placeholder="Learning moment..." disabled={loadingField === `structureDNA.tryFailCycles.${i}.attempt2`}></textarea>
                                                        <button class="assist-btn {loadingField === `structureDNA.tryFailCycles.${i}.attempt2` ? 'loading' : ''}" onclick={() => onAssist(`structureDNA.tryFailCycles.${i}.attempt2`)} disabled={!!loadingField}>?</button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style="color:#008000; font-size: 0.8em;">3. SUCCESS (YES, BUT)</label>
                                                    <div class="input-wrap">
                                                        <textarea class="retro-input" rows="3" bind:value={cycle.success} onblur={handleBlur} placeholder="New problem arises..." disabled={loadingField === `structureDNA.tryFailCycles.${i}.success`}></textarea>
                                                        <button class="assist-btn {loadingField === `structureDNA.tryFailCycles.${i}.success` ? 'loading' : ''}" onclick={() => onAssist(`structureDNA.tryFailCycles.${i}.success`)} disabled={!!loadingField}>?</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            {/if}
                            <button class="win95-btn dashed-btn" onclick={addTryFailCycle}>+ ADD TRY-FAIL CYCLE</button>
                        </fieldset>
                    </div>

                {:else if currentStep === 3}
                    <div class="step-content" transition:slide>
                        <h3>Step 3: Dramatis Personae</h3>
                        <p>Configure character archetypes, stats, and arcs.</p>

                        <fieldset class="bevel-groove character-section">
                            <legend>THE SLIDERS</legend>
                            <div class="char-list">
                                {#each wizardState.characters as char, i (char.id)}
                                    <div class="char-block bevel-down" animate:flip={{duration: 300}}>
                                        <div class="char-header" onclick={() => toggleExpandChar(i)} title="Toggle Expand">
                                            <div class="char-title">
                                                <span class="role-badge {char.role.toLowerCase()}">{char.role}</span>
                                                <input type="text" class="char-name-input" bind:value={char.name} oninput={handleInput} onclick={(e) => e.stopPropagation()} placeholder="Name" />
                                            </div>
                                            <div class="char-controls">
                                                <button onclick={(e) => { e.stopPropagation(); removeCharacter(i); }} class="del-btn">×</button>
                                                <span class="expand-icon">{char.expanded ? '−' : '+'}</span>
                                            </div>
                                        </div>
                                        {#if char.expanded}
                                            <div class="char-body" transition:slide>
                                                <div class="input-wrap">
                                                    <textarea class="retro-input" rows="2" bind:value={char.description} use:autoResize={char.description} oninput={handleInput} placeholder="Role & Bio..."></textarea>
                                                    <button class="assist-btn {loadingField === `characters.${i}.description` ? 'loading' : ''}" onclick={() => onAssist(`characters.${i}.description`)} disabled={!!loadingField}>?</button>
                                                    <button class="assist-btn analyze-btn" onclick={() => autoGrade(i)} title="Auto-Grade Scales">⚡</button>
                                                </div>

                                                <div class="score-grid">
                                                    <div class="score-item">
                                                        <div class="score-header">
                                                            <span class="score-label" title="How good are they at what they do?">COMPETENCE</span>
                                                            <span class="score-val">{char.competence}%</span>
                                                        </div>
                                                        <div class="score-track bevel-down {isCritical(char.competence) ? 'critical-bar' : ''}" onclick={(e) => handleScoreClick(e, i, 'competence')} role="button" tabindex="0">
                                                            <div class="score-fill" style="width: {char.competence}%; background: {getScoreColor(char.competence)}"></div>
                                                        </div>
                                                    </div>
                                                    <div class="score-item">
                                                        <div class="score-header">
                                                            <span class="score-label" title="Do they make things happen?">PROACTIVITY</span>
                                                            <span class="score-val">{char.proactivity}%</span>
                                                        </div>
                                                        <div class="score-track bevel-down {isCritical(char.proactivity) ? 'critical-bar' : ''}" onclick={(e) => handleScoreClick(e, i, 'proactivity')} role="button" tabindex="0">
                                                            <div class="score-fill" style="width: {char.proactivity}%; background: {getScoreColor(char.proactivity)}"></div>
                                                        </div>
                                                    </div>
                                                    <div class="score-item">
                                                        <div class="score-header">
                                                            <span class="score-label" title="Do we like them? (Sympathy)">LIKABILITY</span>
                                                            <span class="score-val">{char.likability}%</span>
                                                        </div>
                                                        <div class="score-track bevel-down {isCritical(char.likability) ? 'critical-bar' : ''}" onclick={(e) => handleScoreClick(e, i, 'likability')} role="button" tabindex="0">
                                                            <div class="score-fill" style="width: {char.likability}%; background: {getScoreColor(char.likability)}"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <button class="win95-btn dashed-btn" onclick={addCharacter}>+ ADD CHARACTER</button>
                        </fieldset>
                    </div>

                {:else if currentStep === 4}
                    <div class="step-content" transition:slide>
                        <h3>Step 4: The Beat Sheet</h3>
                        <p>Outline the sequence of events and narrative tension.</p>

                        <fieldset class="bevel-groove">
                            <legend>STRUCTURE</legend>
                            <div class="char-list">
                                {#each wizardState.structure as block, i (block.id)}
                                    <div class="char-block bevel-down" animate:flip={{duration: 300}}>
                                        <div class="char-header" onclick={() => toggleExpandStory(i)}>
                                            <div class="char-title">
                                                <span class="role-badge {block.type.toLowerCase().replace(/\s/g, '-')}" style="width: 80px; text-align:center;">{block.type}</span>
                                                <input type="text" class="char-name-input" bind:value={block.title} oninput={handleInput} onclick={(e) => e.stopPropagation()} placeholder="Beat Title" />
                                            </div>
                                            <div class="char-controls">
                                                <button onclick={(e) => { e.stopPropagation(); moveStoryBlock(i, -1); }} disabled={i === 0}>▲</button>
                                                <button onclick={(e) => { e.stopPropagation(); removeStoryBlock(i); }} class="del-btn">×</button>
                                            </div>
                                        </div>
                                        {#if block.expanded}
                                            <div class="char-body" transition:slide>
                                                <div class="input-wrap">
                                                    <textarea class="retro-input" rows="3" bind:value={block.description} use:autoResize={block.description} oninput={handleInput} placeholder="Action & Change..."></textarea>
                                                    <button class="assist-btn {loadingField === `structure.${i}.description` ? 'loading' : ''}" onclick={() => onAssist(`structure.${i}.description`)} disabled={!!loadingField}>?</button>
                                                    <button class="assist-btn analyze-btn" onclick={() => autoGradeStructure(i)} title="Auto-Grade Tension & Type">⚡</button>
                                                </div>
                                                <div class="score-item" style="margin-top: 10px;">
                                                    <div class="score-header">
                                                        <span class="score-label">TENSION</span>
                                                        <span class="score-val">{block.tension}%</span>
                                                    </div>
                                                    <div class="score-track bevel-down {isCritical(block.tension) ? 'critical-bar' : ''}" onclick={(e) => handleTensionClick(e, i)} role="button" tabindex="0">
                                                        <div class="score-fill" style="width: {block.tension}%; background: {getTensionColor(block.tension)}"></div>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <button class="win95-btn dashed-btn" onclick={addStoryBlock}>+ ADD STORY BEAT</button>
                        </fieldset>

                        <div class="footer-controls">
                            <button class="win95-btn" onclick={onClear}>RESET FIELDS</button>
                        </div>
                    </div>
                {/if}

            {/if}
        </div>
    </div>

    <!-- WIZARD FOOTER NAVIGATION -->
    <div class="wizard-footer">
        <div class="footer-divider"></div>
        <div class="footer-buttons">
            {#if wizardMode !== 'none'}
                <button class="win95-btn" onclick={prevStep}>&lt; Back</button>

                {#if wizardMode === 'simple'}
                    {#if currentStep < SIMPLE_STEPS}
                        <button class="win95-btn" onclick={nextStep}>Next &gt;</button>
                    {:else}
                        <button class="win95-btn" onclick={finishSimpleWizard}>Initialize Fusion</button>
                    {/if}
                {:else if wizardMode === 'detailed'}
                    {#if currentStep < DETAILED_STEPS}
                        <button class="win95-btn" onclick={nextStep}>Next &gt;</button>
                    {:else}
                         <button class="win95-btn" onclick={finishDetailedWizard}>GENERATE FULL OUTLINE</button>
                    {/if}
                {/if}
            {:else}
                <!-- Home Screen has no footer buttons usually, but we can have Cancel -->
            {/if}
        </div>
    </div>
</div>

<style>
    /* UNIFIED CONTAINER */
    .unified-wizard-container {
        display: flex;
        flex-direction: column;
        height: 600px;
        border: 2px outset #fff;
        background: #c0c0c0;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.5);
    }

    .win95-titlebar {
        background: linear-gradient(90deg, #000080 0%, #1084d0 100%);
        color: #fff;
        padding: 2px 4px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
    }

    .wizard-body {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    .wizard-sidebar {
        width: 150px;
        background: #008080;
        display: flex;
        align-items: center;
        justify-content: center;
        border-right: 1px solid #808080;
        position: relative;
    }

    /* Sidebar Variants */
    .wizard-sidebar.alchemy .sidebar-image-placeholder { background: #008080; }
    .wizard-sidebar.architect .sidebar-image-placeholder { background: #800080; }

    .sidebar-image-placeholder {
        width: 100%; height: 100%;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: #008080;
    }

    .sidebar-computer-icon {
        font-size: 64px;
        text-shadow: 2px 2px 0 #000;
    }

    .step-indicator {
        color: #fff;
        font-weight: bold;
        margin-top: 10px;
        font-size: 10px;
    }

    .wizard-content {
        flex: 1;
        padding: 20px;
        background: #c0c0c0;
        overflow-y: auto;
    }

    /* TYPOGRAPHY */
    .step-content h3 { margin-top: 0; font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 16px; margin-bottom: 10px; font-weight: bold; }
    .step-content p { font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 11px; margin-bottom: 10px; }

    /* FOOTER */
    .wizard-footer {
        padding: 10px;
        background: #c0c0c0;
        flex-shrink: 0;
    }
    .footer-divider {
        border-top: 1px solid #808080;
        border-bottom: 1px solid #fff;
        margin-bottom: 10px;
    }
    .footer-buttons {
        display: flex;
        justify-content: flex-end;
    }

    /* BUTTONS */
    .win95-btn {
        min-width: 75px;
        margin-left: 5px;
        background: #c0c0c0;
        border: 2px outset #fff;
        border-right-color: #000;
        border-bottom-color: #000;
        padding: 4px 10px;
        font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
        font-size: 11px;
    }
    .win95-btn:active { border-style: inset; padding: 5px 9px 3px 11px; }
    .win95-btn:disabled { color: #808080; text-shadow: 1px 1px 0 #fff; }

    /* MODE SELECTION */
    .mode-selection {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
    }
    .mode-card {
        display: flex;
        align-items: center;
        gap: 15px;
        background: #c0c0c0;
        border: 2px outset #fff;
        border-right-color: #000;
        border-bottom-color: #000;
        padding: 10px;
        text-align: left;
        cursor: pointer;
        color: #000;
        transition: none;
    }
    .mode-card:active {
        border-style: inset;
        border-top-color: #000;
        border-left-color: #000;
        border-right-color: #fff;
        border-bottom-color: #fff;
        background: #c0c0c0;
        padding: 11px 9px 9px 11px;
    }
    .mode-icon { font-size: 24px; }
    .mode-info { display: flex; flex-direction: column; }
    .mode-title { font-weight: bold; font-size: 13px; color: #000; }
    .mode-desc { font-size: 11px; color: #000; }

    /* FORM STYLES & BEVELS */
    .bevel-down { border: 2px inset #fff; background: #fff; }
    .bevel-up { border: 2px outset #fff; background: var(--cj-bg); padding: 2px; }
    .bevel-groove { border: 2px groove var(--cj-dim); padding: 15px; margin: 0; background: transparent; margin-bottom: 20px; }

    legend { font-weight: bold; padding: 0 5px; color: var(--cj-text); font-size: 1.1em; }
    label { display: block; margin-top: 12px; margin-bottom: 4px; font-size: 0.9em; font-weight: bold; color: var(--cj-dim); text-transform: uppercase; }
    .input-wrap { display: flex; gap: 5px; align-items: flex-start; }

    :global(.retro-input) { resize: none; overflow: hidden; min-height: 28px; box-sizing: border-box; font-family: 'Courier New', monospace; }

    /* DRIVE LIST (SIMPLE) */
    .drive-scroll-area { height: 250px; overflow-y: auto; padding: 5px; }
    .drive-list { display: flex; flex-direction: column; gap: 5px; }
    .drive-header { display: flex; justify-content: space-between; align-items: center; background: #000080; color: #fff; padding: 2px 4px; cursor: pointer; }
    .drive-title-row { display: flex; align-items: center; gap: 5px; flex: 1; }
    .drive-name-input { background: transparent; border: none; color: #fff; width: 100%; font-weight: bold; }
    .drive-body { padding: 5px; }

    /* MEMORY INDICATORS */
    .led { width: 10px; height: 10px; border-radius: 50%; border: 1px solid #00ff00; }
    .led.on { background: radial-gradient(circle at 30% 30%, #e0ffe0, #00ff00); border-color: #00ff00; }
    .led.off { background: #111; border-color: #555; }
    .memory-indicator { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 10px; font-weight: bold; }

    /* LIBRARY (SIMPLE) */
    .library-container { margin-top: 10px; padding: 5px; height: 150px; overflow-y: auto; }
    .lib-item { display: flex; justify-content: space-between; padding: 2px; border-bottom: 1px dotted #ccc; }
    .win95-btn.small { min-width: 20px; padding: 0 4px; font-size: 10px; }

    /* DETAILED SPECIFIC */
    .autofill-btn { width: 100%; margin: 15px 0; padding: 6px; background: #c0c0c0; color: #000; font-weight: bold; border: 2px outset #fff; cursor: pointer; }
    .autofill-btn:active { border-style: inset; }

    .char-block { background: rgba(0,0,0,0.03); padding: 5px; border: 2px solid var(--cj-dim); }
    .char-header { display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.1); padding: 5px; cursor: pointer; }
    .char-title { display: flex; align-items: center; gap: 8px; flex: 1; }
    .role-badge { font-size: 10px; font-weight: 900; padding: 2px 4px; color: #fff; text-transform: uppercase; background: #555; }
    .char-name-input { background: transparent; border: none; font-weight: bold; font-family: inherit; font-size: 14px; color: var(--cj-text); width: 100%; }
    .char-controls button { background: transparent; border: none; cursor: pointer; font-weight: bold; color: var(--cj-dim); }
    .del-btn { color: red !important; }
    .char-body { padding: 10px; border-top: 1px dashed var(--cj-dim); }

    .grid-3-p { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }

    .score-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 15px 0; }
    .score-track { height: 16px; background: #fff; border: 2px inset var(--cj-dim); cursor: crosshair; position: relative; overflow: hidden; }
    .score-fill { height: 100%; border-right: 2px solid rgba(0,0,0,0.5); }

    .assist-btn { width: 32px; height: 30px; flex-shrink: 0; background: var(--cj-accent); color: #fff; border: 2px outset var(--cj-light); position: relative; display: flex; align-items: center; justify-content: center; font-weight: bold; cursor: pointer; }
    .assist-btn.loading::after { content: ""; width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; position: absolute; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* UTILS */
    .win95-btn.full-width { width: 100%; margin: 0; margin-top: 5px; }
    .win95-btn.dashed-btn { border: 1px dashed #000; background: transparent; width: 100%; margin-top: 5px; }
    .library-toggle { margin-bottom: 5px; width: 100%; text-align: left; }
    .input-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }

    /* RETRO RANGE SLIDER */
    .retro-range {
        -webkit-appearance: none;
        width: 100%;
        background: transparent;
        margin: 10px 0;
    }
    .retro-range:focus { outline: none; }
    .retro-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        height: 20px;
        width: 10px;
        background: #c0c0c0;
        cursor: pointer;
        margin-top: -8px;
        border-top: 1px solid #fff;
        border-left: 1px solid #fff;
        border-right: 1px solid #000;
        border-bottom: 1px solid #000;
        box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #dfdfdf;
        border-radius: 0;
    }
    .retro-range::-webkit-slider-runnable-track {
        width: 100%;
        height: 4px;
        cursor: pointer;
        background: #fff;
        border-top: 1px solid #808080;
        border-left: 1px solid #808080;
        border-right: 1px solid #fff;
        border-bottom: 1px solid #fff;
        box-shadow: inset 1px 1px 0 #000;
    }

    @media (max-width: 600px) {
        .grid-3-p, .grid-2 { grid-template-columns: 1fr; }
        .score-grid { grid-template-columns: 1fr; }
    }
</style>
