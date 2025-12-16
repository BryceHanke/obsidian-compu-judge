import { TFile, TFolder, normalizePath, type Plugin } from 'obsidian';
import { DEFAULT_WIZARD_STATE, type ProjectData, type NigsSettings, DEFAULT_SETTINGS, type NigsWizardState, type NigsActionPlan } from './types';
import type CompuJudgePlugin from './main';

const DATA_FOLDER = 'compu-judge-data';
const GLOBAL_WIZARD_FILE = 'global_wizard_data.json';
const GLOBAL_FORGE_FILE = 'global_forge_data.json';

// Global Forge/Archivist Data Type
export interface GlobalForgeData {
    archivistContext: string;
    archivistPrompt: string;
    repairFocus: string;
    lastActionPlan: NigsActionPlan | null;
    referenceText?: string; // [NEW] Global Knowledge Base
}

export class NigsDB {
    private plugin: CompuJudgePlugin | null = null;
    private memoryCache: Map<string, ProjectData> = new Map();
    private wizardCache: NigsWizardState | null = null;
    private forgeCache: GlobalForgeData | null = null;

    connect(plugin: CompuJudgePlugin) {
        this.plugin = plugin;
    }

    /**
     * Initialize DB: Create data folder and migrate legacy data if found.
     */
    async init() {
        if (!this.plugin) return;
        
        const adapter = this.plugin.app.vault.adapter;
        if (!(await adapter.exists(DATA_FOLDER))) {
            await adapter.mkdir(DATA_FOLDER);
        }

        await this.migrateLegacyData();
    }

    /**
     * ONE-TIME MIGRATION: Moves data from data.json to individual files.
     */
    private async migrateLegacyData() {
        if (!this.plugin || !this.plugin.settings.projects) return;

        const legacyProjects = this.plugin.settings.projects;
        const keys = Object.keys(legacyProjects);

        if (keys.length > 0) {
            console.log(`[Compu-Judge] Migrating ${keys.length} projects to ${DATA_FOLDER}...`);
            
            for (const path of keys) {
                const data = legacyProjects[path];
                if (data) {
                    await this.saveProjectData(data); // Write to new file system
                }
            }

            // Clear legacy data from settings to free up memory
            this.plugin.settings.projects = {};
            await this.plugin.saveSettings();
            console.log("[Compu-Judge] Migration Complete.");
        }
    }

    /**
     * Generates a safe filename for the data file based on the source note path.
     * e.g. "Folder/My Story.md" -> ".compu-judge/My_Story_md_<HASH>.json"
     */
    private getStoragePath(filePath: string): string {
        // Simple hash to handle duplicate filenames in different folders
        let hash = 0;
        for (let i = 0; i < filePath.length; i++) {
            hash = ((hash << 5) - hash) + filePath.charCodeAt(i);
            hash |= 0;
        }
        const safeName = filePath.split('/').pop()?.replace(/[^a-z0-9]/gi, '_') || 'untitled';
        return `${DATA_FOLDER}/${safeName}_${Math.abs(hash)}.json`;
    }

    /**
     * Load project data from the hidden folder.
     */
    async getProjectData(filePath: string): Promise<ProjectData> {
        if (!this.plugin) throw new Error("DB Not Connected");

        // 1. Check Memory Cache first (Performance)
        if (this.memoryCache.has(filePath)) {
            return this.memoryCache.get(filePath)!;
        }

        const storagePath = this.getStoragePath(filePath);
        const adapter = this.plugin.app.vault.adapter;

        // 2. Define default structure
        const cleanDefaults: ProjectData = {
            filePath,
            wizardState: JSON.parse(JSON.stringify(DEFAULT_WIZARD_STATE)),
            lastAiResult: null,
            lastLightResult: null,
            lastActionPlan: null,
            lastMetaResult: null,
            updatedAt: Date.now(),
            lastAnalysisMtime: null,
            archivistPrompt: "",
            archivistContext: "",
            repairFocus: "" 
        };

        // 3. Try to load from disk
        if (await adapter.exists(storagePath)) {
            try {
                const json = await adapter.read(storagePath);
                const stored = JSON.parse(json);
                
                // Deep merge to ensure new schema fields exist
                // [CRITICAL]: We merge nested objects to ensure the new "philosopher" logic
                // doesn't break when loading older files.
                const mergedWizard = {
                    ...cleanDefaults.wizardState,
                    ...stored.wizardState,
                    // Ensure nested objects exist and merge defaults for safety
                    characters: stored.wizardState?.characters || cleanDefaults.wizardState.characters,
                    structure: stored.wizardState?.structure || cleanDefaults.wizardState.structure,
                    structureDNA: { ...cleanDefaults.wizardState.structureDNA, ...(stored.wizardState?.structureDNA || {}) },
                    sandersonLaws: { ...cleanDefaults.wizardState.sandersonLaws, ...(stored.wizardState?.sandersonLaws || {}) },
                    threePs: { ...cleanDefaults.wizardState.threePs, ...(stored.wizardState?.threePs || {}) },
                    philosopher: { ...cleanDefaults.wizardState.philosopher, ...(stored.wizardState?.philosopher || {}) }
                };

                const finalData = {
                    ...cleanDefaults,
                    ...stored,
                    wizardState: mergedWizard
                };

                // Update Cache
                this.memoryCache.set(filePath, finalData);
                return finalData;

            } catch (e) {
                console.error(`[Compu-Judge] Corrupt data for ${filePath}`, e);
                // Don't return yet, fall through to attempt frontmatter recovery
            }
        }

        // 4. [FALLBACK]: Attempt to Restore from FrontMatter (Cross-Device Loading)
        // If we are here, either the local JSON is missing (new device) or corrupt.
        // We check the Markdown file itself for "critic_" fields to reconstruct the state.
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;

                if (fm && fm['critic_score']) {
                    console.log(`[Compu-Judge] Restoring State from FrontMatter for ${filePath}`);

                    // Reconstruct Light Grade (Quick Scan)
                    let restoredLight = null;
                    if (fm['critic_summary'] || fm['critic_key_improvement']) {
                        restoredLight = {
                            score: String(fm['critic_score']),
                            letter_grade: fm['critic_grade'] || 'C',
                            summary_line: fm['critic_summary'] || '',
                            synopsis: fm['critic_synopsis'] || '',
                            key_improvement: fm['critic_key_improvement'] || '',
                            outline_summary: fm['critic_outline_summary'] || []
                        };
                    }

                    // Reconstruct Deep Scan (NigsResponse)
                    let restoredDeep = null;
                    // We assume it's a deep scan if complex metrics exist or commercial score is present
                    if (fm['critic_commercial_reason'] || fm['critic_tribunal_breakdown']) {
                        restoredDeep = {
                            commercial_score: Number(fm['critic_score']) || 0,
                            commercial_reason: fm['critic_commercial_reason'] || '',
                            niche_score: fm['critic_niche_score'] || 0,
                            niche_reason: fm['critic_niche_reason'] || '',
                            cohesion_score: fm['critic_cohesion_score'] || 0,
                            cohesion_reason: fm['critic_cohesion_reason'] || '',

                            content_warning: fm['critic_content_warning'] || 'None',
                            log_line: fm['critic_logline'] || '',
                            structure_map: fm['critic_structure_map'] || [],
                            tension_arc: fm['critic_tension_arc'] || [],
                            quality_arc: fm['critic_quality_arc'] || [],
                            third_act_score: fm['critic_third_act_score'] || 0,
                            novelty_score: fm['critic_novelty_score'] || 0,

                            sanderson_metrics: fm['critic_sanderson_metrics'] || { promise_payoff: 0, laws_of_magic: 0, character_agency: 0 },
                            detailed_metrics: fm['critic_detailed_metrics'] || { premise: { score: 0, items: []}, structure: { score: 0, items: []}, character: { score: 0, items: []}, theme: { score: 0, items: []}, world: { score: 0, items: []} },

                            tribunal_breakdown: fm['critic_tribunal_breakdown'],
                            arbitration_log: fm['critic_arbitration_log']
                        };
                    }

                    const restoredData: ProjectData = {
                        ...cleanDefaults,
                        lastLightResult: restoredLight,
                        lastAiResult: restoredDeep,
                        lastAnalysisMtime: file.stat.mtime
                    };

                    this.memoryCache.set(filePath, restoredData);
                    // Optionally save to local JSON to "hydrate" the cache permanently on this device
                    await this.saveProjectData(restoredData);

                    return restoredData;
                }
            }
        } catch (e) {
            console.error(`[Compu-Judge] FrontMatter Restore Failed for ${filePath}`, e);
        }

        return cleanDefaults;
    }

    /**
     * Save project data to the hidden folder.
     */
    async saveProjectData(data: ProjectData, fileMtime?: number): Promise<void> {
        if (!this.plugin) return;

        const clean = JSON.parse(JSON.stringify(data)); // Decouple from Svelte proxy objects
        if (fileMtime) clean.lastAnalysisMtime = fileMtime;
        clean.updatedAt = Date.now();

        // Update Cache
        this.memoryCache.set(data.filePath, clean);

        // Write to Disk
        const storagePath = this.getStoragePath(data.filePath);
        const adapter = this.plugin.app.vault.adapter;
        
        try {
            await adapter.write(storagePath, JSON.stringify(clean, null, 2));
        } catch (e) {
            console.error(`[Compu-Judge] Save failed for ${data.filePath}`, e);
        }
    }

    /**
     * Load GLOBAL Wizard Data (Persistent across files)
     */
    async getGlobalWizardData(): Promise<NigsWizardState> {
        if (!this.plugin) throw new Error("DB Not Connected");

        if (this.wizardCache) return this.wizardCache;

        const path = `${DATA_FOLDER}/${GLOBAL_WIZARD_FILE}`;
        const adapter = this.plugin.app.vault.adapter;

        const defaults = JSON.parse(JSON.stringify(DEFAULT_WIZARD_STATE));

        if (await adapter.exists(path)) {
            try {
                const json = await adapter.read(path);
                const stored = JSON.parse(json);
                // Merge
                const merged = {
                    ...defaults,
                    ...stored,
                    characters: stored.characters || defaults.characters,
                    structure: stored.structure || defaults.structure,
                    structureDNA: { ...defaults.structureDNA, ...(stored.structureDNA || {}) },
                    sandersonLaws: { ...defaults.sandersonLaws, ...(stored.sandersonLaws || {}) },
                    threePs: { ...defaults.threePs, ...(stored.threePs || {}) },
                    philosopher: { ...defaults.philosopher, ...(stored.philosopher || {}) }
                };
                this.wizardCache = merged;
                return merged;
            } catch (e) {
                console.error("[Compu-Judge] Failed to load Global Wizard Data", e);
                return defaults;
            }
        }

        this.wizardCache = defaults;
        return defaults;
    }

    /**
     * Save GLOBAL Wizard Data
     */
    async saveGlobalWizardData(data: NigsWizardState): Promise<void> {
        if (!this.plugin) return;
        const clean = JSON.parse(JSON.stringify(data));
        this.wizardCache = clean;
        const path = `${DATA_FOLDER}/${GLOBAL_WIZARD_FILE}`;
        await this.plugin.app.vault.adapter.write(path, JSON.stringify(clean, null, 2));
    }

    /**
     * Load GLOBAL Forge Data
     */
    async getGlobalForgeData(): Promise<GlobalForgeData> {
        if (!this.plugin) throw new Error("DB Not Connected");
        if (this.forgeCache) return this.forgeCache;

        const path = `${DATA_FOLDER}/${GLOBAL_FORGE_FILE}`;
        const adapter = this.plugin.app.vault.adapter;

        const defaults: GlobalForgeData = {
            archivistContext: "",
            archivistPrompt: "",
            repairFocus: "",
            lastActionPlan: null,
            referenceText: "" // Default empty
        };

        if (await adapter.exists(path)) {
            try {
                const json = await adapter.read(path);
                const stored = JSON.parse(json);
                const merged = { ...defaults, ...stored };
                this.forgeCache = merged;
                return merged;
            } catch (e) {
                console.error("[Compu-Judge] Failed to load Global Forge Data", e);
                return defaults;
            }
        }

        this.forgeCache = defaults;
        return defaults;
    }

    /**
     * Save GLOBAL Forge Data
     */
    async saveGlobalForgeData(data: GlobalForgeData): Promise<void> {
        if (!this.plugin) return;
        const clean = JSON.parse(JSON.stringify(data));
        this.forgeCache = clean;
        const path = `${DATA_FOLDER}/${GLOBAL_FORGE_FILE}`;
        await this.plugin.app.vault.adapter.write(path, JSON.stringify(clean, null, 2));
    }

    /**
     * Delete all data (Nuclear Option)
     */
    async deleteDatabase() {
        if (!this.plugin) return;
        const adapter = this.plugin.app.vault.adapter;
        
        if (await adapter.exists(DATA_FOLDER)) {
            const files = await adapter.list(DATA_FOLDER);
            for (const file of files.files) {
                await adapter.remove(file);
            }
        }
        
        this.memoryCache.clear();
        this.wizardCache = null;
        this.forgeCache = null;
        this.plugin.settings.projects = {};
        await this.plugin.saveSettings();
    }
}

export const db = new NigsDB();
