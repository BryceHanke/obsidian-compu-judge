<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { statusMessage } from './store';
    
    interface Props {
        label?: string;
        estimatedDuration?: number; 
    }
    
    let { label = "INITIALIZING...", estimatedDuration = 5000 }: Props = $props();
    
    let progress = $state(0);
    let interval: NodeJS.Timeout;
    let timeDisplay = $state("");
    let currentStatus = $state(label);
    
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

    $effect(() => {
        if ($statusMessage && $statusMessage !== "READY") {
            currentStatus = $statusMessage;
        } else {
            currentStatus = label;
        }
    });

    onMount(() => {
        const fps = 30;
        const intervalTime = 1000 / fps;
        const totalSteps = estimatedDuration / intervalTime;
        let currentStep = 0;
        let lastThoughtSwitch = 0;

        const seconds = Math.ceil(estimatedDuration / 1000);
        timeDisplay = `EST: ~${seconds}s`;

        interval = setInterval(() => {
            currentStep++;
            const t = currentStep / totalSteps;
            const targetProgress = 95 * (1 - Math.exp(-3 * t)); 
            
            if (targetProgress > progress) {
                 progress = targetProgress;
            }
            if (progress > 99) progress = 99;

            const remaining = Math.max(0, Math.ceil((estimatedDuration - (currentStep * intervalTime)) / 1000));
            timeDisplay = remaining > 0 ? `EST: ~${remaining}s` : `FINALIZING...`;

            if ($statusMessage === "PROCESSING..." || $statusMessage === label) {
                lastThoughtSwitch += intervalTime;
                if (lastThoughtSwitch > 2000) {
                    lastThoughtSwitch = 0;
                    currentStatus = thoughts[Math.floor(Math.random() * thoughts.length)];
                }
            }

        }, intervalTime);

        return () => clearInterval(interval);
    });

    onDestroy(() => {
        if (interval) clearInterval(interval);
    });
</script>

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

<style>
    .win95-loader { padding: 15px 0; width: 100%; display: flex; flex-direction: column; gap: 6px; }
    
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