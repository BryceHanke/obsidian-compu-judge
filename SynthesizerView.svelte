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
    let targetTitle = $state("");
    let targetQuality = $state(settings.defaultTargetQuality); // Default from global
    let libraryDrives: DriveBlock[] = $state([]);
    let isLibraryOpen = $state(false);
    
    // Default path for the global library
    const LIBRARY_PATH = "_NARRATIVE_DRIVES.md";

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

<div class="synthesizer-container">
    
    <fieldset class="bevel-groove control-panel">
        <legend>FUSION CONTROL</legend>
        
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
            Mount multiple Context Drives to fuse them into a single Epic Narrative.
            <br><strong>Status:</strong> {drives?.length || 0} Drives Mounted.
        </p>

        <button class="win95-btn primary" onclick={() => onRunSynthesis(targetTitle, targetQuality)}>
            INITIALIZE FUSION SEQUENCE
        </button>
    </fieldset>

    <div class="drive-section-header">ACTIVE PROJECT DRIVES</div>
    <div class="drive-list">
        {#if drives}
            {#each drives as drive, i (drive.id)}
                <div class="drive-block bevel-up" animate:flip={{duration: 300}}>
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
                        <div class="drive-body" transition:slide>
                            <div class="memory-indicator">
                                <span class="led {drive.content.length > 0 ? 'on' : 'off'}"></span>
                                <span class="mem-text">{drive.content.length > 0 ? `BUFFER: ${drive.content.length} BYTES` : 'BUFFER EMPTY'}</span>
                            </div>
                            
                            <div class="input-wrap">
                                <textarea class="retro-input" rows="6" 
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

    <!-- LIBRARY SECTION -->
    <div class="library-section">
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
</div>

<style>
    .synthesizer-container { display: flex; flex-direction: column; gap: 15px; padding-bottom: 20px; }
    
    /* WIN95 PRIMITIVES */
    .bevel-groove { border: 2px groove #fff; padding: 10px; background: transparent; margin: 0; }
    .bevel-up { border: 2px outset #fff; background: var(--cj-bg); padding: 2px; }
    .bevel-down { border: 2px inset #fff; background: #fff; }
    legend { font-weight: bold; color: var(--cj-text); padding: 0 4px; }
    
    .control-panel { background: rgba(0,0,0,0.05); }
    .input-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    label { font-weight: bold; font-size: 11px; white-space: nowrap; }
    
    .synth-desc { font-size: 11px; margin-bottom: 15px; color: var(--cj-dim); text-align: center; border: 1px dotted var(--cj-dim); padding: 4px; }
    
    /* BUTTONS */
    .win95-btn {
        background: var(--cj-bg);
        color: var(--cj-text);
        border: 2px outset #fff;
        border-right-color: #000;
        border-bottom-color: #000;
        font-family: 'Courier New', monospace;
        font-weight: 900;
        cursor: pointer;
        padding: 6px 12px;
        text-transform: uppercase;
        font-size: 12px;
    }
    .win95-btn:active { border-style: inset; padding-top: 7px; padding-left: 13px; }
    .win95-btn.primary { width: 100%; padding: 10px; font-size: 14px; border: 2px outset #fff; border-right-color: #000; border-bottom-color: #000; }
    .win95-btn.small { padding: 2px 6px; min-width: 20px; font-size: 12px; line-height: 1; }
    .win95-btn.full-width { width: 100%; margin-top: 4px; }
    .win95-btn.dashed-btn { border: 2px dashed var(--cj-dim); background: transparent; color: var(--cj-dim); width: 100%; padding: 10px; }
    .win95-btn.dashed-btn:hover { border-style: solid; color: var(--cj-text); background: rgba(255,255,255,0.2); }

    /* DRIVE LIST */
    .drive-section-header { font-size: 11px; font-weight: 900; color: var(--cj-dim); border-bottom: 2px solid var(--cj-dim); margin-bottom: 5px; }
    .drive-list { display: flex; flex-direction: column; gap: 10px; }
    
    .drive-header { 
        display: flex; justify-content: space-between; align-items: center; 
        background: #000080; /* Win95 Title Bar Blue */
        color: #fff;
        padding: 4px 6px; 
        cursor: pointer; 
    }
    
    .drive-title-row { display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden; }
    .drive-icon { font-size: 12px; }
    .drive-id-badge { font-size: 11px; font-weight: bold; white-space: nowrap; }
    
    .drive-name-input { 
        background: transparent; border: none; font-weight: bold; 
        font-family: inherit; font-size: 12px; color: #fff; width: 100%; 
    }
    .drive-name-input:focus { background: #fff; color: #000; outline: none; }
    .drive-name-input::placeholder { color: #ccc; }
    
    .drive-controls { display: flex; gap: 4px; }
    
    .drive-body { padding: 10px; background: var(--cj-bg); border: 1px solid var(--cj-dim); border-top: none; }
    
    .memory-indicator { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 10px; font-weight: bold; border-bottom: 1px solid var(--cj-dim); padding-bottom: 4px; }
    .led { width: 8px; height: 8px; border-radius: 50%; border: 1px solid #808080; background: #004400; }
    .led.on { background: #00FF00; box-shadow: 0 0 4px #00FF00; }
    .mem-text { color: var(--cj-dim); }

    /* LIBRARY STYLES */
    .library-section { margin-top: 20px; border-top: 2px groove #fff; padding-top: 10px; }
    .library-toggle { width: 100%; text-align: left; }
    .library-container { margin-top: 5px; padding: 5px; height: 200px; overflow-y: auto; background: #fff; color: #000; }
    .library-header { display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 4px; color: #555; }
    .refresh-btn { background: none; border: none; cursor: pointer; font-weight: bold; }
    
    .lib-item { display: flex; align-items: center; padding: 4px; border-bottom: 1px dotted #ccc; font-size: 12px; }
    .lib-item:hover { background: #eee; }
    .lib-icon { margin-right: 6px; }
    .lib-name { flex: 1; font-weight: bold; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .lib-actions { display: flex; gap: 4px; }
    .del-btn { color: red !important; }
    
    .empty-lib { text-align: center; color: #999; padding: 20px; font-size: 11px; font-style: italic; }

</style>