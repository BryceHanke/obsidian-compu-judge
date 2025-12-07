import { ItemView, WorkspaceLeaf, type App, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import GradingPanel from "./GradingPanel.svelte";
import type { CloudGenService } from "./CloudGen";
import type { NigsSettings } from "./types";
import type CompuJudgePlugin from "./main";
import type { AudioEngine } from "./AudioEngine"; // NEW

export const VIEW_TYPE_COMPU_JUDGE = "compu-judge-view";

export class CompuJudgeView extends ItemView {
    component: any; 
    app: App;
    settings: NigsSettings;
    cloud: CloudGenService;
    plugin: CompuJudgePlugin;
    audio: AudioEngine; // NEW

    constructor(leaf: WorkspaceLeaf, app: App, settings: NigsSettings, cloud: CloudGenService, plugin: CompuJudgePlugin, audio: AudioEngine) {
        super(leaf);
        this.app = app;
        this.settings = settings;
        this.cloud = cloud;
        this.plugin = plugin;
        this.audio = audio; // NEW
    }

    getViewType() {
        return VIEW_TYPE_COMPU_JUDGE;
    }

    getDisplayText() {
        return "Compu-Judge 98";
    }

    getIcon() {
        return "bot";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        
        // Svelte 5 Mounting
        this.component = mount(GradingPanel, {
            target: container,
            props: {
                app: this.app,
                cloud: this.cloud,
                settings: this.settings,
                audio: this.audio, // NEW: Pass AudioEngine
                onUpdateSettings: async (newSettings: Partial<NigsSettings>) => {
                    Object.assign(this.settings, newSettings);
                    Object.assign(this.plugin.settings, newSettings);
                    await this.plugin.saveSettings();
                }
            }
        });
    }

    async onClose() {
        if (this.component) {
            unmount(this.component);
        }
    }
    
    updateActiveFile(file: TFile | null) {
        if (this.component && this.component.updateActiveFile) {
            this.component.updateActiveFile(file);
        }
    }
    
    updateTheme(theme: string) {
        if (this.component && this.component.updateTheme) {
            this.component.updateTheme(theme);
        }
    }
}