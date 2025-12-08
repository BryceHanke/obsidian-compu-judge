<script lang="ts">
    import { slide } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import type { NigsSettings, DriveBlock } from './types';
    import { autoResize } from './utils';
    import { Notice, App } from 'obsidian';

    interface Props {
        app: App;
        settings: NigsSettings;
        drives: DriveBlock[];
        onUpdateDrives: (d: DriveBlock[]) => void;
        onUpdateSettings: (s: Partial<NigsSettings>) => void;
        onRunSynthesis: (title?: string, quality?: number) => void;
        onGetActiveContent: () => Promise<string>;
    }

    let { app, settings, drives, onUpdateDrives, onUpdateSettings, onRunSynthesis, onGetActiveContent }: Props = $props();

    // Wizard State
    let currentStep = $state(0);
    const TOTAL_STEPS = 4;

    let targetTitle = $state("");
    let targetQuality = $state(settings.defaultTargetQuality); // Default from global
    let libraryDrives: DriveBlock[] = $state([]);
    let isLibraryOpen = $state(false);
    
    // Default path for the global library
    const LIBRARY_PATH = "_NARRATIVE_DRIVES.md";

    // --- NAVIGATION ---
    function nextStep() {
        if (currentStep < TOTAL_STEPS - 1) currentStep++;
    }

    function prevStep() {
        if (currentStep > 0) currentStep--;
    }

    function cancelWizard() {
        if (confirm("Cancel Narrative Synthesis Wizard?")) {
            currentStep = 0;
            // Optionally clear state? keeping it for now
        }
    }

    function finishWizard() {
        onRunSynthesis(targetTitle, targetQuality);
    }

    // --- ACTIVE DRIVE MANAGEMENT ---

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

    // --- LIBRARY MANAGEMENT ---

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
        const drives: DriveBlock[] = [];
        let currentDrive: Partial<DriveBlock> | null = null;
        let contentBuffer: string[] = [];

        for (const line of lines) {
            if (line.startsWith('## DRIVE:')) {
                if (currentDrive) {
                    currentDrive.content = contentBuffer.join('\n').trim();
                    drives.push(currentDrive as DriveBlock);
                }
                const name = line.replace('## DRIVE:', '').trim();
                currentDrive = {
                    id: 'lib_' + Date.now() + Math.random(),
                    name,
                    expanded: false
                };
                contentBuffer = [];
            } else if (currentDrive) {
                contentBuffer.push(line);
            }
        }
        if (currentDrive) {
            currentDrive.content = contentBuffer.join('\n').trim();
            drives.push(currentDrive as DriveBlock);
        }
        return drives;
    }

    function serializeLibrary(libDrives: DriveBlock[]): string {
        return libDrives.map(d => `## DRIVE: ${d.name}\n${d.content}\n`).join('\n');
    }

    async function saveToLibrary(drive: DriveBlock) {
        await loadLibrary();
        // Check for duplicates
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
        const newDrives = [...drives, {
            ...libDrive,
            id,
            expanded: true
        }];
        onUpdateDrives(newDrives);
        new Notice(`Mounted "${libDrive.name}" to Active Project.`);
    }

    async function deleteFromLibrary(index: number) {
        if (!confirm("Permanently delete this drive from the Library File?")) return;
        libraryDrives.splice(index, 1);
        libraryDrives = libraryDrives; // Trigger update
        await saveLibrary();
    }
    
    function toggleLibrary() {
        isLibraryOpen = !isLibraryOpen;
        if (isLibraryOpen) loadLibrary();
    }
</script>

<div class="synthesizer-container win95-window">
    <div class="win95-titlebar">
        <div class="win95-titlebar-text">Narrative Synthesis Wizard</div>
    </div>
    
    <div class="wizard-body">
        <!-- LEFT SIDEBAR IMAGE -->
        <div class="wizard-sidebar">
            <div class="sidebar-image-placeholder">
                <div class="sidebar-computer-icon">🖥️</div>
            </div>
        </div>

        <!-- RIGHT CONTENT AREA -->
        <div class="wizard-content">

            {#if currentStep === 0}
                <div class="step-content" transition:slide>
                    <h3>Welcome to the Narrative Synthesis Wizard</h3>
                    <p>This wizard will guide you through the process of fusing multiple Narrative Drives into a cohesive Masterpiece Story.</p>
                    <p>It is recommended that you have your source materials (Drives) ready before proceeding.</p>
                    <br>
                    <p>To continue, click Next.</p>
                </div>

            {:else if currentStep === 1}
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
                            <input type="range" id="synth-quality" min="50" max="100" step="5" style="flex:1"
                                bind:value={targetQuality} />
                        </div>

                        <p class="synth-desc">
                            <strong>Status:</strong> {drives?.length || 0} Drives Mounted.<br>
                            Ready to Initialize Fusion Sequence.
                        </p>
                    </fieldset>
                </div>
            {/if}
        </div>
    </div>

    <!-- BOTTOM BUTTON BAR -->
    <div class="wizard-footer">
        <div class="footer-divider"></div>
        <div class="footer-buttons">
            <button class="win95-btn" onclick={prevStep} disabled={currentStep === 0}>&lt; Back</button>

            {#if currentStep < TOTAL_STEPS - 1}
                <button class="win95-btn" onclick={nextStep}>Next &gt;</button>
            {:else}
                <button class="win95-btn" onclick={finishWizard}>Finish</button>
            {/if}

            <button class="win95-btn" style="margin-left: 10px;" onclick={cancelWizard}>Cancel</button>
        </div>
    </div>
</div>

<style>
    .synthesizer-container {
        display: flex;
        flex-direction: column;
        height: 500px; /* Fixed height for Wizard feel */
        border: 2px outset #fff;
        background: #c0c0c0;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.5);
    }
    
    .win95-titlebar {
        background: #000080;
        color: #fff;
        padding: 2px 4px;
        font-weight: bold;
    }

    .wizard-body {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    .wizard-sidebar {
        width: 150px;
        background: #008080; /* Teal background for sidebar image */
        display: flex;
        align-items: center;
        justify-content: center;
        border-right: 1px solid #808080;
        position: relative;
    }
    
    .sidebar-image-placeholder {
        width: 100%; height: 100%;
        background: linear-gradient(to bottom, #004040, #008080);
        display: flex; align-items: center; justify-content: center;
    }

    .sidebar-computer-icon {
        font-size: 64px;
        text-shadow: 2px 2px 0 #000;
    }

    .wizard-content {
        flex: 1;
        padding: 20px;
        background: #c0c0c0;
        overflow-y: auto;
    }

    .step-content h3 { margin-top: 0; font-family: 'Times New Roman', serif; font-size: 20px; margin-bottom: 10px; }
    .step-content p { font-family: 'Arial', sans-serif; font-size: 12px; margin-bottom: 10px; }

    .wizard-footer {
        padding: 10px;
        background: #c0c0c0;
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

    /* Drive List Styles inside Wizard */
    .drive-scroll-area {
        height: 250px;
        overflow-y: auto;
        padding: 5px;
        background: #fff;
        border: 2px inset #fff; /* Bevel down override */
    }

    .bevel-down { border: 2px inset #fff; background: #fff; }
    .bevel-up { border: 2px outset #fff; background: var(--cj-bg); padding: 2px; }
    .bevel-groove { border: 2px groove #fff; padding: 10px; background: transparent; margin: 0; }

    .drive-list { display: flex; flex-direction: column; gap: 5px; }
    
    .drive-header { 
        display: flex; justify-content: space-between; align-items: center; 
        background: #000080; color: #fff;
        padding: 2px 4px;
        cursor: pointer; 
    }
    
    .drive-title-row { display: flex; align-items: center; gap: 5px; flex: 1; }
    .drive-name-input { background: transparent; border: none; color: #fff; width: 100%; font-weight: bold; }
    
    .win95-btn.small { min-width: 20px; padding: 0 4px; font-size: 10px; }
    .win95-btn.dashed-btn { border: 1px dashed #000; background: transparent; width: 100%; margin-top: 5px; }
    
    .input-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .synth-desc { margin-top: 10px; border: 1px dotted #000; padding: 5px; background: #eee; }
    
    .library-container { margin-top: 10px; padding: 5px; height: 150px; overflow-y: auto; border: 2px inset #fff; background: #fff; }
    .lib-item { display: flex; justify-content: space-between; padding: 2px; border-bottom: 1px dotted #ccc; }
    
    .control-panel { margin-top: 10px; }
</style>
