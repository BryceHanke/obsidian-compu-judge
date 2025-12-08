<script lang="ts">
    import { App } from 'obsidian';
    import type { NigsWizardState, NigsSettings, CharacterBlock, StoryBlock, DriveBlock } from './types';
    import WizardUnified from './WizardUnified.svelte';
    import Win95ProgressBar from './Win95ProgressBar.svelte';

    interface Props {
        // Common
        app: App;
        settings: NigsSettings;
        activeFileStatus: boolean; // isProcessing
        processOrigin: string | null;
        estimatedDuration: number;
        processId?: string;

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
        app, settings, activeFileStatus, processOrigin, estimatedDuration, processId,
        wizardState, onSave, onAssist, onUploadContext, onScrubContext, onClear, onAutoFill, isContextSynced, loadingField, onGradeCharacter, onGradeStructure, onRunGhostwriter,
        onUpdateDrives, onUpdateSettings, onRunSynthesis, onGetActiveContent
    }: Props = $props();

</script>

<div class="wizard-view-container">
    {#if activeFileStatus && processId}
        <div class="progress-overlay">
            <Win95ProgressBar processId={processId} />
        </div>
    {/if}

    <div class="mode-content">
        <WizardUnified
            app={app}
            settings={settings}
            wizardState={wizardState}
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
            onRunGhostwriter={onRunGhostwriter}
            onUpdateDrives={onUpdateDrives}
            onUpdateSettings={onUpdateSettings}
            onRunSynthesis={onRunSynthesis}
            onGetActiveContent={onGetActiveContent}
        />
    </div>
</div>

<style>
    .wizard-view-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        position: relative;
    }

    .mode-content {
        flex: 1;
        overflow-y: auto;
    }

    .progress-overlay {
        margin-bottom: 10px;
    }
</style>
