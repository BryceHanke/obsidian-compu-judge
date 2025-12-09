<script lang="ts">
    import type { NigsSettings } from '../types';

    interface Props {
        setMode: (mode: 'simple' | 'detailed') => void;
    }

    let { setMode }: Props = $props();
</script>

<div class="step-content">
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

<style>
    /* TYPOGRAPHY */
    .step-content h3 { margin-top: 0; font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 16px; margin-bottom: 10px; font-weight: bold; }
    .step-content p { font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; font-size: 11px; margin-bottom: 10px; }

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
</style>
