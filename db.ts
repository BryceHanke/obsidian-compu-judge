import { TFile, TFolder, normalizePath, type Plugin } from 'obsidian';
import { DEFAULT_WIZARD_STATE, type ProjectData, type NigsSettings, DEFAULT_SETTINGS } from './types';
import type CompuJudgePlugin from './main';

const DATA_FOLDER = '.compu-judge';

export class NigsDB {
    private plugin: CompuJudgePlugin | null = null;
    private memoryCache: Map<string, ProjectData> = new Map();

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
                return cleanDefaults;
            }
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
        this.plugin.settings.projects = {};
        await this.plugin.saveSettings();
    }
}

export const db = new NigsDB();