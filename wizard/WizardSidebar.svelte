<script lang="ts">
    interface Props {
        wizardMode: 'none' | 'simple' | 'detailed';
        currentStep: number;
        SIMPLE_STEPS: number;
        DETAILED_STEPS: number;
    }

    let { wizardMode, currentStep, SIMPLE_STEPS, DETAILED_STEPS }: Props = $props();
</script>

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

<style>
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

    @media (max-width: 768px) {
        .wizard-sidebar {
            width: 100%;
            height: auto;
            min-height: 60px;
            border-right: none;
            border-bottom: 1px solid #808080;
            flex-direction: row;
        }

        .sidebar-image-placeholder {
            flex-direction: row;
            padding: 10px;
            gap: 15px;
            justify-content: flex-start;
        }

        .sidebar-computer-icon {
            font-size: 32px;
        }

        .step-indicator {
            margin-top: 0;
            margin-left: auto;
            font-size: 12px;
        }
    }
</style>
