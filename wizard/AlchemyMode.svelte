<script lang="ts">
    import { slide } from 'svelte/transition';
    import { autoResize } from '../utils';
    import { Notice, App } from 'obsidian';
    import type { NigsSettings, DriveBlock } from '../types';

    interface Props {
        app: App;
        settings: NigsSettings;
        currentStep: number;
        drives: DriveBlock[];
        onUpdateDrives: (d: DriveBlock[]) => void;
        onRunSynthesis: (title?: string, quality?: number) => void;
        onGetActiveContent: () => Promise<string>;
    }

    let { app, settings, currentStep, drives, onUpdateDrives, onRunSynthesis, onGetActiveContent }: Props = $props();

    // Local State
    let targetTitle = $state("");
    let targetQuality = $state(settings.defaultTargetQuality);
    let libraryDrives: DriveBlock[] = $state([]);
    let isLibraryOpen = $state(false);
    const LIBRARY_PATH = "_NARRATIVE_DRIVES.md";

    // --- ALCHEMY LOGIC ---

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

    // Exposed for parent to call on finish
    export function getSynthesisParams() {
        return { targetTitle, targetQuality };
    }

</script>

{#if currentStep === 1}
    <div class="step-content" transition:slide>
        <h3>Step 1: Mount Narrative Drives</h3>
        <p>Please mount the context drives you wish to fuse.</p>

        <div class="drive-scroll-area bevel-down">
            <div class="drive-list">
                {#if drives}
                    {#each drives as drive, i (drive.id)}
                        <div class="drive-block bevel-up">
                            <div class="drive-header"
                                class:instruction-drive={drive.name.toLowerCase().includes('story instruction')}
                                onclick={() => toggleExpandDrive(i)}>
                                <div class="drive-title-row">
                                    <span class="drive-icon">{drive.name.toLowerCase().includes('story instruction') ? '⚠️' : '💾'}</span>
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
                <input type="range" id="synth-quality" class="retro-range" min="-50" max="50" step="5" style="flex:1"
                    bind:value={targetQuality} />
            </div>

            <p class="synth-desc">
                <strong>Status:</strong> {drives?.length || 0} Drives Mounted.<br>
                Ready to Initialize Fusion Sequence.
            </p>
        </fieldset>
    </div>
{/if}

<style>
    /* TYPOGRAPHY */
    .step-content h3 { margin-top: 0; font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 16px; margin-bottom: 10px; font-weight: bold; }
    .step-content p { font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 11px; margin-bottom: 10px; }

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
    .drive-header.instruction-drive { background: #FFD700; color: #000; }
    .drive-title-row { display: flex; align-items: center; gap: 5px; flex: 1; }
    .drive-name-input { background: transparent; border: none; color: #fff; width: 100%; font-weight: bold; }
    .instruction-drive .drive-name-input { color: #000; }
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
</style>
