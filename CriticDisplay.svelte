<script lang="ts">
    import { slide } from 'svelte/transition';
    import type { NigsResponse, NigsMetaResponse, NigsSettings, UniversalOutlineNode } from './types';
    import { getContrastColor } from './utils';
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

    // [UPDATED] Graph Toggle
    let graphMode = $state<'tension' | 'quality'>('tension');
    let selectedArc = $state("truby");

    // --- UTILS ---
    
    // Zero-Based Color Map
    function getBarColor(val: number): string {
        if (val >= 45) return settings.gradingColors.masterpiece; // Threshold 45 for Masterpiece
        if (val >= 30) return settings.gradingColors.excellent;
        if (val >= 10) return settings.gradingColors.good;
        if (val === 0) return settings.gradingColors.average;
        if (val >= -10) return settings.gradingColors.poor;
        return settings.gradingColors.critical;
    }

    // [UPDATED] Universal Masterpiece Check: Threshold 45
    function isMasterpieceEffect(val: number): boolean { 
        return val >= 45;
    }

    // New Logic: Critical Failure is significantly negative
    function isCritical(val: number): boolean {
        return val <= -20; // Threshold for Cracked Effect
    }
    
    // Helper to get the correct container class
    function getContainerClass(val: number): string {
        return 'score-container'; // Basic container, effects applied to text
    }

    // Diverging Bar Logic (0 Center)
    // Returns a width percentage (0-50%) and a direction ('left' or 'right')
    function getBarMetrics(val: number) {
        // Cap visual representation at +/- 50 for readability, though score is uncapped
        const cap = 50; 
        const clamped = Math.max(-cap, Math.min(cap, val));
        const width = Math.abs(clamped) / cap * 50; // Max width is 50% (half the bar)
        const isNegative = val < 0;
        return { width, isNegative };
    }

    // Quality Bar Logic (Signed 0-50 cap) for Graph
    function getQualityMetrics(val: number) {
        // Same as Tension basically, centered around 0
        return getBarMetrics(val);
    }

    // Slider Bar Logic (0-100)
    function getSliderMetrics(val: number) {
        const clamped = Math.max(0, Math.min(100, val));
        return clamped; // 0-100
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
        if (val >= 50) return "GOD TIER";
        if (val >= 30) return "MASTERPIECE";
        if (val >= 10) return "EXCELLENT";
        if (val > 0) return "GOOD";
        if (val === 0) return "COMPETENT";
        if (val >= -10) return "FLAWED";
        if (val >= -30) return "BROKEN";
        return "CRITICAL FAILURE";
    }

    // --- DATA PROCESSING ---
    let structure = $derived(data.structure_map || []);
    let isUniversalOutline = $derived(structure.length > 0 && typeof structure[0] !== 'string');
    
    let warning = $derived(data.content_warning || "No specific warnings detected.");
    let details = $derived(data.detailed_metrics || {});
    let hasDetails = $derived(Object.keys(details).length > 0);
    let sanderson = $derived(data.sanderson_metrics || { promise_payoff: 0, laws_of_magic: 0, character_agency: 0 });

    let averageScore = $derived.by(() => {
        const c = data.commercial_score || 0;
        const n = data.niche_score || 0;
        const co = data.cohesion_score || 0;
        // Simple Average of Signed Integers (or just use Commercial Score as the main verdict if Tribunal is active)
        return data.commercial_score || 0;
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

    let breakdown = $derived(data.tribunal_breakdown || {
        market: { commercial_score: 0, commercial_reason: "N/A" },
        logic: { score: 0, inconsistencies: [] },
        soul: { score: 0, critique: "N/A" },
        lit: { score: 0, niche_reason: "N/A" },
        jester: { score_modifier: 0, roast: "N/A" }
    });
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
        
        <div class="win95-menubar">
            <span class="win95-menu-item">File</span>
            <span class="win95-menu-item">Edit</span>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="win95-menu-item" onclick={(e) => { e.stopPropagation(); openDropdown = openDropdown === 'actions' ? null : 'actions'; }}>Actions</span>
            {#if openDropdown === 'actions'}
                <div class="dropdown-list">
                    <div class="dd-item" onclick={() => { onAddRepairInstruction(`Address Warning: ${warning}`); openDropdown = null; }}>Inject Critical Repair</div>
                </div>
            {/if}
        </div>

        <div class="main-score-row" style="padding: 20px; background: #c0c0c0;">
            <div class="score-block main">
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
                <div class="tooltip bottom">Plot Holes: {breakdown.logic.inconsistencies?.length || 0}</div>
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

                        <div class="win95-progress-container"
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
                                    background: {isMasterpieceEffect(beat.val) ? 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' : getBarColor(beat.val)};
                                    background-size: 200% auto;
                                    animation: {isMasterpieceEffect(beat.val) ? 'rainbow-bar-scroll 3s linear infinite' : 'none'};
                                    border: 1px solid rgba(0,0,0,0.5);
                                    box-shadow: 1px 1px 0 rgba(0,0,0,0.2);
                                 ">
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

    <!-- METRICS -->
    <div class="section-header">SANDERSON ENGINE METRICS</div>
    <div class="modules-grid bevel-down">
        {#if sanderson.competence !== undefined}
        <div class="slider-group">
            <div class="slider-label">PROTAGONIST SCALE</div>
            {#each [
                { label: 'COMPETENCE', val: sanderson.competence ?? 50 },
                { label: 'PROACTIVITY', val: sanderson.proactivity ?? 50 },
                { label: 'LIKABILITY', val: sanderson.likability ?? 50 }
            ] as s}
                <div class="slider-item">
                    <div class="slider-text-row">
                        <span class="s-label">{s.label}</span>
                        <span class="s-val">{formatUnsignedScore(s.val)}%</span>
                    </div>
                    <div class="win95-progress-container">
                         <div class="win95-progress-fill"
                              style="width: {getSliderMetrics(s.val)}%; background: {getBarColor(s.val)};">
                         </div>
                    </div>
                </div>
            {/each}
        </div>
        {/if}

        <div class="divider-line"></div>

        <!-- CORE LAWS -->
        {#each [
            { label: 'PROMISE/PAYOFF', val: sanderson.promise_payoff },
            { label: 'LAWS OF MAGIC', val: sanderson.laws_of_magic },
            { label: 'AGENCY', val: sanderson.character_agency }
        ] as m}
            {@const bar = getBarMetrics(m.val)}
            <div class="module-item">
                <span class="mod-label">{m.label}</span>
                <div class="win95-progress-container" style="flex: 1;">
                    <div class="center-line" style="position:absolute; left:50%; top:0; bottom:0; border-left:1px dashed #555; z-index:2;"></div>
                    <div class="win95-progress-fill"
                         style="
                            position: absolute;
                            width: {bar.width}%; 
                            left: {bar.isNegative ? (50 - bar.width) + '%' : '50%'};
                            background: {isMasterpieceEffect(m.val) ? 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' : getBarColor(m.val)};
                            background-size: 200% auto;
                            animation: {isMasterpieceEffect(m.val) ? 'rainbow-bar-scroll 3s linear infinite' : 'none'};
                         ">
                    </div>
                </div>
                <span class="mod-score {isMasterpieceEffect(m.val) ? 'masterpiece-text' : ''}" 
                      style="color: {isMasterpieceEffect(m.val) ? '#000' : getBarColor(m.val)}">
                    {formatScoreDisplay(m.val)}
                </span>
            </div>
        {/each}
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
                    {#each structure as node}
                        <li class="tree-item">
                            <span class="tree-line"></span>
                            <div class="tree-content">
                                <span class="node-icon">{node.type === 'beat' ? '📄' : '⭐'}</span>
                                <span class="node-title">{node.title}</span>
                                <span class="node-meta" style="color:#000080;">(Tens: {formatScoreDisplay(node.tension)})</span>
                            </div>
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

    {#if data.thought_process}
        <button class="toggle-btn" onclick={() => showRaw = !showRaw}>
             {showRaw ? '[-] HIDE RAW LOGIC' : '[+] SHOW TRUBY LOGIC'}
        </button>
        {#if showRaw}
            <div class="raw-box" transition:slide>
                <pre>{data.thought_process}</pre>
            </div>
        {/if}
    {/if}

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
            -1px -1px 0 #ff0000,
             1px -1px 0 #ffff00,
            -1px  1px 0 #0000ff,
             1px  1px 0 #00ff00;
        /* Note: Full rainbow stroke isn't standard CSS, using multi-shadow approximation or webkit stroke */
        -webkit-text-stroke: 1px transparent; /* Can't gradient stroke easily */
        position: relative;
    }

    /* Optional: An overlay for the stroke if needed, but text-shadow is safer for retro look */
    /* Using background clip on text for the stroke is tricky.
       Let's use a layered shadow to simulate the "Rainbow Outline" requested. */
    .masterpiece-text {
        text-shadow:
             2px  0px 0px #ff0000,
            -2px  0px 0px #00ffff,
             0px  2px 0px #00ff00,
             0px -2px 0px #ff00ff;
        animation: rainbow-shadow-pulse 0.5s infinite alternate;
    }

    @keyframes rainbow-shadow-pulse {
        0% { text-shadow: 2px 0px 0 #ff0000, -2px 0px 0 #00ffff; }
        100% { text-shadow: 2px 0px 0 #ff00ff, -2px 0px 0 #ffff00; }
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
    .tree-item { display: flex; align-items: center; padding: 2px 0; }
    .tree-line { width: 10px; border-bottom: 1px dotted #808080; margin-right: 5px; }
    .tree-content { display: flex; align-items: center; gap: 5px; font-size: 11px; }
    .node-title { font-weight: bold; }
    .node-meta { font-size: 9px; }

    /* MISC */
    .section-header { display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 11px; color: #000080; margin-top: 10px; margin-bottom: 5px; }
    .section-header::after { content: ""; flex: 1; height: 2px; border-top: 1px solid #808080; border-bottom: 1px solid #fff; }
    .warning-box { background: #FFFF00; border: 1px solid #000; padding: 4px; font-size: 10px; font-weight: bold; display: flex; gap: 8px; align-items: center; }

    .retro-select.mini { padding: 0 15px 0 2px; height: 18px; font-size: 10px; }

    .toggle-btn { background: none; border: none; color: #000080; cursor: pointer; font-size: 10px; padding: 0; text-align: left; font-weight: bold; margin-top: 5px; }
    .raw-box { background: #000; color: #0f0; padding: 10px; overflow-x: auto; font-size: 11px; max-height: 200px; font-weight: bold; font-family: 'Courier New', monospace; border: 2px inset #808080; }
</style>
