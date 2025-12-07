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
    }

    let { data, meta, isProcessing, settings, onRunMeta }: Props = $props();
    let showRaw = $state(false);

    // --- UTILS ---
    
    // Zero-Based Color Map
    function getBarColor(val: number): string {
        if (val >= 30) return settings.gradingColors.masterpiece; // White/Rainbow
        if (val >= 10) return settings.gradingColors.excellent;   // Gold/Blue
        if (val > 0) return settings.gradingColors.good;          // Green
        if (val === 0) return settings.gradingColors.average;     // Gray
        if (val >= -10) return settings.gradingColors.poor;       // Orange/Rust
        return settings.gradingColors.critical;                   // Red/Black
    }

    // [UPDATED] Universal Masterpiece Check: Matches the Masterpiece Color
    function isMasterpieceEffect(val: number): boolean { 
        return getBarColor(val) === settings.gradingColors.masterpiece;
    }

    // New Logic: Critical Failure is significantly negative
    function isCritical(val: number): boolean {
        return val <= -20; // Threshold for Cracked Effect
    }
    
    // Helper to get the correct container class
    function getContainerClass(val: number): string {
        if (isMasterpieceEffect(val)) return 'score-container bevel-down masterpiece-border pattern-mesh-dark';
        if (isCritical(val)) return 'score-container bevel-down critical-crack pattern-mesh-critical';
        return 'score-container bevel-down';
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
        // Simple Average of Signed Integers
        return Math.round((c + n + co) / 3);
    });

    // Ideal Arc Logic
    let selectedArc = $state("truby");

    let chartData = $derived.by(() => {
        if (!isUniversalOutline) {
            // [UPDATED] Use full dynamic length of tension_arc if available
            const legacyArc = data.tension_arc || [0, 10, 5, 20, 15, 30]; 
            return legacyArc.map((val, i) => ({
                tension: val,
                widthPerc: 100 / legacyArc.length,
                title: `Beat ${i + 1}`,
                desc: "Legacy Data"
            }));
        }

        const nodes = structure as UniversalOutlineNode[];
        const totalChars = nodes.reduce((acc, node) => acc + (node.description?.length || 50), 0);
        
        return nodes.map(node => {
            const len = node.description?.length || 50;
            let rawPerc = (len / totalChars) * 100;
            return {
                tension: node.tension,
                widthPerc: rawPerc, 
                title: node.title,
                desc: node.description
            };
        });
    });

    // Interpolate Ideal Path
    let idealPathD = $derived.by(() => {
        if (!chartData || chartData.length === 0) return "";
        
        const idealPoints = IDEAL_ARCS[selectedArc].points;
        const numBeats = chartData.length;
        
        // Map points: X is percent (0-100), Y is tension (-50 to +100 approx) mapped to chart height
        // Chart height: let's assume 100 units. Center (0 tension) is at Y=50.
        // Positive tension goes UP (lower Y). Negative goes DOWN (higher Y).
        
        let path = "";
        let currentX = 0;

        chartData.forEach((beat, i) => {
            const centerX = currentX + (beat.widthPerc / 2);
            
            // Linear Interpolation of Ideal Curve
            // Progress from 0 to 1
            const progress = i / (numBeats - 1 || 1); 
            
            // Find index in idealPoints array
            const idealIndex = progress * (idealPoints.length - 1);
            const lowerIdx = Math.floor(idealIndex);
            const upperIdx = Math.ceil(idealIndex);
            const weight = idealIndex - lowerIdx;
            
            const val1 = idealPoints[lowerIdx];
            const val2 = idealPoints[upperIdx];
            const idealVal = val1 + (val2 - val1) * weight;
            
            // Map Ideal Value (0 to 100 usually) to Visual Y
            // Visual Scale: 0 tension = 50% height. +100 tension = 0% height. -100 tension = 100% height.
            // Factor: 1 unit tension = 0.5% height?
            // Let's match the bar scaling.
            // Bar: height = width% (e.g. 50 tension = 50% height).
            
            // Actually, let's normalize simply:
            // Center is 50.
            // +100 => 0.
            // -100 => 100.
            const yPos = 50 - (idealVal / 2); 

            if (i === 0) path += `M ${centerX} ${yPos}`;
            else path += ` L ${centerX} ${yPos}`;
            
            currentX += beat.widthPerc;
        });

        return path;
    });
</script>

<div class="critic-display">
    
    <div class="{getContainerClass(averageScore)}">
        
        <div class="main-score-row">
            <div class="score-block main">
                <div class="score-title" style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#999' : '#555'}">OVERALL SCORE</div>
                <!-- Main score display -->
                <div class="score-main {isMasterpieceEffect(averageScore) ? 'masterpiece-text' : ''} 
                            {isCritical(averageScore) ? 'critical-text' : ''}" 
                     style="color: {isMasterpieceEffect(averageScore) ? '' : (isCritical(averageScore) ? '#000' : getBarColor(averageScore))}">
                    {formatScoreDisplay(averageScore)}
                </div>
                <!-- Verdict Text: Masterpiece (Rainbow) or Critical (Dark) -->
                <div class="score-verdict {isMasterpieceEffect(averageScore) ? 'masterpiece-text' : ''} {isCritical(averageScore) ? 'critical-text' : ''}" 
                     style="color: {isMasterpieceEffect(averageScore) ? '' : (isCritical(averageScore) ? '#000' : getBarColor(averageScore))}">
                    {getVerdict(averageScore)}
                </div>
            </div>
        </div>

        <div class="score-divider-horizontal"></div>

        <div class="sub-score-row">
            <div class="sub-score-block tooltip-container">
                <div class="sub-title" style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#aaa' : '#555'}">COMMERCIAL</div>
                <!-- Force color white for dark backgrounds -->
                <div class="sub-val {isMasterpieceEffect(data.commercial_score) ? 'masterpiece-text' : ''}" 
                     style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#fff' : getBarColor(data.commercial_score)}">
                    {formatScoreDisplay(data.commercial_score)}
                </div>
                <div class="tooltip bottom">{data.commercial_reason || "No reasoning available."}</div>
            </div>
            
            <div class="sub-divider"></div>
            
            <div class="sub-score-block tooltip-container">
                <div class="sub-title" style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#aaa' : '#555'}">LITERARY</div>
                <div class="sub-val {isMasterpieceEffect(data.niche_score) ? 'masterpiece-text' : ''}" 
                     style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#fff' : getBarColor(data.niche_score)}">
                    {formatScoreDisplay(data.niche_score)}
                </div>
                <div class="tooltip bottom">{data.niche_reason || "No reasoning available."}</div>
            </div>
            
            <div class="sub-divider"></div>
            
            <div class="sub-score-block tooltip-container">
                <div class="sub-title" style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#aaa' : '#555'}">COHESION</div>
                <div class="sub-val {isMasterpieceEffect(data.cohesion_score) ? 'masterpiece-text' : ''}" 
                     style="color: {isMasterpieceEffect(averageScore) || isCritical(averageScore) ? '#fff' : getBarColor(data.cohesion_score)}">
                    {formatScoreDisplay(data.cohesion_score)}
                </div>
                <div class="tooltip bottom">{data.cohesion_reason || "No reasoning available."}</div>
            </div>
        </div>
        
        {#if warning && warning.length > 5 && warning !== 'None'}
        <div class="warning-box warning-stripe" style="margin-top: 15px;">
            <span class="warning-icon">⚠</span>
            <span class="warning-text">{warning}</span>
        </div>
        {/if}

        <div class="log-section" style="margin-top: 10px;">
            <span class="log-label">LOGLINE: </span>
            <span class="log-text-blue">"{data.log_line || 'Analysis pending...'}"</span>
        </div>
    </div>

    <div class="section-header">SANDERSON ENGINE METRICS</div>
    <div class="modules-grid bevel-down">
        
        <!-- PROTAGONIST SLIDERS (0-100) -->
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
                    <div class="slider-track">
                        <div class="slider-fill" style="width: {getSliderMetrics(s.val)}%;"></div>
                    </div>
                </div>
            {/each}
        </div>
        {/if}

        <div class="divider-line"></div>

        <!-- CORE LAWS (Zero-Based) -->
        {#each [
            { label: 'PROMISE/PAYOFF', val: sanderson.promise_payoff },
            { label: 'LAWS OF MAGIC', val: sanderson.laws_of_magic },
            { label: 'AGENCY', val: sanderson.character_agency }
        ] as m}
            {@const bar = getBarMetrics(m.val)}
            <div class="module-item">
                <span class="mod-label">{m.label}</span>
                <!-- Diverging Bar Container -->
                <div class="diverging-bar-container">
                    <div class="center-line"></div>
                    <!-- The Bar itself -->
                    <div class="fill {isMasterpieceEffect(m.val) ? 'glow-bar' : ''}" 
                         style="
                            width: {bar.width}%; 
                            left: {bar.isNegative ? (50 - bar.width) + '%' : '50%'};
                            background: {getBarColor(m.val)}
                         ">
                    </div>
                </div>
                <span class="mod-score {isMasterpieceEffect(m.val) ? 'masterpiece-text' : ''}" 
                      style="color: {isMasterpieceEffect(m.val) ? '' : getBarColor(m.val)}">
                    {formatScoreDisplay(m.val)}
                </span>
            </div>
        {/each}
    </div>

    {#if hasDetails}
    <div class="section-header">FORENSIC REPORT</div>
    <div class="details-grid bevel-down">
        {#each Object.entries(details) as [key, cat]}
            <div class="detail-category">
                <div class="cat-header">
                    <span class="cat-name">{key.toUpperCase()}</span>
                    <span class="cat-score {isMasterpieceEffect(cat.score) ? 'masterpiece-text' : ''}" 
                          style="color: {isMasterpieceEffect(cat.score) ? '' : getBarColor(cat.score)}">
                        AVG: {formatScoreDisplay(cat.score)}
                    </span>
                </div>
                <div class="cat-items">
                    {#each cat.items as item}
                        {@const bar = getBarMetrics(item.score)}
                        <div class="metric-card">
                            <div class="metric-top">
                                <span class="metric-name">{item.name}</span>
                                <span class="metric-val {isMasterpieceEffect(item.score) ? 'masterpiece-text' : ''}" 
                                      style="color: {isMasterpieceEffect(item.score) ? '' : getBarColor(item.score)}">
                                    {formatScoreDisplay(item.score)}
                                </span>
                            </div>
                            
                            <!-- Diverging Metric Bar -->
                            <div class="metric-bar-container diverging-bar-container">
                                <div class="center-line"></div>
                                <div class="metric-bar {isMasterpieceEffect(item.score) ? 'glow-bar' : ''}" 
                                     style="
                                        width: {bar.width}%; 
                                        left: {bar.isNegative ? (50 - bar.width) + '%' : '50%'};
                                        background: {getBarColor(item.score)}
                                     ">
                                </div>
                            </div>
                            
                            <div class="metric-diagnosis">
                                <span class="diag-label">DIAGNOSIS:</span> 
                                <span class="diag-text">{item.reason}</span>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
    {/if}

        {#if data.tribunal_breakdown}
        <div class="section-header">TRIBUNAL CONSENSUS</div>
        <div class="tribunal-grid">
            <!-- MARKET -->
            <div class="agent-card">
                <div class="agent-header agent-market">MARKET ANALYST</div>
                <div class="agent-verdict {isMasterpieceEffect(data.tribunal_breakdown.market.commercial_score) ? 'masterpiece-text' : ''}">
                    SCORE: {formatScoreDisplay(data.tribunal_breakdown.market.commercial_score)}
                </div>
                <div class="agent-list">{data.tribunal_breakdown.market.log_line || "N/A"}</div>
                <div class="agent-list" style="margin-top:4px;">
                    <i>"{data.tribunal_breakdown.market.commercial_reason || ""}"</i>
                </div>
            </div>
            
            <!-- LOGIC -->
            <div class="agent-card">
                <div class="agent-header agent-logic">LOGIC ENGINE</div>
                <div class="agent-verdict {isMasterpieceEffect(data.tribunal_breakdown.logic.cohesion_score) ? 'masterpiece-text' : ''}">
                    SCORE: {formatScoreDisplay(data.tribunal_breakdown.logic.cohesion_score)}
                </div>
                <div class="agent-list" style="color:#800000;">{data.tribunal_breakdown.logic.content_warning || "No Logic Holes Detected."}</div>
                <div class="agent-list" style="margin-top:4px;">
                    <i>"{data.tribunal_breakdown.logic.cohesion_reason || ""}"</i>
                </div>
            </div>

            <!-- LIT -->
            <div class="agent-card">
                <div class="agent-header agent-lit">LITERARY CRITIC</div>
                <div class="agent-verdict {isMasterpieceEffect(data.tribunal_breakdown.lit.novelty_score) ? 'masterpiece-text' : ''}">
                    NOVELTY: {formatScoreDisplay(data.tribunal_breakdown.lit.novelty_score)}
                </div>
                <div class="agent-list">Theme: {formatScoreDisplay(data.tribunal_breakdown.lit.niche_score)}</div>
                <div class="agent-list" style="margin-top:4px;">
                    <i>"{data.tribunal_breakdown.lit.niche_reason || ""}"</i>
                </div>
            </div>
        </div>
    {/if}

<div class="section-header">
    <span>NARRATIVE TENSION ARC</span>
    <select class="retro-select" bind:value={selectedArc}>
        {#each Object.entries(IDEAL_ARCS) as [key, arc]}
            <option value={key}>{arc.label}</option>
        {/each}
    </select>
</div>
    <div class="chart-box bevel-down">
        <div class="chart-area zero-center">
            <div class="chart-center-line"></div>
            
            <!-- SVG OVERLAY FOR IDEAL PATH -->
            <svg class="chart-overlay" preserveAspectRatio="none" viewBox="0 0 100 100">
                <path d={idealPathD} fill="none" stroke="#000080" stroke-width="0.5" stroke-dasharray="2,1" opacity="0.6" />
            </svg>

            {#each chartData as beat, i}
                {@const bar = getBarMetrics(beat.tension)}
                <div class="bar-col tooltip-container" style="flex-grow: {beat.widthPerc};">
                    <!-- Column Flex Logic for Diverging Vertical Bars -->
                    <div class="bar-fill {isMasterpieceEffect(beat.tension) ? 'glow-bar' : ''}" 
                         style="
                            height: {bar.width}%; 
                            background-color: {getBarColor(beat.tension)};
                            position: absolute;
                            bottom: {bar.isNegative ? 'auto' : '50%'};
                            top: {bar.isNegative ? '50%' : 'auto'};
                            left: 1px; right: 1px;
                         ">
                    </div>
                    <div class="tooltip chart-tooltip">
                        <strong>{i+1}. {beat.title}</strong><br/>
                        Tension: {formatScoreDisplay(beat.tension)}<br/>
                        <span style="font-size:0.8em; opacity:0.8">Duration: {Math.round(beat.widthPerc)}%</span>
                    </div>
                </div>
            {/each}
        </div>
        <div class="chart-axis">
            <span>START</span>
            <div style="display:flex; align-items:center; gap:5px;">
                <span class="legend-box" style="border:1px dashed #000080;"></span>
                <span style="font-size:9px; color:#000080;">IDEAL ({IDEAL_ARCS[selectedArc].label})</span>
            </div>
            <span>END</span>
        </div>
    </div>

    <div class="section-header">UNIVERSAL OUTLINE</div>
    <div class="structure-box bevel-down">
        {#if isUniversalOutline}
            {#each structure as node}
                <div class="structure-node {node.type}">
                    <div class="node-header">
                        <span class="node-type">{node.type.toUpperCase()}</span>
                        <span class="node-title">{node.title}</span>
                        <span class="node-tension {isMasterpieceEffect(node.tension) ? 'masterpiece-text' : ''}" style="color: {isMasterpieceEffect(node.tension) ? '' : '#BF40BF'}">
                            ⚡ {formatScoreDisplay(node.tension)}
                        </span>
                    </div>
                    <div class="node-desc">{node.description}</div>
                    <div class="node-chars">ACTORS: {node.characters.join(", ")}</div>
                </div>
            {/each}
        {:else}
            {#each structure as beat}
                <div class="structure-item">
                    <div class="square-bullet">■</div>
                    <div class="beat-text">{beat}</div>
                </div>
            {/each}
        {/if}
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
    .critic-display { display: flex; flex-direction: column; gap: 15px; font-family: 'Courier New', monospace; color: #000; font-weight: bold; }
    .bevel-down { border: 2px solid #808080; border-bottom-color: #fff; border-right-color: #fff; background: #c0c0c0; padding: 10px; }
    
    /* SCORES */
    .score-container { 
        background: #d4d4d4; 
        padding-bottom: 25px; 
        position: relative; 
        z-index: 100; /* Ensure tooltips are above following sections */
    }
    
    /* NEW LAYOUT */
    .main-score-row { display: flex; justify-content: center; padding: 15px 0; }
    .score-block.main { display: flex; flex-direction: column; align-items: center; }
    .score-title { font-size: 14px; color: #555; font-weight: 900; letter-spacing: 2px; margin-bottom: 5px; }
    .score-main { font-size: 64px; font-weight: 900; line-height: 0.9; text-shadow: 2px 2px 0px rgba(255,255,255,0.5); }
    .score-verdict { font-size: 16px; font-weight: 900; margin-top: 5px; text-shadow: 1px 1px 0px #000; letter-spacing: 3px; }

    .score-divider-horizontal { height: 2px; background: #808080; width: 80%; margin: 10px auto; }

    .sub-score-row {
        position: relative;
        z-index: 101; /* Ensure sub-scores are even higher */
        display: flex; 
        justify-content: space-around; 
        align-items: center; 
        padding-top: 5px; 
    }
    
    .sub-score-block { text-align: center; flex: 1; position: relative; cursor: help; } /* Added relative/cursor */
    .sub-title { font-size: 10px; font-weight: bold; color: #555; margin-bottom: 2px; }
    .sub-val { font-size: 18px; font-weight: 900; }
    .sub-divider { width: 1px; height: 20px; background: #999; }

    /* TOOLTIPS */
    .tooltip-container { 
        position: relative; 
        overflow: visible; 
    }
    .tooltip { 
        visibility: hidden; 
        opacity: 0;
        background-color: #FFFFE0; color: #000; 
        text-align: center; 
        border: 2px solid #000;
        padding: 5px 8px; 
        position: absolute; 
        z-index: 10000; /* FORCE TOP LAYER */
        font-size: 11px;
        width: 140px;
        box-shadow: 4px 4px 0px rgba(0,0,0,0.2);
        transition: opacity 0.2s;
        pointer-events: none;
    }
    
    .tooltip.bottom {
        top: 100%; left: 50%;
        transform: translateX(-50%);
        margin-top: 8px;
    }

    /* Standard tooltip arrow (CSS triangle) */
    .tooltip.bottom::after {
        content: ""; position: absolute;
        bottom: 100%;
        left: 50%;
        margin-left: -5px;
        border-width: 5px;
        border-style: solid;
        border-color: transparent transparent #000 transparent;
    }

    .tooltip-container:hover .tooltip { visibility: visible; opacity: 1; }

    /* ANIMATIONS */
    .masterpiece { color: var(--cj-grade-masterpiece) !important; animation: god-mode 1.5s infinite alternate cubic-bezier(0.45, 0.05, 0.55, 0.95); text-shadow: 0 0 10px var(--cj-grade-masterpiece), 0 0 20px var(--cj-grade-masterpiece); z-index: 5; position: relative; }
    .glow-bar { background-color: var(--cj-grade-masterpiece) !important; box-shadow: 0 0 10px var(--cj-grade-masterpiece), 0 0 15px var(--cj-grade-masterpiece); animation: pulse-bar 0.8s infinite alternate; }

    /* SANDERSON METRICS (Updated for Diverging Bars) */
    .modules-grid { padding: 10px; }
    .module-item { display: flex; align-items: center; gap: 8px; font-size: 10px; margin-bottom: 8px; }
    .mod-label { width: 110px; text-align: right; color: #444; font-weight: 900; }
    
    .diverging-bar-container { flex: 1; height: 16px; background: #ddd; border: 2px solid #808080; position: relative; overflow: hidden; }
    .center-line { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #555; z-index: 2; opacity: 0.5; }
    .fill { height: 100%; transition: width 0.5s ease; position: absolute; z-index: 1; }
    
    .mod-score { font-weight: 900; width: 35px; text-align: center; font-size: 12px; text-shadow: 1px 1px 0 #fff; }

    /* NEW SLIDER STYLES */
    .slider-group { padding: 0 0 10px 0; }
    .slider-label { font-size: 11px; font-weight: 900; color: #000080; border-bottom: 1px dashed #888; margin-bottom: 6px; }
    .slider-item { margin-bottom: 6px; }
    .slider-text-row { display: flex; justify-content: space-between; font-size: 10px; font-weight: bold; margin-bottom: 2px; }
    .slider-track { height: 10px; background: #fff; border: 1px inset #fff; border-top-color: #888; border-left-color: #888; }
    .slider-fill { height: 100%; background: #008080; /* Teal for sliders */ }
    .divider-line { height: 1px; background: #808080; margin: 10px 0; }

    /* DETAILED METRICS (Updated) */
    .details-grid { display: flex; flex-direction: column; gap: 15px; background: #dcdcdc; padding: 12px; }
    .detail-category { border: 2px groove #fff; background: #e0e0e0; padding: 8px; }
    .cat-header { display: flex; justify-content: space-between; font-weight: 900; font-size: 12px; color: #000080; margin-bottom: 8px; border-bottom: 2px dotted #808080; padding-bottom: 4px; }
    .cat-items { display: flex; flex-direction: column; gap: 8px; }
    
    .metric-card { background: #f0f0f0; border: 2px solid #aaa; padding: 6px; }
    .metric-top { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
    .metric-name { font-weight: bold; color: #222; }
    .metric-val { font-weight: 900; }
    
    .metric-bar-container { height: 8px; background: #fff; border: 1px solid #888; margin-bottom: 6px; }
    .metric-bar { height: 100%; transition: width 0.5s ease; position: absolute; top:0; bottom:0; }
    
    .metric-diagnosis { font-size: 10px; line-height: 1.3; color: #333; border-top: 1px dashed #ccc; padding-top: 4px; }
    .diag-label { font-weight: 900; color: #800000; margin-right: 4px; }
    .diag-text { font-style: italic; }

    /* CHART AREA (Diverging) */
    .chart-box { 
        padding: 10px; background: #d4d4d4; 
        position: relative;
        z-index: 50; /* Lower than score but above normal flow if needed */
    }
    .chart-area { height: 100px; display: flex; align-items: stretch; gap: 1px; padding-bottom: 4px; border-bottom: 2px solid #808080; position: relative; }
    .chart-center-line { position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #555; z-index: 0; }
    
    .chart-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: none; }

    .chart-axis { display: flex; justify-content: space-between; font-size: 9px; color: #555; margin-top: 2px; align-items: center; }
    .retro-select { font-family: inherit; font-size: 10px; background: #fff; border: 1px solid #808080; margin-left: auto; }
    .legend-box { width: 10px; height: 10px; display: inline-block; }
    .bar-col { display: flex; flex-direction: column; justify-content: center; align-items: center; min-width: 4px; position: relative; transition: opacity 0.2s; height: 100%; }
    .bar-col:hover { opacity: 0.8; }
    .bar-fill { width: 100%; transition: height 0.5s ease; border: 1px solid rgba(0,0,0,0.2); }
    .chart-tooltip { bottom: 100%; margin-bottom: 5px; white-space: nowrap; pointer-events: none; }

    /* STRUCTURE NODES */
    .structure-box { padding: 12px; background: #d4d4d4; }
    .structure-node { background: #e0e0e0; border: 2px inset #fff; padding: 8px; margin-bottom: 8px; }
    .structure-node.promise { border-left: 4px solid #000080; }
    .structure-node.payoff { border-left: 4px solid #800000; }
    .structure-node.progress { border-left: 4px solid #008000; }
    .node-header { display: flex; justify-content: space-between; font-size: 10px; font-weight: 900; margin-bottom: 4px; border-bottom: 1px dashed #999; }
    .node-type { color: #555; }
    .node-tension { color: #BF40BF; }
    .node-desc { font-size: 11px; margin-bottom: 4px; }
    .node-chars { font-size: 9px; color: #666; font-style: italic; }

    /* MISC */
    .section-header { display: flex; align-items: center; gap: 10px; font-weight: 900; font-size: 12px; color: #000; text-transform: uppercase; margin-top: 10px; margin-bottom: 5px; }
    .section-header::after { content: ""; flex: 1; height: 2px; background: #808080; }
    .warning-box { background: #FFFF00; border: 2px solid #000; padding: 8px; font-size: 11px; font-weight: 900; display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; }
    .log-section { width: 100%; text-align: left; font-size: 12px; line-height: 1.4; }
    .log-label { color: #000080; font-weight: 900; }
    .log-text { color: #222; font-style: italic; font-weight: bold; }
    .toggle-btn { background: none; border: none; color: #444; cursor: pointer; font-size: 11px; padding: 0; text-align: left; font-weight: bold; }
    .raw-box { background: #000; color: #0f0; padding: 10px; overflow-x: auto; font-size: 11px; max-height: 200px; font-weight: bold; }
</style>
