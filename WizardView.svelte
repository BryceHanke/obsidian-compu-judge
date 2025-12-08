<script lang="ts">
    import { App } from 'obsidian';
    import type { NigsWizardState, NigsSettings, CharacterBlock, StoryBlock, DriveBlock } from './types';
    import WizardSimple from './WizardSimple.svelte';
    import WizardDetailed from './WizardDetailed.svelte';
    import Win95ProgressBar from './Win95ProgressBar.svelte';

    interface Props {
        // Common
        app: App;
        settings: NigsSettings;
        activeFileStatus: boolean; // isProcessing
        processOrigin: string | null;
        estimatedDuration: number;

        // Detailed Mode (Old Wizard) Props
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
        onRunGhostwriter: () => void;

        // Simple Mode (Synth) Props
        onUpdateDrives: (d: DriveBlock[]) => void;
        onUpdateSettings: (s: Partial<NigsSettings>) => void;
        onRunSynthesis: (title?: string, quality?: number) => void;
        onGetActiveContent: () => Promise<string>;
    }

    let {
        app, settings, activeFileStatus, processOrigin, estimatedDuration,
        wizardState, onSave, onAssist, onUploadContext, onScrubContext, onClear, onAutoFill, isContextSynced, loadingField, onGradeCharacter, onGradeStructure, onRunGhostwriter,
        onUpdateDrives, onUpdateSettings, onRunSynthesis, onGetActiveContent
    }: Props = $props();

    let mode: 'simple' | 'detailed' = $state('simple');

    function handleSwitchMode(newMode: 'simple' | 'detailed') {
        mode = newMode;
    }
</script>

<div class="wizard-view-container">
    {#if mode === 'detailed'}
        <button class="mode-btn back-to-home" onclick={() => mode = 'simple'}>
            <span class="icon">⬅</span> BACK TO WIZARD HOME
        </button>
    {/if}

    <div class="mode-content">
        {#if mode === 'simple'}
             <div class="panel-synth">
                {#if activeFileStatus && processOrigin === 'synth'}
                    <Win95ProgressBar label="SYNTHESIZING..." estimatedDuration={10000} />
                {/if}
                <WizardSimple
                    app={app}
                    settings={settings}
                    drives={wizardState.synthesisDrives || []}
                    onUpdateDrives={onUpdateDrives}
                    onUpdateSettings={onUpdateSettings}
                    onRunSynthesis={onRunSynthesis}
                    onGetActiveContent={onGetActiveContent}
                    onSwitchMode={handleSwitchMode}
                />
            </div>
        {:else}
            <div class="panel-wizard detailed-mode">
                <div class="detailed-header">
                     <button class="action-btn secondary" onclick={onRunGhostwriter}>GENERATE FULL OUTLINE</button>

                    {#if activeFileStatus && processOrigin === 'wizard'}
                        <Win95ProgressBar label="ARCHITECTING..." estimatedDuration={estimatedDuration} />
                    {/if}
                </div>

                <WizardDetailed
                    wizardState={wizardState}
                    settings={settings}
                    onSave={onSave}
                    onAssist={onAssist}
                    onUploadContext={onUploadContext}
                    onScrubContext={onScrubContext}
                    onClear={onClear}
                    onAutoFill={onAutoFill}
                    isContextSynced={isContextSynced}
                    loadingField={loadingField}
                    onGradeCharacter={onGradeCharacter}
                    onGradeStructure={onGradeStructure}
                />
            </div>
        {/if}
    </div>
</div>

<style>
    .wizard-view-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
    }

    .mode-btn {
        background: #c0c0c0;
        border: 2px outset #fff;
        padding: 8px;
        font-weight: bold;
        font-family: 'Pixelated MS Sans Serif', sans-serif;
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        color: #000;
        margin-bottom: 5px;
    }

    .mode-btn:active {
        border-style: inset;
    }

    .back-to-home {
        width: 100%;
    }

    .mode-content {
        flex: 1;
        overflow-y: auto;
    }

    .panel-synth, .panel-wizard {
        height: 100%;
    }

    .detailed-mode {
        padding-bottom: 20px;
    }

    .detailed-header {
        margin-bottom: 10px;
    }

    .action-btn { width: 100%; padding: 6px; font-weight: bold; cursor: pointer; border-top: 1px solid #fff; border-left: 1px solid #fff; border-right: 1px solid #000; border-bottom: 1px solid #000; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #dfdfdf; background: #c0c0c0; color: #000; margin-bottom: 8px; font-size: 11px; }
    .action-btn:active { border-top: 1px solid #000; border-left: 1px solid #000; border-right: 1px solid #fff; border-bottom: 1px solid #fff; box-shadow: inset 1px 1px 0 #808080; padding: 7px 5px 5px 7px; }

    .bevel-down { border: 2px inset #fff; }
</style>
