<script lang="ts">
    import { onMount } from 'svelte';
    import { LogService } from './LogService';
    import { App, Notice } from 'obsidian';
    import type { CloudGenService } from './CloudGen';
    import type { GlobalForgeData } from './db';

    interface Props {
        app: App;
        cloud: CloudGenService;
        forgeData: GlobalForgeData | null;
        onUploadReference: (e: Event) => void;
        onClearReference: () => void;
    }

    let { app, cloud, forgeData, onUploadReference, onClearReference }: Props = $props();

    let logs: any[] = $state([]);
    let analysisResult: string = $state("");
    let isAnalyzing = $state(false);

    onMount(async () => {
        await refreshLogs();
    });

    async function refreshLogs() {
        logs = await LogService.getLogs(app);
    }

    async function savePlanAsDoc() {
        if (!analysisResult) return;

        const date = new Date();
        const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `Tuning-Plan-${timestamp}.md`;

        try {
            await app.vault.create(filename, analysisResult);
            new Notice(`Tuning plan saved as ${filename}`);
        } catch (e: any) {
            new Notice(`Failed to save plan: ${e.message}`);
            console.error(e);
        }
    }

    async function clearLogs() {
        if (confirm("Clear all tuning logs? This cannot be undone.")) {
            await LogService.clearLogs(app);
            await refreshLogs();
            new Notice("Logs cleared.");
        }
    }

    async function analyzeLogs() {
        if (logs.length === 0) {
            new Notice("No logs to analyze.");
            return;
        }

        isAnalyzing = true;
        analysisResult = "";

        try {
            // [UPDATED] Inject Global Knowledge into Tuning Analysis
            const knowledgeBlock = forgeData?.referenceText
                ? `\n[GLOBAL KNOWLEDGE BASE]:\n"${forgeData.referenceText.substring(0, 20000)}..."\n[INSTRUCTION]: Use this knowledge base to inform your tuning recommendations if relevant.`
                : "";

            const prompt = `
            [TASK]: SYSTEM TUNING ANALYSIS.
            [ROLE]: Senior DevOps Engineer & Narrative Systems Architect.

            [INPUT LOGS]:
            ${JSON.stringify(logs.slice(-20))}
            (Truncated to last 20 entries for token limits)
            ${knowledgeBlock}

            [OBJECTIVE]:
            Analyze the AI Request/Response patterns.
            Identify:
            1. Systematic Scoring Drift (Are scores consistently too high/low?).
            2. Logic Failures (Where did the AI ignore instructions?).
            3. Prompt Inefficiencies (Where is the prompt confusing the AI?).
            4. Performance bottlenecks.

            [OUTPUT]:
            Return a markdown list of ACTIONABLE INSTRUCTIONS for "Jules" (The developer) to tune the system.
            Be specific. Suggest Code Changes or Prompt Edits.
            `;

            const res = await cloud.callAI(prompt, "You are a System Analyst.", false, false, 0.2);
            analysisResult = res;

        } catch (e: any) {
            console.error(e);
            analysisResult = "Analysis Failed: " + e.message;
        } finally {
            isAnalyzing = false;
        }
    }
</script>

<div class="tune-container">
    <div class="tune-header">
        <h3>System Tuning & Knowledge Base</h3>
        <p>Analyze telemetry and manage global knowledge injection.</p>
    </div>

    <!-- [NEW] GLOBAL KNOWLEDGE SECTION -->
    <div class="bevel-groove" style="margin-bottom: 20px;">
        <div class="status-row">
            <span>GLOBAL KNOWLEDGE BASE</span>
            {#if forgeData?.referenceText}
                <span style="color: green; font-weight: bold;">[LOADED]</span>
            {:else}
                <span style="color: #808080;">[EMPTY]</span>
            {/if}
        </div>

        <div style="display: flex; gap: 5px; margin-bottom: 5px;">
            <label class="win95-btn" style="flex: 1; text-align: center; cursor: pointer;">
                {forgeData?.referenceText ? 'UPDATE KNOWLEDGE (ADD/REPLACE)' : '📂 LOAD KNOWLEDGE (.txt, .md, .pdf)'}
                <input type="file" accept=".txt,.md,.pdf" multiple onchange={onUploadReference} style="display: none;">
            </label>
            {#if forgeData?.referenceText}
                <button class="win95-btn" onclick={onClearReference} title="Clear Knowledge">🗑️</button>
            {/if}
        </div>

        {#if forgeData?.referenceText}
            <div class="knowledge-preview">
                {forgeData.referenceText.substring(0, 200)}...
                <br/>
                <i style="color: #666;">({forgeData.referenceText.length} characters loaded)</i>
            </div>
        {/if}
        <p style="font-size: 10px; margin: 5px 0 0 0; color: #555;">
            * This knowledge is applied globally to Critic, Wizard, Forge, and Tuning operations.
        </p>
    </div>

    <div class="tune-controls bevel-groove">
        <div class="status-row">
            <span>LOG STATUS: {logs.length} ENTRIES</span>
            <div class="control-btns">
                <button class="win95-btn" onclick={refreshLogs}>↻ REFRESH</button>
                <button class="win95-btn" onclick={clearLogs}>🗑️ CLEAR</button>
            </div>
        </div>

        <button class="win95-btn analyze-btn" onclick={analyzeLogs} disabled={isAnalyzing}>
            {isAnalyzing ? 'RUNNING DIAGNOSTICS...' : '⚡ ANALYZE LOGS & GENERATE TUNE PLAN'}
        </button>
    </div>

    {#if analysisResult}
        <div class="analysis-output bevel-down">
            <h4>[DIAGNOSTIC REPORT]</h4>
            <div class="markdown-preview">
                {@html analysisResult.replace(/\n/g, '<br>')}
            </div>
        </div>
        <button class="win95-btn" onclick={savePlanAsDoc} style="margin-bottom: 20px; width: 100%;">
            💾 SAVE PLAN AS DOCUMENT
        </button>
    {/if}

    <div class="log-preview bevel-down">
        <h4>RAW TELEMETRY STREAM (LAST 5)</h4>
        {#each logs.slice().reverse().slice(0, 5) as log}
            <div class="log-entry">
                <span class="log-ts">[{log.timestamp}]</span>
                <span class="log-type">{log.type}</span>
                <pre class="log-data">{JSON.stringify(log.data, null, 2)}</pre>
            </div>
        {/each}
    </div>
</div>

<style>
    .tune-container {
        padding: 10px;
        height: 100%;
        overflow-y: auto;
        font-family: 'Pixelated MS Sans Serif', 'Tahoma', sans-serif;
    }
    .tune-header h3 { margin: 0; color: #000080; }
    .tune-header p { margin: 5px 0 15px 0; font-size: 11px; }

    .bevel-groove { border: 2px groove #fff; padding: 10px; background: #c0c0c0; margin-bottom: 15px; }
    .bevel-down { border: 2px inset #fff; background: #fff; padding: 10px; overflow-x: hidden; }

    .status-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: bold; }
    .control-btns { display: flex; gap: 5px; }

    .win95-btn {
        background: #c0c0c0;
        border: 2px outset #fff;
        border-right-color: #000;
        border-bottom-color: #000;
        padding: 4px 10px;
        font-weight: bold;
        cursor: pointer;
    }
    .win95-btn:active { border-style: inset; }
    .win95-btn:disabled { color: #808080; }

    .analyze-btn { width: 100%; padding: 10px; }

    .analysis-output {
        background: #000;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        margin-bottom: 20px;
        max-height: 300px;
        overflow-y: auto;
    }
    .analysis-output h4 { color: #fff; border-bottom: 1px dashed #00ff00; padding-bottom: 5px; margin-top: 0; }

    .log-preview { background: #e0e0e0; max-height: 200px; overflow-y: auto; }
    .log-entry { border-bottom: 1px solid #999; padding: 5px 0; font-size: 10px; }
    .log-ts { color: #000080; margin-right: 5px; }
    .log-type { font-weight: bold; color: #800000; }
    .log-data { margin: 2px 0 0 10px; color: #333; font-size: 9px; white-space: pre-wrap; word-wrap: break-word; }

    .knowledge-preview {
        font-size: 10px;
        font-family: 'Courier New', monospace;
        background: rgba(255,255,255,0.3);
        padding: 5px;
        border: 1px dotted #808080;
        margin-top: 5px;
    }
</style>
