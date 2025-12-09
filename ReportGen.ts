import type { ProjectData } from './types';
import { Notice, type App } from 'obsidian';

export class ReportGen {
    
    public static async generateReport(app: App, data: ProjectData, sourceFilename: string) {
        if (!data.lastAiResult && !data.wizardState.concept) {
            new Notice("No data found to export.");
            return;
        }

        const date = new Date().toISOString().split('T')[0];
        const r = data.lastAiResult;
        const nlp = data.lastNlpMetrics;
        const wiz = data.wizardState;

        let md = `# NARRATIVE FORENSICS REPORT: ${sourceFilename}\n`;
        md += `**Date:** ${date} | **Compu-Judge v7.2.1**\n\n`;

        // 1. EXECUTIVE SUMMARY (If Scan Exists)
        if (r) {
            md += `## 1. Executive Summary\n`;
            md += `| Metric | Score | Verdict |\n|---|---|---|\n`;
            md += `| **Commercial** | ${r.commercial_score}/100 | ${this.getVerdict(r.commercial_score)} |\n`;
            md += `| **Literary** | ${r.niche_score}/100 | ${this.getVerdict(r.niche_score)} |\n`;
            md += `| **Cohesion** | ${r.cohesion_score}/100 | ${this.getVerdict(r.cohesion_score)} |\n\n`;
            
            md += `> **Logline:** ${r.log_line}\n\n`;
            md += `**Critical Flags:** ${r.content_warning}\n\n`;
        }

        // 2. FORENSIC METRICS (NLP)
        if (nlp) {
            md += `## 2. Prose Forensics (Hard Data)\n`;
            md += `- **Word Count:** ${nlp.wordCount}\n`;
            md += `- **Reading Level:** Grade ${nlp.readingLevel}\n`;
            md += `- **Adverb Count:** ${nlp.adverbCount} (Target: <${Math.round(nlp.wordCount * 0.03)})\n`;
            md += `- **Filter Words:** ${nlp.filterWordCount}\n`;
            md += `- **Weak Verbs:** ${nlp.weakVerbCount}\n`;
            md += `- **Pacing Score:** ${nlp.pacingScore}/100\n\n`;
        }

        // 3. STORY DNA (The Wizard Data)
        md += `## 3. Story Bible (DNA)\n`;
        md += `### The Core\n`;
        md += `- **Concept:** ${wiz.concept}\n`;
        md += `- **Promise (Hook):** ${wiz.threePs.promise}\n`;
        md += `- **Payoff (Climax):** ${wiz.threePs.payoff}\n\n`;

        // [RESTORED] THEMATIC ENGINE
        if (wiz.philosopher && (wiz.philosopher.controllingIdea || wiz.philosopher.moralArg)) {
            md += `### The Philosopher (Theme)\n`;
            md += `- **Controlling Idea:** ${wiz.philosopher.controllingIdea}\n`;
            md += `- **Moral Argument:** ${wiz.philosopher.moralArg}\n`;
            md += `- **Counterpoint:** ${wiz.philosopher.counterpoint}\n`;
            md += `- **Key Symbols:** ${wiz.philosopher.symbols}\n\n`;
        }

        // [RESTORED] STRUCTURE DNA
        md += `### Structure Strategy\n`;
        md += `- **Primary Thread:** ${wiz.structureDNA.primaryThread}\n`;
        md += `- **Nesting Order:** ${wiz.structureDNA.nestingOrder}\n\n`;
        
        if (wiz.structureDNA.tryFailCycles && wiz.structureDNA.tryFailCycles.length > 0) {
            md += `#### Try / Fail Cycles (Escalation)\n`;
            wiz.structureDNA.tryFailCycles.forEach((cycle, i) => {
                md += `**Cycle ${i+1}: ${cycle.goal}**\n`;
                md += `1. *No, and...* ${cycle.attempt1}\n`;
                md += `2. *No, but...* ${cycle.attempt2}\n`;
                md += `3. *Yes, but...* ${cycle.success}\n\n`;
            });
        }

        md += `### Cast List\n`;
        wiz.characters.forEach(c => {
            md += `- **${c.name}** (${c.role}): ${c.description} *[Flaw: ${c.flaw} | Revelation: ${c.revelation}]*\n`;
        });

        // 4. AI CRITIQUE (If Scan Exists)
        if (r && r.detailed_metrics) {
            md += `\n## 4. Structural Audit (AI)\n`;
            for (const [key, cat] of Object.entries(r.detailed_metrics)) {
                md += `### ${key.toUpperCase()} (Score: ${cat.score})\n`;
                cat.items.forEach(item => {
                    md += `- **${item.name} (${item.score}/10)**: ${item.reason}\n`;
                });
                md += `\n`;
            }
        }

        // 5. THOUGHT PROCESS
        if (r && r.thought_process) {
            md += `\n## 5. AI Reasoning (Raw)\n`;
            md += `${r.thought_process}\n`;
        }

        // SAVE FILE
        const filename = `${sourceFilename}_REPORT_${Date.now()}.md`;
        await app.vault.create(filename, md);
        new Notice(`Report saved: ${filename}`);
    }

    private static getVerdict(val: number): string {
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
}