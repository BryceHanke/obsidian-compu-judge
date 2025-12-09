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
        // [FIX]: Prevent clearing state when clicking the plugin pane itself
        if (!file) {
            const activeLeaf = this.app.workspace.activeLeaf;
            // If the active leaf is the CompuJudge view, ignore the null update
            if (activeLeaf?.view.getViewType() === VIEW_TYPE_COMPU_JUDGE) {
                return;
            }
        }

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
        this.settings.gradientMap = { ...DEFAULT_SETTINGS.gradientMap, ...this.settings.gradientMap };
        
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

        // Ensure new Agent settings exist
        if (this.settings.wizardAgentEnabled === undefined) this.settings.wizardAgentEnabled = true;
        if (this.settings.synthAgentEnabled === undefined) this.settings.synthAgentEnabled = true;
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
        containerEl.addClass('nigs-settings-container');

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
            this.addTextInput(containerEl, 'Search Model ID (Optional)', 'Leave empty to use Model ID', this.plugin.settings.searchModelId, async (val) => {
                 this.plugin.settings.searchModelId = val; await this.plugin.saveSettings();
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

        const optimizationSetting = new Setting(containerEl)
            .setName('Optimization Mode')
            .setDesc('Choose between Quality (Slower, More Accurate) or Speed (Faster, Less Detailed).')
            .addDropdown(drop => drop
                .addOption('Speed', 'Speed (Sacrifice Accuracy)')
                .addOption('Balanced', 'Balanced (Default)')
                .addOption('Quality', 'Quality (Maximum Reasoning)')
                .setValue(this.plugin.settings.optimizationMode)
                .onChange(async (val) => {
                    this.plugin.settings.optimizationMode = val as 'Speed' | 'Balanced' | 'Quality';
                    await this.plugin.saveSettings();
                }));
        this.styleDropdown(optimizationSetting);

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
            .setName('Enable Logging')
            .setDesc('Save all inputs/outputs to a hidden file for tuning.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableLogging)
                .onChange(async (val) => {
                    this.plugin.settings.enableLogging = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Tribunal')
            .setDesc('Use 5-Agent Consensus System.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTribunal)
                .onChange(async (val) => {
                    this.plugin.settings.enableTribunal = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Critic Cores')
            .setDesc('Number of parallel analysis cores (Legacy) or Max Retries (Tribunal).')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.criticCores)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.criticCores = val;
                    // Map this to maxRetries for Tribunal to keep consistency with user request
                    this.plugin.settings.tribunalMaxRetries = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Arbitration Enabled')
            .setDesc('Allow Chief Justice to adjust scores based on Logic/Soul/Market.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.arbitrationEnabled)
                .onChange(async (val) => {
                    this.plugin.settings.arbitrationEnabled = val;
                    await this.plugin.saveSettings();
                }));

        // --- NEW AGENTS CONFIG ---
        this.addSectionHeader(containerEl, 'THINKING AGENTS');

        new Setting(containerEl)
            .setName('Wizard "Creative Consultant"')
            .setDesc('Enable a secondary agent to critique wizard suggestions before showing them.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.wizardAgentEnabled)
                .onChange(async (val) => {
                    this.plugin.settings.wizardAgentEnabled = val;
                    await this.plugin.saveSettings();
                }));

         new Setting(containerEl)
            .setName('Synth "Structural Architect"')
            .setDesc('Enable a secondary agent to review the fusion plan before final output.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.synthAgentEnabled)
                .onChange(async (val) => {
                    this.plugin.settings.synthAgentEnabled = val;
                    await this.plugin.saveSettings();
                }));


        // --- AGENT WEIGHTS ---
        this.addSectionHeader(containerEl, 'AGENT WEIGHTS');

        new Setting(containerEl)
            .setName('Logic Weight')
            .setDesc('Importance of Logic Agent.')
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.plugin.settings.agentWeights.logic)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.agentWeights.logic = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Soul Weight')
            .setDesc('Importance of Soul Agent (Vibe/Enjoyment).')
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.plugin.settings.agentWeights.soul)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.agentWeights.soul = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Market Weight')
            .setDesc('Importance of Market Agent.')
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.plugin.settings.agentWeights.market)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.agentWeights.market = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Lit Weight')
            .setDesc('Importance of Literary Agent.')
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.plugin.settings.agentWeights.lit)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.agentWeights.lit = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Jester Weight')
            .setDesc('Importance of Jester (Roast) Agent.')
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.plugin.settings.agentWeights.jester)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.agentWeights.jester = val;
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

        new Setting(containerEl).setName('Critic Temp').setDesc('0.1 - 1.0').addSlider(s => s.setLimits(0.1, 1.0, 0.1).setValue(this.plugin.settings.tempCritic).setDynamicTooltip().onChange(async v => { this.plugin.settings.tempCritic = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Wizard Temp').setDesc('0.1 - 1.0').addSlider(s => s.setLimits(0.1, 1.0, 0.1).setValue(this.plugin.settings.tempWizard).setDynamicTooltip().onChange(async v => { this.plugin.settings.tempWizard = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Architect Temp').setDesc('0.1 - 1.0').addSlider(s => s.setLimits(0.1, 1.0, 0.1).setValue(this.plugin.settings.tempArchitect).setDynamicTooltip().onChange(async v => { this.plugin.settings.tempArchitect = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Repair Temp').setDesc('0.1 - 1.0').addSlider(s => s.setLimits(0.1, 1.0, 0.1).setValue(this.plugin.settings.tempRepair).setDynamicTooltip().onChange(async v => { this.plugin.settings.tempRepair = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Synthesizer Temp').setDesc('0.1 - 1.5').addSlider(s => s.setLimits(0.1, 1.5, 0.1).setValue(this.plugin.settings.tempSynth).setDynamicTooltip().onChange(async v => { this.plugin.settings.tempSynth = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Luck Tolerance')
            .setDesc('Tolerance for luck/coincidence (0-10).')
            .addSlider(slider => slider
                .setLimits(0, 10, 1)
                .setValue(this.plugin.settings.luckTolerance)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.luckTolerance = val;
                    await this.plugin.saveSettings();
                }));

        // --- 2.5 SAFETY & CONSTRAINTS ---
        this.addSectionHeader(containerEl, 'SAFETY & CONSTRAINTS');

        new Setting(containerEl)
            .setName('Wizard Negative Constraints')
            .setDesc('Things for the Wizard to avoid.')
            .addTextArea(text => text
                .setPlaceholder('Avoid: Deus Ex Machina...')
                .setValue(this.plugin.settings.wizardNegativeConstraints)
                .onChange(async (val) => {
                    this.plugin.settings.wizardNegativeConstraints = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Forge Image Batch Size')
            .setDesc('Number of images to process per batch (default 10).')
            .addSlider(slider => slider
                .setLimits(1, 50, 1)
                .setValue(this.plugin.settings.forgeImageBatchLength)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.forgeImageBatchLength = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Preferred Name Pool')
            .setDesc('Comma-separated list of preferred names.')
            .addTextArea(text => text
                .setPlaceholder('Alice, Bob, Charlie...')
                .setValue(this.plugin.settings.namePool)
                .onChange(async (val) => {
                    this.plugin.settings.namePool = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Negative Name Pool')
            .setDesc('Comma-separated list of banned names.')
            .addTextArea(text => text
                .setPlaceholder('X Æ A-12, ...')
                .setValue(this.plugin.settings.negativeNamePool)
                .onChange(async (val) => {
                    this.plugin.settings.negativeNamePool = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Disable Rainbows')
            .setDesc('Disable rainbow text effects.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.disableRainbows)
                .onChange(async (val) => {
                    this.plugin.settings.disableRainbows = val;
                    await this.plugin.saveSettings();
                    // Force refresh view to apply setting immediately
                    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_COMPU_JUDGE).forEach(leaf => {
                        if (leaf.view instanceof CompuJudgeView) {
                            leaf.view.settings = this.plugin.settings;
                        }
                    });
                }));

        // --- 6. GRADING PALETTE (GRADIENT MAP) ---
        this.addSectionHeader(containerEl, 'GRADING PALETTE (GRADIENT MAP)');
        
        new Setting(containerEl)
            .setName('Score Gradient Start (Min)')
            .setDesc('Color for lowest scores.')
            .addColorPicker(col => col.setValue(this.plugin.settings.gradientMap.startColor)
            .onChange(async v => { this.plugin.settings.gradientMap.startColor = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Score Gradient Mid (Avg)')
            .setDesc('Color for average scores.')
            .addColorPicker(col => col.setValue(this.plugin.settings.gradientMap.midColor)
            .onChange(async v => { this.plugin.settings.gradientMap.midColor = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Score Gradient End (Max)')
            .setDesc('Color for masterpiece scores.')
            .addColorPicker(col => col.setValue(this.plugin.settings.gradientMap.endColor)
            .onChange(async v => { this.plugin.settings.gradientMap.endColor = v; await this.plugin.saveSettings(); }));

        const colors = this.plugin.settings.gradingColors;
        new Setting(containerEl).setName('Legacy Masterpiece (90%+)').addColorPicker(col => col.setValue(colors.masterpiece)
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
