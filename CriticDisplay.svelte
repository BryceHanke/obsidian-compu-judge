<script lang="ts">
    import { slide } from 'svelte/transition';
    import type { NigsResponse, NigsMetaResponse, NigsSettings, UniversalOutlineNode } from './types';
    import { getContrastColor, getGradientColor } from './utils'; // [UPDATED] Import gradient util
    import { IDEAL_ARCS } from './Glossary';

    interface Props {
        data: NigsResponse;
        meta: NigsMetaResponse | null;
        isProcessing: boolean;
        settings: NigsSettings;
        onRunMeta: () => void;
        onAddRepairInstruction: (instruction: string) => void;
    }

    let { data, meta, isProcessing, settings, onRunMeta, onAddRepairInstruction }: Props = $props();
    let showRaw = $state(false);

    // [WIN95 UPDATE] Selected Agent Logic (Now handled per window or summary if needed)
    let selectedAgent = $state<string | null>(null);
    let openDropdown = $state<string | null>(null);
    let expandedBeats = $state<number[]>([]);

    // [UPDATED] Graph Toggle
    let graphMode = $state<'tension' | 'quality'>('tension');
    let selectedArc = $state("truby");

    // --- UTILS ---
    
    // [UPDATED] Universal Gradient Map Logic
    function getBarColor(val: number): string {
        // Legacy override for Masterpiece special effect handling is done in template class logic
        // But base color is now calculated from gradient map
        // Min: -60, Max: 60 (Adjusted for new scale)
        return getGradientColor(val, -60, 60, settings.gradientMap);
    }

    // [UPDATED] Universal Masterpiece Check: Threshold > 50
    function isMasterpieceEffect(val: number): boolean { 
        return val > 50 && !settings.disableRainbows;
    }

    // New Logic: Critical Failure is significantly negative (<= -60)
    function isCritical(val: number): boolean {
        return val <= -60; // Threshold for Cracked Effect
    }
    
    // Diverging Bar Logic (0 Center)
    // Returns a width percentage (0-50%) and a direction ('left' or 'right')
    function getBarMetrics(val: number) {
        // Cap visual representation at +/- 60 for readability, though score is uncapped
        const cap = 60;
        const clamped = Math.max(-cap, Math.min(cap, val));
        const width = Math.abs(clamped) / cap * 50; // Max width is 50% (half the bar)
        const isNegative = val < 0;
        return { width, isNegative };
    }

    // Slider Bar Logic (0-100)
    function getSliderMetrics(val: number) {
        const clamped = Math.max(0, Math.min(100, val));
        return clamped; // 0-100
    }

    // Force score to be positive (0 floor)
    function getPositiveScore(val: number): number {
        return Math.max(0, val);
    }

    function formatScoreDisplay(val: number): string {
        if (typeof val !== 'number') return "0";
        // Force signed display (+5, -10, 0)
        return (val > 0 ? "+" : "") + val.toFixed(0);
    }
    
    function formatUnsignedScore(val: number): string {
        if (typeof val !== 'number') return "0";
        return val.toFixed(0);
    }

    function getVerdict(val: number): string {
        if (val >= 55) return "GODLY";
        if (val > 50) return "MASTERPIECE";
        if (val >= 40) return "CLASSIC";
        if (val >= 25) return "GOOD";
        if (val > -25) return "AVERAGE";
        if (val > -40) return "FLAWED";
        if (val > -50) return "BAD";
        if (val > -60) return "FAILURE";
        return "CRITICAL FAILURE"; // <= -60
    }

    // --- DATA PROCESSING ---
    let structure = $derived(data.structure_map || []);
    let isUniversalOutline = $derived(structure.length > 0 && typeof structure[0] !== 'string');
    
    let warning = $derived(data.content_warning || "No specific warnings detected.");
    let details = $derived(data.detailed_metrics || {});
    let hasDetails = $derived(Object.keys(details).length > 0);
    let sanderson = $derived(data.sanderson_metrics || { promise_payoff: 0, laws_of_magic: 0, character_agency: 0 });

    let breakdown = $derived(data.tribunal_breakdown || {
        market: { commercial_score: 0, commercial_reason: "N/A" },
        logic: { score: 0, inconsistencies: [] },
        soul: { score: 0, critique: "N/A" },
        lit: { score: 0, niche_reason: "N/A" },
        jester: { score_modifier: 0, roast: "N/A" }
    });

    let averageScore = $derived.by(() => {
        // [UPDATED]: Use Chief Justice Ruling (Arbitration Log) if available
        if (data.arbitration_log && typeof data.arbitration_log.final_verdict === 'number') {
            return data.arbitration_log.final_verdict;
        }

        // Fallback: Calculate weighted score from breakdown
        if (!data.tribunal_breakdown) return data.commercial_score || 0;

        const w = settings.agentWeights || { logic: 1, soul: 1, market: 1, lit: 1, jester: 1 };
        const b = data.tribunal_breakdown;

        // Extract scores (default to 0)
        const sMarket = b.market?.commercial_score || 0;
        const sLogic = b.logic?.score || 0;
        const sSoul = b.soul?.score || 0;
        const sLit = b.lit?.score || 0;
        const sJester = b.jester?.score_modifier || 0;

        // Calculate weighted sum
        // Note: We are respecting the user's logic "if Soul scores +50, but it's weight is 0.5, it will only contribute 25 points"
        // This means it is strictly additive.
        let total = 0;
        total += sMarket * (w.market ?? 1);
        total += sLogic * (w.logic ?? 1);
        total += sSoul * (w.soul ?? 1);
        total += sLit * (w.lit ?? 1);
        total += sJester * (w.jester ?? 1);

        // [FIX]: Divide by Total Weight to get average (User reported inflated scores)
        let totalWeight = (w.market ?? 1) + (w.logic ?? 1) + (w.soul ?? 1) + (w.lit ?? 1) + (w.jester ?? 1);
        return totalWeight > 0 ? Math.round(total / totalWeight) : 0;
    });

    // Ideal Arc Logic
    let chartData = $derived.by(() => {
        // [UPDATED] Handle both Tension and Quality modes

        let sourceArray: number[] = [];
        let labels: string[] = [];
        let descs: string[] = [];
        let durations: number[] = [];

        // Prefer Quality Arc if mode is Quality and data exists
        if (graphMode === 'quality' && data.quality_arc && data.quality_arc.length > 0) {
            sourceArray = data.quality_arc;
            // Quality might not have distinct labels if separate from structure map
        } else if (graphMode === 'tension') {
             // Use Universal Outline tension if available, else tension_arc
             if (isUniversalOutline) {
                 sourceArray = (structure as UniversalOutlineNode[]).map(n => n.tension);
             } else {
                 sourceArray = data.tension_arc || [0, 10, 5, 20, 15, 30];
             }
        } else {
             // Fallback
             sourceArray = (data.tension_arc || []).map(() => 0);
        }

        // Generate Labels/Descs/Durations
        if (isUniversalOutline) {
            const nodes = structure as UniversalOutlineNode[];
            labels = nodes.map(n => n.title);
            descs = nodes.map(n => n.description || "");
            durations = nodes.map(n => n.duration || 1); // Default duration 1
        } else {
             const len = sourceArray.length;
             labels = sourceArray.map((_, i) => `Beat ${i+1}`);
             descs = sourceArray.map(() => "Legacy Data");
             durations = sourceArray.map(() => 1);
        }
        
        // If Quality Mode but no labels, try to map from structure or generate generic
        if (graphMode === 'quality' && labels.length !== sourceArray.length) {
             labels = sourceArray.map((_, i) => `Beat ${i+1}`);
             descs = sourceArray.map(() => "");
             durations = sourceArray.map(() => 1);
        }

        const totalDuration = durations.reduce((a, b) => a + b, 0);

        return sourceArray.map((val, i) => ({
            val: val,
            title: labels[i] || `Beat ${i+1}`,
            desc: descs[i] || "",
            widthPerc: (durations[i] / totalDuration) * 100
        }));
    });

    // Interpolate Ideal Path (Only for Tension Mode)
    let idealPathD = $derived.by(() => {
        if (graphMode !== 'tension') return "";
        if (!chartData || chartData.length === 0) return "";
        
        const idealPoints = IDEAL_ARCS[selectedArc].points;
        const numBeats = chartData.length;
        
        let path = "";
        let currentX = 0;

        chartData.forEach((beat, i) => {
            const centerX = currentX + (beat.widthPerc / 2);
            const progress = i / (numBeats - 1 || 1); 
            const idealIndex = progress * (idealPoints.length - 1);
            const lowerIdx = Math.floor(idealIndex);
            const upperIdx = Math.ceil(idealIndex);
            const weight = idealIndex - lowerIdx;
            
            const val1 = idealPoints[lowerIdx];
            const val2 = idealPoints[upperIdx];
            const idealVal = val1 + (val2 - val1) * weight;
            
            // Map Ideal Value to Y (Center 50)
            const yPos = 50 - (idealVal / 2); 

            if (i === 0) path += `M ${centerX} ${yPos}`;
            else path += ` L ${centerX} ${yPos}`;
            
            currentX += beat.widthPerc;
        });

        return path;
    });

    // Helper to get logic inconsistencies safely
    let logicIssues = $derived(breakdown.logic.inconsistencies || []);
</script>

<div class="critic-display">
    
    <!-- [WIN95 UPDATE] DEEP SCAN POPUP (Overall Score) -->
    <div class="win95-popup-window deep-scan-popup">
        <div class="win95-titlebar">
            <div class="win95-titlebar-text">
                <span>🔎</span> <span>Deep Scan Analysis</span>
            </div>
            <div class="win95-controls">
                <button class="win95-close-btn">X</button>
            </div>
        </div>
        
        <div class="win95-menubar" style="position: relative;">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="win95-menu-item" onclick={(e) => { e.stopPropagation(); openDropdown = openDropdown === 'smart-repairs' ? null : 'smart-repairs'; }}>
                Smart Repair...
            </span>

            {#if openDropdown === 'smart-repairs'}
                <div class="dropdown-list">
                    {#if warning && warning !== 'None'}
                         <div class="dd-item" onclick={() => { onAddRepairInstruction(`Address Warning: ${warning}`); openDropdown = null; }}>
                            Fix Warning: {warning.substring(0, 20)}...
                        </div>
                    {/if}

                    <!-- TAILORED REPAIRS (AGENT SPECIFIC) -->
                    <!-- Logic: Top Issue -->
                    {#if logicIssues.length > 0}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Logic: ${logicIssues[0]}`); openDropdown = null; }}>
                            Logic Fix: {logicIssues[0].substring(0, 30)}...
                        </div>
                    {:else}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Logic Fix: Address Plot Holes & Inconsistencies`); openDropdown = null; }}>
                            Logic Repair (General)
                        </div>
                    {/if}

                    <!-- Market: Reason -->
                    {#if breakdown.market.commercial_reason && breakdown.market.commercial_reason !== 'N/A'}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Market Fix: ${breakdown.market.commercial_reason}`); openDropdown = null; }}>
                            Market Fix: {breakdown.market.commercial_reason.substring(0, 30)}...
                        </div>
                    {:else}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Market Fix: Improve Hooks & Commercial Appeal`); openDropdown = null; }}>
                            Market Repair (General)
                        </div>
                    {/if}

                    <!-- Soul: Critique -->
                    {#if breakdown.soul.critique && breakdown.soul.critique !== 'N/A'}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Soul Fix: ${breakdown.soul.critique}`); openDropdown = null; }}>
                            Soul Fix: {breakdown.soul.critique.substring(0, 30)}...
                        </div>
                    {:else}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Soul Fix: Deepen Emotion & Theme`); openDropdown = null; }}>
                            Soul Repair (General)
                        </div>
                    {/if}

                    <!-- Lit: Reason -->
                    {#if breakdown.lit?.niche_reason && breakdown.lit.niche_reason !== 'N/A'}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Lit Fix: ${breakdown.lit.niche_reason}`); openDropdown = null; }}>
                            Lit Fix: {breakdown.lit.niche_reason.substring(0, 30)}...
                        </div>
                    {:else}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Lit Fix: Elevate Prose & Style`); openDropdown = null; }}>
                            Lit Repair (General)
                        </div>
                    {/if}

                    <!-- Jester: Roast -->
                    {#if breakdown.jester?.roast && breakdown.jester.roast !== 'N/A'}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Jester Fix: Address '${breakdown.jester.roast}'`); openDropdown = null; }}>
                            Jester Fix: Address Critique
                        </div>
                    {:else}
                        <div class="dd-item" onclick={() => { onAddRepairInstruction(`Jester Fix: Sharpen Wit & Irony`); openDropdown = null; }}>
                            Jester Repair (General)
                        </div>
                    {/if}

                    <div style="border-top:1px dashed #000; margin:2px 0;"></div>

                    <!-- SANDERSON METRICS -->
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Promise/Payoff: Address Broken Promises (Sanderson Law)`); openDropdown = null; }}>
                        Sanderson Repair: Promise/Payoff
                    </div>
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Magic System: Clarify Rules & Limitations`); openDropdown = null; }}>
                        Sanderson Repair: Magic & Rules
                    </div>
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Character Agency: Force Proactivity`); openDropdown = null; }}>
                        Sanderson Repair: Agency Check
                    </div>

                    <div style="border-top:1px dashed #000; margin:2px 0;"></div>

                    <!-- DETAILED METRICS (Dynamic) -->
                    {#if hasDetails}
                         {#if details.premise && details.premise.score < 50}
                            <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Premise: Sharpen the Hook & Irony`); openDropdown = null; }}>
                                Premise Repair
                            </div>
                         {/if}
                         {#if details.structure && details.structure.score < 50}
                            <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Structure: Address Pacing & Turns`); openDropdown = null; }}>
                                Structure Repair
                            </div>
                         {/if}
                         {#if details.character && details.character.score < 50}
                            <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Character: Deepen Arc & Voice`); openDropdown = null; }}>
                                Character Repair
                            </div>
                         {/if}
                         {#if details.theme && details.theme.score < 50}
                            <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Theme: Clarify the Argument`); openDropdown = null; }}>
                                Theme Repair
                            </div>
                         {/if}
                         {#if details.world && details.world.score < 50}
                            <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Worldbuilding: Consistency Check`); openDropdown = null; }}>
                                World Repair
                            </div>
                         {/if}
                    {/if}

                    <!-- GENERAL FALLBACKS -->
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Pacing: Cut Fluff & Accelerate`); openDropdown = null; }}>
                        General: Fix Pacing
                    </div>
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Fix Dialogue: Sharpen Subtext & Voice`); openDropdown = null; }}>
                        General: Fix Dialogue
                    </div>
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Enhance Description: Show Don't Tell`); openDropdown = null; }}>
                        General: Fix Description
                    </div>
                </div>
            {/if}
        </div>

        <div class="main-score-row" style="padding: 20px; background: #c0c0c0;">
            <div class="score-block main tooltip-container">
                <div class="score-title" style="color: #000080;">OVERALL RATING</div>
                <!-- Main score display: FIXED Masterpiece Shadow Logic -->
                <!-- Inline style for shadow only applies if NOT masterpiece, otherwise CSS class handles it -->
                <div class="score-main {isMasterpieceEffect(averageScore) ? 'masterpiece-text' : ''} 
                            {isCritical(averageScore) ? 'critical-text' : ''}" 
                     style="color: {isMasterpieceEffect(averageScore) ? '#000' : (isCritical(averageScore) ? '#000' : getBarColor(averageScore))};
                            text-shadow: {isMasterpieceEffect(averageScore) ? '' : '1px 1px 0 #fff'};">
                    {formatScoreDisplay(averageScore)}
                </div>
                <!-- Verdict Text -->
                <div class="score-verdict {isMasterpieceEffect(averageScore) ? 'masterpiece-text' : ''}"
                     style="color: {isMasterpieceEffect(averageScore) ? '#000' : '#000'};">
                    {getVerdict(averageScore)}
                </div>
                <div class="tooltip bottom" style="width: 200px;">
                    {data.commercial_reason || "No summary available."}
                </div>
            </div>
        </div>

        <div class="score-divider-horizontal"></div>

        <!-- 5 AGENT BREAKDOWN ROW -->
        <div class="sub-score-row">
            <!-- MARKET -->
            <div class="sub-score-block tooltip-container">
                <div class="sub-title">MARKET</div>
                <div class="sub-val {isMasterpieceEffect(breakdown.market.commercial_score || 0) ? 'masterpiece-text' : ''}"
                     style="color: {isMasterpieceEffect(breakdown.market.commercial_score || 0) ? '#000' : getBarColor(breakdown.market.commercial_score || 0)}">
                    {formatScoreDisplay(breakdown.market.commercial_score || 0)}
                </div>
                <div class="tooltip bottom">{breakdown.market.commercial_reason || "No Data"}</div>
            </div>
            <div class="sub-divider"></div>
            
            <!-- LOGIC -->
            <div class="sub-score-block tooltip-container">
                <div class="sub-title">LOGIC</div>
                <div class="sub-val {isMasterpieceEffect(breakdown.logic.score || 0) ? 'masterpiece-text' : ''}"
                     style="color: {isMasterpieceEffect(breakdown.logic.score || 0) ? '#000' : getBarColor(breakdown.logic.score || 0)}">
                    {formatScoreDisplay(breakdown.logic.score || 0)}
                </div>
                <div class="tooltip bottom" style="width: 180px; text-align: left;">
                    {#if breakdown.logic.inconsistencies && breakdown.logic.inconsistencies.length > 0}
                        <ul style="padding-left: 10px; margin: 0;">
                            {#each breakdown.logic.inconsistencies as item}
                                <li>{item}</li>
                            {/each}
                        </ul>
                    {:else}
                         No inconsistencies found.
                    {/if}
                </div>
            </div>
            <div class="sub-divider"></div>

            <!-- SOUL -->
            <div class="sub-score-block tooltip-container">
                <div class="sub-title">SOUL</div>
                <div class="sub-val {isMasterpieceEffect(breakdown.soul.score || 0) ? 'masterpiece-text' : ''}"
                     style="color: {isMasterpieceEffect(breakdown.soul.score || 0) ? '#000' : getBarColor(breakdown.soul.score || 0)}">
                    {formatScoreDisplay(breakdown.soul.score || 0)}
                </div>
                <div class="tooltip bottom">{breakdown.soul.critique || "No Data"}</div>
            </div>
            <div class="sub-divider"></div>

            <!-- LIT -->
            <div class="sub-score-block tooltip-container">
                <div class="sub-title">LIT</div>
                <div class="sub-val {isMasterpieceEffect(breakdown.lit?.score || 0) ? 'masterpiece-text' : ''}"
                     style="color: {isMasterpieceEffect(breakdown.lit?.score || 0) ? '#000' : getBarColor(breakdown.lit?.score || 0)}">
                    {formatScoreDisplay(breakdown.lit?.score || 0)}
                </div>
                <div class="tooltip bottom">{breakdown.lit?.niche_reason || "No Data"}</div>
            </div>
            <div class="sub-divider"></div>

             <!-- JESTER -->
             <div class="sub-score-block tooltip-container">
                <div class="sub-title">JESTER</div>
                <div class="sub-val {isMasterpieceEffect(breakdown.jester?.score_modifier || 0) ? 'masterpiece-text' : ''}"
                     style="color: {isMasterpieceEffect(breakdown.jester?.score_modifier || 0) ? '#000' : getBarColor(breakdown.jester?.score_modifier || 0)}">
                    {formatScoreDisplay(breakdown.jester?.score_modifier || 0)}
                </div>
                <div class="tooltip bottom">{breakdown.jester?.roast || "No Data"}</div>
            </div>
        </div>

        {#if warning && warning.length > 5 && warning !== 'None'}
        <div class="warning-box warning-stripe" style="margin: 10px;">
            <span class="warning-icon">⚠</span>
            <span class="warning-text">{warning}</span>
        </div>
        {/if}

        <div class="win95-statusbar">
             <div class="win95-status-field">Status: Analysis Complete</div>
             <div class="win95-status-field">Agents: 5 Active</div>
        </div>
    </div>

    <!-- [WIN95 UPDATE] STORY GRAPH POPUP -->
    <div class="win95-popup-window">
        <div class="win95-titlebar">
            <div class="win95-titlebar-text">
                <span>📈</span> <span>Story Graph Visualizer</span>
            </div>
             <div class="win95-controls">
                <button class="win95-close-btn">X</button>
            </div>
        </div>

        <div class="win95-menubar" style="display:flex; justify-content:space-between; align-items:center;">
             <div style="display:flex; gap:10px;">
                 <span class="win95-menu-item">View</span>
                 <!-- Mode Toggle -->
                 <select class="retro-select mini" bind:value={graphMode}>
                    <option value="tension">Narrative Tension</option>
                    <option value="quality">Beat Quality</option>
                </select>
             </div>

             {#if graphMode === 'tension'}
                <select class="retro-select mini" bind:value={selectedArc} style="width:120px;">
                    {#each Object.entries(IDEAL_ARCS) as [key, arc]}
                        <option value={key}>{arc.label}</option>
                    {/each}
                </select>
            {/if}
        </div>

        <div class="chart-box bevel-down" style="margin: 5px; background: #fff;">
            <div class="chart-area zero-center" style="display: flex; width: 100%;">

                <div class="chart-center-line"></div>

                {#if graphMode === 'tension'}
                <!-- SVG OVERLAY FOR IDEAL PATH (Only for Tension) -->
                <svg class="chart-overlay" preserveAspectRatio="none" viewBox="0 0 100 100">
                    <path d={idealPathD} fill="none" stroke="#000080" stroke-width="0.5" stroke-dasharray="2,1" opacity="0.6" />
                </svg>
                {/if}

                {#each chartData as beat, i}
                    {@const bar = getBarMetrics(beat.val)}

                    <div class="bar-col tooltip-container" style="width: {beat.widthPerc}%; flex-grow: 0; flex-shrink: 0;">

                        <div class="win95-progress-container {isCritical(beat.val) ? 'critical-bar' : ''}"
                             style="
                                width: 100%; height: 100%;
                                background: transparent; box-shadow: none; border: none;
                                position: relative;
                             ">
                            <!-- Signed Bar (Used for both Tension and Quality now) -->
                            <div class="win95-progress-fill"
                                 style="
                                    width: auto;
                                    left: 1px; right: 1px;
                                    top: {bar.isNegative ? '50%' : 'auto'};
                                    bottom: {bar.isNegative ? 'auto' : '50%'};
                                    height: {bar.width}%;
                                    position: absolute;
                                    background: {isMasterpieceEffect(beat.val) ? '#000' : getBarColor(beat.val)};
                                    background-size: 200% auto;
                                    animation: none;
                                    border: {isMasterpieceEffect(beat.val) ? 'none' : '1px solid rgba(0,0,0,0.5)'};
                                    box-shadow: {isMasterpieceEffect(beat.val) ? 'none' : '1px 1px 0 rgba(0,0,0,0.2)'};
                                 ">
                                 {#if isMasterpieceEffect(beat.val)}
                                    <div style="position:absolute; inset: -2px; border: 2px solid transparent; border-image: linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet) 1; animation: rainbow-border 2s linear infinite;"></div>
                                 {/if}
                            </div>
                        </div>

                        <div class="tooltip chart-tooltip">
                            <strong>{i+1}. {beat.title}</strong><br/>
                            {graphMode === 'tension' ? 'Tension' : 'Quality'}: {formatScoreDisplay(beat.val)}<br/>
                            <span style="font-size:0.8em; opacity:0.8">Duration: {Math.round(beat.widthPerc)}%</span>
                        </div>
                    </div>
                {/each}
            </div>
            <div class="chart-axis">
                <span>START</span>
                {#if graphMode === 'tension'}
                <div style="display:flex; align-items:center; gap:5px;">
                    <span class="legend-box" style="border:1px dashed #000080;"></span>
                    <span style="font-size:9px; color:#000080;">IDEAL ({IDEAL_ARCS[selectedArc].label})</span>
                </div>
                {/if}
                <span>END</span>
            </div>
        </div>
    </div>

    <!-- METRICS (SANDERSON) -->
    <div class="win95-popup-window">
        <div class="win95-titlebar">
            <div class="win95-titlebar-text">
                <span>⚡</span> <span>Sanderson Engine Metrics</span>
            </div>
        </div>
        <div class="modules-grid bevel-down" style="padding: 10px; background: #c0c0c0;">
            <!-- CORE LAWS -->
            {#each [
                { label: 'PROMISE/PAYOFF', val: getPositiveScore(sanderson.promise_payoff) },
                { label: 'LAWS OF MAGIC', val: getPositiveScore(sanderson.laws_of_magic) },
                { label: 'AGENCY', val: getPositiveScore(sanderson.character_agency) }
            ] as m}
                <!-- Bottom out at 0 logic is applied in getPositiveScore -->
                {@const bar = getBarMetrics(m.val)}
                <!-- Note: getBarMetrics centers at 0, but since we floor at 0, it will just be positive bars -->

                <div class="module-item" style="display:flex; align-items:center; gap:10px; margin-bottom: 5px;">
                    <span class="mod-label" style="width: 100px; font-weight: bold; font-size: 10px;">{m.label}</span>
                    <div class="win95-progress-container {isCritical(m.val) ? 'critical-bar' : ''}" style="flex: 1;">
                        <div class="win95-progress-fill"
                             style="
                                width: {Math.min(100, (m.val / 50) * 100)}%;
                                background: {isMasterpieceEffect(m.val) ? '#000' : getBarColor(m.val)};
                                position: relative;
                             ">
                             {#if isMasterpieceEffect(m.val)}
                                <div style="position:absolute; inset: 0; border: 2px solid transparent; border-image: linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet) 1; animation: rainbow-border 2s linear infinite;"></div>
                             {/if}
                        </div>
                    </div>
                    <span class="mod-score {isMasterpieceEffect(m.val) ? 'masterpiece-text' : ''}"
                          style="color: {isMasterpieceEffect(m.val) ? '#000' : getBarColor(m.val)}; width: 30px; text-align: right; font-weight: bold;">
                        {formatScoreDisplay(m.val)}
                    </span>
                </div>
            {/each}
        </div>
    </div>

    <!-- UNIVERSAL OUTLINE (Tree View Style) -->
    <div class="win95-popup-window">
        <div class="win95-titlebar">
            <div class="win95-titlebar-text">
                <span>📁</span> <span>Universal Outline</span>
            </div>
        </div>
        <div class="structure-box bevel-down" style="background:#fff; height: 200px; overflow-y:auto; border: 2px inset #808080;">
             {#if isUniversalOutline}
                <ul class="tree-view">
                    {#each structure as node, i}
                        <li class="tree-item-container">
                             <!-- svelte-ignore a11y-click-events-have-key-events -->
                             <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <div class="tree-item" onclick={() => {
                                if (expandedBeats.includes(i)) expandedBeats = expandedBeats.filter(idx => idx !== i);
                                else expandedBeats = [...expandedBeats, i];
                            }} style="cursor: pointer;">
                                <span class="tree-line"></span>
                                <div class="tree-content">
                                    <span class="node-icon">{expandedBeats.includes(i) ? '📂' : (node.type === 'beat' ? '📄' : '⭐')}</span>
                                    <span class="node-title">{node.title}</span>
                                    <span class="node-meta {isMasterpieceEffect(node.tension) ? 'masterpiece-text' : ''}"
                                          style="color: {isMasterpieceEffect(node.tension) ? '#000' : '#000080'};">
                                        (Tens: {formatScoreDisplay(node.tension)})
                                    </span>
                                </div>
                            </div>

                            {#if expandedBeats.includes(i)}
                                <div class="node-summary" transition:slide>
                                    <div class="summary-text">{node.description}</div>
                                    {#if node.characters && node.characters.length > 0}
                                        <div class="summary-chars">Cast: {node.characters.join(', ')}</div>
                                    {/if}
                                </div>
                            {/if}
                        </li>
                    {/each}
                </ul>
                {#if structure.length === 0}
                    <div style="padding:10px; color:#555; font-style:italic;">[BUFFER EMPTY]</div>
                {/if}
            {:else}
                 <!-- Legacy -->
                {#each structure as beat}
                    <div class="structure-item">
                        <div class="square-bullet">■</div>
                        <div class="beat-text">{beat}</div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>


    <button class="action-btn secondary" onclick={onRunMeta} disabled={isProcessing}>
        RUN DEEP META-ANALYSIS
    </button>
</div>

<style>
    .critic-display { display: flex; flex-direction: column; gap: 15px; font-family: 'Pixelated MS Sans Serif', 'Tahoma', 'Segoe UI', sans-serif; color: #000; font-weight: normal; }
    
    /* SCORES */
    .score-container { 
        background: #c0c0c0;
        padding-bottom: 5px;
        position: relative; 
    }
    
    .main-score-row { display: flex; justify-content: center; padding: 10px 0; background: #c0c0c0; border: 2px inset #fff; }
    .score-block.main { display: flex; flex-direction: column; align-items: center; }
    .score-title { font-size: 11px; color: #000080; font-weight: bold; margin-bottom: 5px; text-transform: uppercase; }
    .score-main { font-size: 48px; font-weight: 900; line-height: 0.9; text-shadow: 1px 1px 0 #fff; }
    .score-verdict { font-size: 14px; font-weight: 900; margin-top: 5px; letter-spacing: 1px; color: #000; }

    .score-divider-horizontal { height: 2px; border-top: 1px solid #808080; border-bottom: 1px solid #fff; width: 90%; margin: 5px auto; }

    .sub-score-row {
        display: flex; 
        justify-content: space-around; 
        align-items: center; 
        padding: 5px;
        background: #c0c0c0;
    }
    
    .sub-score-block { text-align: center; flex: 1; position: relative; cursor: help; }
    .sub-title { font-size: 9px; font-weight: bold; color: #000; margin-bottom: 2px; }
    .sub-val { font-size: 14px; font-weight: 900; text-shadow: 1px 1px 0 #fff; }
    .sub-divider { width: 2px; height: 20px; border-left: 1px solid #808080; border-right: 1px solid #fff; }

    /* TOOLTIPS */
    .tooltip-container { position: relative; overflow: visible; }
    .tooltip { 
        visibility: hidden; opacity: 0;
        background-color: #FFFFE0; color: #000; 
        text-align: center; border: 1px solid #000;
        padding: 4px; position: absolute; z-index: 10000;
        font-size: 10px; width: 120px;
        box-shadow: 2px 2px 0px rgba(0,0,0,0.2);
        transition: opacity 0.1s; pointer-events: none;
    }
    .tooltip.bottom { top: 100%; left: 50%; transform: translateX(-50%); margin-top: 5px; }
    .tooltip-container:hover .tooltip { visibility: visible; opacity: 1; }

    /* MASTERPIECE TEXT EFFECT (Black with Rainbow Stroke/Shadow) */
    .masterpiece-text {
        color: #000 !important;
        text-shadow:
             2px  0px 0px #ff0000,
            -2px  0px 0px #00ffff,
             0px  2px 0px #00ff00,
             0px -2px 0px #ff00ff;
        animation: rainbow-shadow-pulse 0.5s infinite alternate;
        -webkit-text-stroke: 1px transparent;
        position: relative;
    }

    @keyframes rainbow-shadow-pulse {
        0% { text-shadow: 2px 0px 0 #ff0000, -2px 0px 0 #00ffff; }
        100% { text-shadow: 2px 0px 0 #ff00ff, -2px 0px 0 #ffff00; }
    }

    @keyframes rainbow-border {
        0% { border-image-source: linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet); }
        100% { border-image-source: linear-gradient(to right, violet, indigo, blue, green, yellow, orange, red); }
    }

    /* DROPDOWN MENU */
    .dropdown-list {
        position: absolute; top: 100%; left: 0;
        background: #c0c0c0; border: 2px outset #fff;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
        z-index: 9999; min-width: 150px; padding: 2px;
    }
    .dd-item { padding: 4px 8px; cursor: pointer; color: #000; }
    .dd-item:hover { background: #000080; color: #fff; }

    /* CHART AREA */
    .chart-box { padding: 10px; background: #fff; border: 2px inset #808080; position: relative; z-index: 50; }
    .chart-area { height: 100px; display: flex; align-items: stretch; gap: 1px; padding-bottom: 4px; border-bottom: 1px dotted #808080; position: relative; }
    .chart-center-line { position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #000; z-index: 0; border-top: 1px dotted #808080; }
    .chart-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: none; }
    .chart-axis { display: flex; justify-content: space-between; font-size: 9px; color: #555; margin-top: 2px; align-items: center; }

    /* TREE VIEW */
    .tree-view { list-style: none; padding-left: 5px; margin: 0; }
    .tree-item-container { display: flex; flex-direction: column; }
    .tree-item { display: flex; align-items: center; padding: 2px 0; }
    .tree-item:hover { background-color: #000080; color: #fff; }
    .tree-line { width: 10px; border-bottom: 1px dotted #808080; margin-right: 5px; }
    .tree-content { display: flex; align-items: center; gap: 5px; font-size: 11px; }
    .node-title { font-weight: bold; }
    .node-meta { font-size: 9px; }
    .node-summary { padding-left: 20px; font-size: 10px; color: #333; margin-bottom: 4px; border-left: 1px dotted #808080; margin-left: 5px; }
    .summary-text { font-style: italic; }
    .summary-chars { font-weight: bold; color: #000080; margin-top: 2px; }

    /* MISC */
    .section-header { display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 11px; color: #000080; margin-top: 10px; margin-bottom: 5px; }
    .section-header::after { content: ""; flex: 1; height: 2px; border-top: 1px solid #808080; border-bottom: 1px solid #fff; }
    .warning-box { background: #FFFF00; border: 1px solid #000; padding: 4px; font-size: 10px; font-weight: bold; display: flex; gap: 8px; align-items: center; }

    .retro-select.mini { padding: 0 15px 0 2px; height: 18px; font-size: 10px; }

    .toggle-btn { background: none; border: none; color: #000080; cursor: pointer; font-size: 10px; padding: 0; text-align: left; font-weight: bold; margin-top: 5px; }
    .raw-box { background: #000; color: #0f0; padding: 10px; overflow-x: auto; font-size: 11px; max-height: 200px; font-weight: bold; font-family: 'Courier New', monospace; border: 2px inset #808080; }
</style>
