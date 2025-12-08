import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, type NigsSettings, type AIProvider } from './types';
import { CloudGenService } from './CloudGen';
import { CompuJudgeView, VIEW_TYPE_COMPU_JUDGE } from './CompuJudgeView';
import { db } from './db';
import { compuJudgeHud } from './editor-extension';

export default class CompuJudgePlugin extends Plugin {
    settings: NigsSettings;
    cloud: CloudGenService;

    async onload() {
        // 1. Load Global Settings
        await this.loadSettings();
        
        // 2. Initialize DB
        db.connect(this);
        await db.init();

        this.registerEditorExtension(compuJudgeHud);

        this.cloud = new CloudGenService(this.app, this.settings);

        this.registerView(
            VIEW_TYPE_COMPU_JUDGE,
            (leaf) => new CompuJudgeView(leaf, this.app, this.settings, this.cloud, this)
        );

        this.addRibbonIcon('bot', 'Compu-Judge 98', () => this.activateView());
        
        this.addCommand({
            id: 'open-compu-judge',
            name: 'Open Interface',
            callback: () => this.activateView()
        });

        this.addCommand({
            id: 'purge-db',
            name: 'DEBUG: Purge Database',
            callback: async () => {
                if(window.confirm("Delete all saved scan data? This cannot be undone.")) {
                    await db.deleteDatabase();
                    new Notice("Database Purged. Please Restart Obsidian.");
                }
            }
        });

        this.addSettingTab(new NigsSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const file = this.app.workspace.getActiveFile();
                this.updateViewFile(file);
            })
        );
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_COMPU_JUDGE)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: VIEW_TYPE_COMPU_JUDGE, active: true });
        }
        if (leaf) workspace.revealLeaf(leaf);
    }
    
    updateViewFile(file: TFile | null) {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMPU_JUDGE);
        leaves.forEach(leaf => {
            if (leaf.view instanceof CompuJudgeView) leaf.view.updateActiveFile(file);
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        
        if (this.settings.temperature !== undefined && this.settings.tempCritic === 0.1) {
            delete this.settings.temperature; 
            await this.saveSettings();
        }

        this.settings.gradingColors = { ...DEFAULT_SETTINGS.gradingColors, ...this.settings.gradingColors };
        
        if (!this.settings.drives) {
            this.settings.drives = [];
        }

        if (this.settings.tempSynth === undefined) {
            this.settings.tempSynth = 1.0;
        }

        // Ensure Name Pools exist
        if (this.settings.namePool === undefined) this.settings.namePool = "";
        if (this.settings.negativeNamePool === undefined) this.settings.negativeNamePool = "";

        // Ensure Tribunal Config exists
        if (this.settings.tribunalConfiguration === undefined) this.settings.tribunalConfiguration = 'Parallel';
    }

    async saveSettings() {
        const cleanSettings = { ...this.settings };
        cleanSettings.projects = {}; 
        
        await this.saveData(cleanSettings);
        
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMPU_JUDGE);
        leaves.forEach(leaf => {
             if (leaf.view instanceof CompuJudgeView) {
                 leaf.view.settings = this.settings; 
             }
        });
    }
}

class NigsSettingTab extends PluginSettingTab {
    plugin: CompuJudgePlugin;
    constructor(app: App, plugin: CompuJudgePlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // WIN95 HEADER
        const header = containerEl.createEl('div', { cls: 'win95-titlebar', style: 'margin-bottom: 20px;' });
        header.createEl('div', { text: 'BIOS SETUP UTILITY', cls: 'win95-titlebar-text' });

        // --- 1. AI IDENTITY ---
        this.addSectionHeader(containerEl, 'AI IDENTITY');

        const providerSetting = new Setting(containerEl)
            .setName('AI Provider')
            .setDesc('Select your intelligence engine.')
            .addDropdown(drop => drop
                .addOption('gemini', 'Google Gemini')
                .addOption('openai', 'OpenAI (ChatGPT)')
                .addOption('anthropic', 'Anthropic (Claude)')
                .setValue(this.plugin.settings.aiProvider)
                .onChange(async (val) => {
                    this.plugin.settings.aiProvider = val as AIProvider;
                    await this.plugin.saveSettings();
                    this.display(); 
                }));
        
        this.styleDropdown(providerSetting);

        if (this.plugin.settings.aiProvider === 'gemini') {
            this.addTextInput(containerEl, 'Gemini API Key', 'AIzaSy...', this.plugin.settings.apiKey, async (val) => {
                 this.plugin.settings.apiKey = val; await this.plugin.saveSettings();
            });
            this.addTextInput(containerEl, 'Model ID', 'gemini-2.0-flash', this.plugin.settings.modelId, async (val) => {
                 this.plugin.settings.modelId = val; await this.plugin.saveSettings();
            });
        }

        if (this.plugin.settings.aiProvider === 'openai') {
            this.addTextInput(containerEl, 'OpenAI API Key', 'sk-...', this.plugin.settings.openaiKey, async (val) => {
                 this.plugin.settings.openaiKey = val; await this.plugin.saveSettings();
            });
             this.addTextInput(containerEl, 'Model ID', 'gpt-4o', this.plugin.settings.openaiModel, async (val) => {
                 this.plugin.settings.openaiModel = val; await this.plugin.saveSettings();
            });
        }

        if (this.plugin.settings.aiProvider === 'anthropic') {
            this.addTextInput(containerEl, 'Anthropic API Key', 'sk-ant-...', this.plugin.settings.anthropicKey, async (val) => {
                 this.plugin.settings.anthropicKey = val; await this.plugin.saveSettings();
            });
             this.addTextInput(containerEl, 'Model ID', 'claude-3-7-sonnet-20250219', this.plugin.settings.anthropicModel, async (val) => {
                 this.plugin.settings.anthropicModel = val; await this.plugin.saveSettings();
            });
        }

        // --- TRIBUNAL CONFIG ---
        this.addSectionHeader(containerEl, 'TRIBUNAL CONFIGURATION');

        const tribunalConfig = new Setting(containerEl)
            .setName('Execution Mode')
            .setDesc('Parallel (Faster) or Iterative (Sequential Chain).')
            .addDropdown(drop => drop
                .addOption('Parallel', 'Parallel Processing')
                .addOption('Iterative', 'Iterative Chaining')
                .setValue(this.plugin.settings.tribunalConfiguration)
                .onChange(async (val) => {
                    this.plugin.settings.tribunalConfiguration = val as 'Parallel' | 'Iterative';
                    await this.plugin.saveSettings();
                }));
        this.styleDropdown(tribunalConfig);

        new Setting(containerEl)
            .setName('Enable Tribunal')
            .setDesc('Use 5-Agent Consensus System.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTribunal)
                .onChange(async (val) => {
                    this.plugin.settings.enableTribunal = val;
                    await this.plugin.saveSettings();
                }));

        // --- 2. NEURO-PARAMETERS ---
        this.addSectionHeader(containerEl, 'NEURO-PARAMETERS');

        new Setting(containerEl)
            .setName('AI Intelligence Level')
            .setDesc('Thinking Effort (1-5).')
            .addSlider(slider => slider
                .setLimits(1, 5, 1)
                .setValue(this.plugin.settings.aiThinkingLevel)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.aiThinkingLevel = val;
                    await this.plugin.saveSettings();
                }));

         new Setting(containerEl)
            .setName('Temperature Multiplier')
            .setDesc('Chaos Factor (0.5 - 2.0).')
            .addSlider(slider => slider
                .setLimits(0.5, 2.0, 0.1)
                .setValue(this.plugin.settings.tempMultiplier)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempMultiplier = val;
                    await this.plugin.saveSettings();
                }));


        // --- 6. GRADING PALETTE ---
        this.addSectionHeader(containerEl, 'GRADING PALETTE');
        
        const colors = this.plugin.settings.gradingColors;
        new Setting(containerEl).setName('Masterpiece (90%+)').addColorPicker(col => col.setValue(colors.masterpiece)
            .onChange(async v => { colors.masterpiece = v; await this.plugin.saveSettings(); }));

        // --- 7. SYSTEM OVERRIDE ---
        this.addSectionHeader(containerEl, 'SYSTEM OVERRIDE');
        
        new Setting(containerEl)
            .setName('Custom Critic Prompt')
            .addTextArea(text => text
                .setPlaceholder('Override System Prompt...')
                .setValue(this.plugin.settings.customSystemPrompt)
                .onChange(async (val) => {
                    this.plugin.settings.customSystemPrompt = val;
                    await this.plugin.saveSettings();
                }));
    }

    // HELPER: Apply Retro Styles
    private styleDropdown(setting: Setting) {
        const el = setting.controlEl.querySelector('select');
        if (el) el.addClass('retro-select');
    }

    private addTextInput(el: HTMLElement, name: string, placeholder: string, value: string, cb: (val: string) => void) {
        const s = new Setting(el).setName(name);
        s.addText(text => text.setPlaceholder(placeholder).setValue(value).onChange(cb));
        const input = s.controlEl.querySelector('input');
        if (input) input.addClass('retro-input');
    }

    private addSectionHeader(el: HTMLElement, text: string) {
        el.createEl('h4', { text: text, style: 'border-bottom: 2px solid #808080; color: #000080; margin-top: 20px;' });
    }
}
