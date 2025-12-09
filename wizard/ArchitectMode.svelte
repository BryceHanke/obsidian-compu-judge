<script lang="ts">
    import { slide } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { autoResize } from '../utils';
    import { App } from 'obsidian';
    import type { NigsWizardState, NigsSettings, CharacterBlock, StoryBlock } from '../types';

    interface Props {
        app: App;
        settings: NigsSettings;
        currentStep: number;
        wizardState: NigsWizardState;

        onSave: () => void;
        onAssist: (field: string) => void;
        onUploadContext: () => void;
        onScrubContext: () => void;
        onClear: () => void;
        onAutoFill: () => void;

        isContextSynced: boolean;
        loadingField: string | null;

        onGradeCharacter?: (char: CharacterBlock) => Promise<CharacterBlock>;
        onGradeStructure?: (beat: StoryBlock) => Promise<StoryBlock>;
    }

    let {
        app, settings, currentStep, wizardState,
        onSave, onAssist, onUploadContext, onScrubContext, onClear, onAutoFill,
        isContextSynced, loadingField,
        onGradeCharacter, onGradeStructure
    }: Props = $props();

    // Derived
    let contextLength = $derived(wizardState.inspirationContext ? wizardState.inspirationContext.length : 0);
    let hasContext = $derived(contextLength > 0);

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
                <input type="range" id="w_target" class="retro-range" min="-50" max="50" step="5"
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
                                <span class="role-badge {(char.role || 'Support').toString().toLowerCase()}">{char.role || 'Support'}</span>
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
                                <span class="role-badge {(block.type || 'Beat').toString().toLowerCase().replace(/\s/g, '-')}" style="width: 80px; text-align:center;">{block.type || 'Beat'}</span>
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
    .win95-btn:disabled { color: #808080; text-shadow: 1px 1px 0 #fff; }

    /* FORM STYLES & BEVELS */
    .bevel-down { border: 2px inset #fff; background: #fff; }
    .bevel-groove { border: 2px groove var(--cj-dim); padding: 15px; margin: 0; background: transparent; margin-bottom: 20px; }

    legend { font-weight: bold; padding: 0 5px; color: var(--cj-text); font-size: 1.1em; }
    label { display: block; margin-top: 12px; margin-bottom: 4px; font-size: 0.9em; font-weight: bold; color: var(--cj-dim); text-transform: uppercase; }
    .input-wrap { display: flex; gap: 5px; align-items: flex-start; }

    :global(.retro-input) { resize: none; overflow: hidden; min-height: 28px; box-sizing: border-box; font-family: 'Courier New', monospace; }

    /* MEMORY INDICATORS */
    .led { width: 10px; height: 10px; border-radius: 50%; border: 1px solid #00ff00; }
    .led.on { background: radial-gradient(circle at 30% 30%, #e0ffe0, #00ff00); border-color: #00ff00; }
    .led.off { background: #111; border-color: #555; }
    .memory-indicator { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 10px; font-weight: bold; }
    .memory-status { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 5px; }
    .status-indicator { display: flex; align-items: center; gap: 5px; font-weight: bold; }
    .status-details { font-size: 10px; }
    .context-controls { display: flex; gap: 5px; width: 100%; }

    /* DETAILED SPECIFIC */
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

    .footer-controls { margin-top: 20px; }

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
