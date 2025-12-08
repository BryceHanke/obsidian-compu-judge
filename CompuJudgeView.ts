import { ItemView, WorkspaceLeaf, type App, TFile } from "obsidian";
import { mount, unmount } from "svelte";
import GradingPanel from "./GradingPanel.svelte";
import type { CloudGenService } from "./CloudGen";
import type { NigsSettings } from "./types";
import type CompuJudgePlugin from "./main";

export const VIEW_TYPE_COMPU_JUDGE = "compu-judge-view";

export class CompuJudgeView extends ItemView {
    component: any; 
    app: App;
    settings: NigsSettings;
    cloud: CloudGenService;
    plugin: CompuJudgePlugin;

    constructor(leaf: WorkspaceLeaf, app: App, settings: NigsSettings, cloud: CloudGenService, plugin: CompuJudgePlugin) {
        super(leaf);
        this.app = app;
        this.settings = settings;
        this.cloud = cloud;
        this.plugin = plugin;
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
        // Checking if component instance has the method (Svelte 5 component instance might expose exports differently depending on compilation)
        // But props are reactive in Svelte 5 so we might need to pass file as a prop update or use store.
        // For now, assume the component handles it or the logic is inside GradingPanel via App.
    }
    
    updateTheme(theme: string) {
       // Not used currently
    }
}
