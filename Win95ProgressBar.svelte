<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { activeProcesses, cancelProcess } from './store';
    
    interface Props {
        processId: string;
    }
    
    let { processId }: Props = $props();

    // Subscribe to the specific process
    let process = $derived($activeProcesses[processId]);
    
    let progress = $state(0);
    let interval: NodeJS.Timeout;
    let timeDisplay = $state("");
    
    // Use the process status directly, or fallback to label
    let currentStatus = $derived(process?.status || "PROCESSING...");
    let label = $derived(process?.label || "PROCESSING...");
    let estimatedDuration = $derived(process?.estimatedDuration || 5000);

    // Fallback thoughts if status isn't updating (legacy behavior simulation if needed, but we prefer dynamic)
    const thoughts = [
        "PARSING NARRATIVE STRUCTURE...",
        "QUERYING TROPE DATABASE...",
        "ANALYZING CHARACTER VECTORS...",
        "CALCULATING PACING ENTROPY...",
        "DETECTING PLOT HOLES...",
        "SYNTHESIZING FEEDBACK...",
        "COMPILING FINAL REPORT...",
        "CHECKING THEMATIC CONSISTENCY...",
        "OPTIMIZING NARRATIVE ARC...",
        "CROSS-REFERENCING CAST LIST...",
        "CALCULATING INCITING INCIDENT...",
        "EVALUATING MIDPOINT REVERSAL..."
    ];

    onMount(() => {
        if (!process) return;

        const fps = 30;
        const intervalTime = 1000 / fps;
        // Re-calculate steps based on when it started
        const elapsed = Date.now() - process.startTime;
        const remainingTime = Math.max(1000, estimatedDuration - elapsed);

        const totalSteps = estimatedDuration / intervalTime;
        let currentStep = elapsed / intervalTime;
        let lastThoughtSwitch = 0;

        const seconds = Math.ceil(remainingTime / 1000);
        timeDisplay = `EST: ~${seconds}s`;

        interval = setInterval(() => {
            currentStep++;
            const t = currentStep / totalSteps;
            // Asymptotic approach to 95%
            const targetProgress = 95 * (1 - Math.exp(-3 * t)); 
            
            if (targetProgress > progress) {
                 progress = targetProgress;
            }
            if (progress > 99) progress = 99;

            const remaining = Math.max(0, Math.ceil((estimatedDuration - (currentStep * intervalTime)) / 1000));
            timeDisplay = remaining > 0 ? `EST: ~${remaining}s` : `FINALIZING...`;

            // Note: We rely on the parent to update the status text now via the store
            // But if status equals label (no update yet), we can cycle thoughts
            // However, the user asked for "exactly what step", so we trust the store updates.

        }, intervalTime);

        return () => clearInterval(interval);
    });

    onDestroy(() => {
        if (interval) clearInterval(interval);
    });

    function handleCancel() {
        if (confirm("Abort this process?")) {
            cancelProcess(processId);
        }
    }
</script>

{#if process}
<div class="win95-loader-row">
    <div class="win95-loader">
        <div class="loader-header">
            <div class="loader-label">> {currentStatus}</div>
            <div class="loader-time">{timeDisplay}</div>
        </div>
        <div class="progress-container bevel-down">
            <!-- Uses a repeating gradient background instead of divs for perfect scaling -->
            <div class="progress-bar-fill" style="width: {progress}%"></div>
        </div>
    </div>

    <button class="cancel-btn" onclick={handleCancel} title="Abort Process">
        X
    </button>
</div>
{/if}

<style>
    .win95-loader-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
    }

    .win95-loader { padding: 15px 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
    
    .cancel-btn {
        width: 24px;
        height: 24px;
        background: #ff0000;
        color: white;
        font-weight: bold;
        border: 2px outset #ffaaaa;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Pixelated MS Sans Serif', 'Tahoma', sans-serif;
        font-size: 12px;
        margin-top: 6px; /* Align roughly with bar */
    }
    .cancel-btn:active { border-style: inset; }

    .loader-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
    }

    .loader-label { 
        font-family: 'Courier New', monospace;
        font-weight: 900; /* CHUNKY */
        font-size: 11px; 
        color: var(--cj-text); 
        text-transform: uppercase; 
        margin-left: 2px; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis;
        flex: 1;
        animation: blink-text 2s infinite;
    }
    
    @keyframes blink-text {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }

    .loader-time {
        font-family: 'Courier New', monospace;
        font-size: 11px;
        color: var(--cj-dim);
        font-weight: 900; /* CHUNKY */
        margin-right: 2px;
        white-space: nowrap;
    }
    
    .progress-container { 
        height: 24px;
        padding: 3px; 
        box-sizing: border-box; 
        background: var(--cj-light); 
        border-top: 2px solid var(--cj-dim); 
        border-left: 2px solid var(--cj-dim); 
        border-right: 2px solid var(--cj-light);
        border-bottom: 2px solid var(--cj-light);
        position: relative; 
        overflow: hidden;
    }

    .progress-bar-fill {
        height: 100%;
        background-color: var(--cj-accent);
        /* Creates the blocky effect using a repeating linear gradient */
        background-image: repeating-linear-gradient(
            90deg,
            var(--cj-accent),
            var(--cj-accent) 12px,
            var(--cj-light) 12px,
            var(--cj-light) 14px
        );
        transition: width 0.1s linear;
    }
</style>
