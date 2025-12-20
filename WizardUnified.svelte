<script lang="ts">
    import { App } from 'obsidian';
    import type { NigsWizardState, NigsSettings, CharacterBlock, StoryBlock, DriveBlock } from './types';

    // Sub-components
    import WizardHome from './wizard/WizardHome.svelte';
    import AlchemyMode from './wizard/AlchemyMode.svelte';
    import ArchitectMode from './wizard/ArchitectMode.svelte';
    import WizardSidebar from './wizard/WizardSidebar.svelte';

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

    // Child Component Binding
    let alchemyComponent: ReturnType<typeof AlchemyMode>;

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
        const params = alchemyComponent?.getSynthesisParams() || { targetTitle: '', targetQuality: settings.defaultTargetQuality };
        onRunSynthesis(params.targetTitle, params.targetQuality);
    }

    function finishDetailedWizard() {
        onRunGhostwriter();
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
        <WizardSidebar {wizardMode} {currentStep} {SIMPLE_STEPS} {DETAILED_STEPS} />

        <!-- RIGHT CONTENT AREA -->
        <div class="wizard-content">

            <!-- ======================= HOME / WELCOME ======================= -->
            {#if wizardMode === 'none'}
                <WizardHome {setMode} />

            <!-- ======================= ALCHEMY MODE ======================= -->
            {:else if wizardMode === 'simple'}
                <AlchemyMode
                    bind:this={alchemyComponent}
                    {app} {settings} {currentStep} {drives}
                    {onUpdateDrives} {onRunSynthesis} {onGetActiveContent}
                />

            <!-- ======================= ARCHITECT MODE ======================= -->
            {:else if wizardMode === 'detailed'}
                <ArchitectMode
                    {app} {settings} {currentStep} {wizardState}
                    {onSave} {onAssist} {onUploadContext} {onScrubContext} {onClear} {onAutoFill}
                    {isContextSynced} {loadingField}
                    {onGradeCharacter} {onGradeStructure}
                />
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

    .wizard-content {
        flex: 1;
        padding: 20px;
        background: #c0c0c0;
        overflow-y: auto;
    }

    @media (max-width: 768px) {
        .unified-wizard-container {
            height: 100%;
            max-height: 100%;
        }

        .wizard-body {
            flex-direction: column;
        }
    }

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

</style>
