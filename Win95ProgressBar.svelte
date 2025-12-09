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
    // let label = $derived(process?.label || "PROCESSING..."); // Unused
    let estimatedDuration = $derived(process?.estimatedDuration || 5000);
    let realProgress = $derived(process?.progress);

    onMount(() => {
        if (!process) return;

        const fps = 30;
        const intervalTime = 1000 / fps;
        // Re-calculate steps based on when it started
        const elapsed = Date.now() - process.startTime;

        const totalSteps = estimatedDuration / intervalTime;
        let currentStep = elapsed / intervalTime;

        // Force initial update
        if (realProgress !== undefined) {
             progress = realProgress;
        }

        interval = setInterval(() => {
            currentStep++;
            
            // If we have real progress from the backend, use it
            if (realProgress !== undefined && realProgress > 0) {
                 // Smoothly interpolate if needed, but for now just snap or move towards it
                 // Let's just set it for accuracy as requested
                 progress = realProgress;
            } else {
                // Fallback: Asymptotic approach to 95%
                const t = currentStep / totalSteps;
                const targetProgress = 95 * (1 - Math.exp(-3 * t));
                if (targetProgress > progress) {
                    progress = targetProgress;
                }
            }

            if (progress > 100) progress = 100;

            // Time display
            // If we have real progress, maybe we can estimate remaining time?
            // For now, keep the fake countdown or switch to percentage
            const remaining = Math.max(0, Math.ceil((estimatedDuration - (currentStep * intervalTime)) / 1000));

            if (progress >= 100) {
                 timeDisplay = "DONE";
            } else {
                 // The user requested "percentage completeness"
                 timeDisplay = `${Math.round(progress)}%`;
            }

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
            <!-- Small text above describing the step (currentStatus) -->
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
        /* Removed blinking animation to make it easier to read as "small text" */
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
        transition: width 0.3s cubic-bezier(0.25, 1, 0.5, 1); /* Smooth transition */
    }
</style>
