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
        containerEl.createEl('h2', { text: 'BIOS SETUP' });

        // --- 1. AI IDENTITY ---
        new Setting(containerEl)
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
        
        containerEl.createEl('h4', { text: 'Connection Settings' });

        if (this.plugin.settings.aiProvider === 'gemini') {
            new Setting(containerEl)
                .setName('Gemini API Key')
                .addText(text => text.setPlaceholder('AIzaSy...')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (val) => { this.plugin.settings.apiKey = val; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Model ID')
                .addText(text => text.setPlaceholder('gemini-2.0-flash')
                    .setValue(this.plugin.settings.modelId)
                    .onChange(async (val) => { this.plugin.settings.modelId = val; await this.plugin.saveSettings(); }));
        }

        if (this.plugin.settings.aiProvider === 'openai') {
            new Setting(containerEl)
                .setName('OpenAI API Key')
                .addText(text => text.setPlaceholder('sk-...')
                    .setValue(this.plugin.settings.openaiKey)
                    .onChange(async (val) => { this.plugin.settings.openaiKey = val; await this.plugin.saveSettings(); }));
            new Setting(containerEl)
                .setName('Model ID')
                .addText(text => text.setPlaceholder('gpt-4o')
                    .setValue(this.plugin.settings.openaiModel)
                    .onChange(async (val) => { this.plugin.settings.openaiModel = val; await this.plugin.saveSettings(); }));
        }

        if (this.plugin.settings.aiProvider === 'anthropic') {
            new Setting(containerEl)
                .setName('Anthropic API Key')
                .addText(text => text.setPlaceholder('sk-ant-...')
                    .setValue(this.plugin.settings.anthropicKey)
                    .onChange(async (val) => { this.plugin.settings.anthropicKey = val; await this.plugin.saveSettings(); }));
             new Setting(containerEl)
                .setName('Model ID')
                .addText(text => text.setPlaceholder('claude-3-7-sonnet-20250219')
                    .setValue(this.plugin.settings.anthropicModel)
                    .onChange(async (val) => { this.plugin.settings.anthropicModel = val; await this.plugin.saveSettings(); }));
        }

        // --- 2. NEURO-PARAMETERS ---
        containerEl.createEl('h4', { text: 'Intelligence & Quality Control' });

        new Setting(containerEl)
            .setName('AI Intelligence Level (Thinking)')
            .setDesc('1 (Fast/Shallow) to 5 (Deep Thought/Slow). Modulates the amount of reasoning the AI performs.')
            .addSlider(slider => slider
                .setLimits(1, 5, 1)
                .setValue(this.plugin.settings.aiThinkingLevel)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.aiThinkingLevel = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Target Quality')
            .setDesc('The score (0-100) the AI should aim for when generating content (Wizard/Synthesizer default).')
            .addSlider(slider => slider
                .setLimits(0, 100, 5)
                .setValue(this.plugin.settings.defaultTargetQuality)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.defaultTargetQuality = val;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h4', { text: 'Creativity Matrix (Temperature)' });
        
        const mult = this.plugin.settings.tempMultiplier;

        new Setting(containerEl)
            .setName('Global Multiplier (The "Vibe" Slider)')
            .setDesc('Multiplies all settings below. < 1.0 = Rigid, > 1.0 = Chaos.')
            .addSlider(slider => slider
                .setLimits(0.5, 2.0, 0.1)
                .setValue(this.plugin.settings.tempMultiplier)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempMultiplier = val;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        containerEl.createEl('strong', { text: 'Task-Specific Fine Tuning' });
        
        new Setting(containerEl)
            .setName(`Critic (Analysis) - Effective: ${(this.plugin.settings.tempCritic * mult).toFixed(2)}`)
            .setDesc('Low = Objective/Harsh. High = Creative Interpretation.')
            .addSlider(slider => slider
                .setLimits(0.0, 1.0, 0.05)
                .setValue(this.plugin.settings.tempCritic)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempCritic = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(`Wizard (Brainstorming) - Effective: ${(this.plugin.settings.tempWizard * mult).toFixed(2)}`)
            .setDesc('High recommended for original ideas.')
            .addSlider(slider => slider
                .setLimits(0.0, 1.5, 0.05)
                .setValue(this.plugin.settings.tempWizard)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempWizard = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(`Synthesizer (Fusion) - Effective: ${(this.plugin.settings.tempSynth * mult).toFixed(2)}`)
            .setDesc('Controls how aggressively the AI merges conflicting drives.')
            .addSlider(slider => slider
                .setLimits(0.0, 1.5, 0.05)
                .setValue(this.plugin.settings.tempSynth)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempSynth = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(`Architect (Structure) - Effective: ${(this.plugin.settings.tempArchitect * mult).toFixed(2)}`)
            .setDesc('Balance between rigid structure and creative flow.')
            .addSlider(slider => slider
                .setLimits(0.0, 1.2, 0.05)
                .setValue(this.plugin.settings.tempArchitect)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempArchitect = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(`Repair (Editing) - Effective: ${(this.plugin.settings.tempRepair * mult).toFixed(2)}`)
            .setDesc('Low recommended to preserve your voice.')
            .addSlider(slider => slider
                .setLimits(0.0, 1.0, 0.05)
                .setValue(this.plugin.settings.tempRepair)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.tempRepair = val;
                    await this.plugin.saveSettings();
                }));

        // --- 3. NAME POOLS (NEW) ---
        containerEl.createEl('h4', { text: 'Name Pools (Character Generation)' });

        new Setting(containerEl)
            .setName('Name Pool (Preferred Names)')
            .setDesc('Comma-separated list of names the AI should prioritize when generating characters.')
            .addTextArea(text => text
                .setPlaceholder('e.g. Kael, Elara, Thorne, ...')
                .setValue(this.plugin.settings.namePool)
                .onChange(async (val) => {
                    this.plugin.settings.namePool = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Negative Name Pool (Banned Names)')
            .setDesc('Comma-separated list of names the AI must NEVER use.')
            .addTextArea(text => text
                .setPlaceholder('e.g. Dave, Bob, ...')
                .setValue(this.plugin.settings.negativeNamePool)
                .onChange(async (val) => {
                    this.plugin.settings.negativeNamePool = val;
                    await this.plugin.saveSettings();
                }));

        // --- 4. SAFETY & CONSTRAINTS ---
        containerEl.createEl('h4', { text: 'Safety & Constraints' });
        
        new Setting(containerEl)
            .setName('Wizard Negative Constraints')
            .setDesc('What should the AI explicitly AVOID generating? (Anti-Tropes)')
            .addTextArea(text => text
                .setPlaceholder('e.g. Talking Animals, Time Travel, Deus Ex Machina...')
                .setValue(this.plugin.settings.wizardNegativeConstraints)
                .onChange(async (val) => {
                    this.plugin.settings.wizardNegativeConstraints = val;
                    await this.plugin.saveSettings();
                }));

        // --- 5. ADVANCED ---
        containerEl.createEl('h4', { text: 'Hardware Settings' });

        new Setting(containerEl)
            .setName('Max Output Tokens')
            .setDesc('Limit the length of the AI response.')
            .addText(text => text
                .setValue(String(this.plugin.settings.maxOutputTokens))
                .onChange(async (val) => {
                    const num = parseInt(val);
                    if (!isNaN(num)) {
                        this.plugin.settings.maxOutputTokens = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Analysis Cores (Critic)')
            .setDesc('Parallel passes (1-10). Higher = Slower but more accurate averaging.')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.analysisPasses)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.analysisPasses = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Tribunal (Multi-Agent Consensus)')
            .setDesc('Uses 3 specialized agents (Market, Logic, Lit) instead of brute-force averaging. (More tokens, better quality).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTribunal)
                .onChange(async (val) => {
                    this.plugin.settings.enableTribunal = val;
                    await this.plugin.saveSettings();
                }));

        // --- 6. GRADING PALETTE ---
        containerEl.createEl('h4', { text: 'Grading Palette (Gradient Map)' });
        
        const colors = this.plugin.settings.gradingColors;
        
        new Setting(containerEl).setName('Critical (0-20%)').addColorPicker(col => col.setValue(colors.critical)
            .onChange(async v => { colors.critical = v; await this.plugin.saveSettings(); }));
            
        new Setting(containerEl).setName('Poor (20-40%)').addColorPicker(col => col.setValue(colors.poor)
            .onChange(async v => { colors.poor = v; await this.plugin.saveSettings(); }));
            
        new Setting(containerEl).setName('Average (40-60%)').addColorPicker(col => col.setValue(colors.average)
            .onChange(async v => { colors.average = v; await this.plugin.saveSettings(); }));
            
        new Setting(containerEl).setName('Good (60-80%)').addColorPicker(col => col.setValue(colors.good)
            .onChange(async v => { colors.good = v; await this.plugin.saveSettings(); }));
            
        new Setting(containerEl).setName('Excellent (80-90%)').addColorPicker(col => col.setValue(colors.excellent)
            .onChange(async v => { colors.excellent = v; await this.plugin.saveSettings(); }));
            
        new Setting(containerEl).setName('Masterpiece (90%+)').setDesc("Also defines the 'God Mode' glow color.")
            .addColorPicker(col => col.setValue(colors.masterpiece)
            .onChange(async v => { colors.masterpiece = v; await this.plugin.saveSettings(); }));

        // --- 7. SYSTEM OVERRIDE ---
        containerEl.createEl('h4', { text: 'System Override' });
        
        new Setting(containerEl)
            .setName('Custom Critic Prompt')
            .addTextArea(text => text
                .setPlaceholder('You are a harsh literary critic...')
                .setValue(this.plugin.settings.customSystemPrompt)
                .onChange(async (val) => {
                    this.plugin.settings.customSystemPrompt = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Custom Archivist Prompt')
            .addTextArea(text => text
                .setValue(this.plugin.settings.customOutlinePrompt)
                .onChange(async (val) => {
                    this.plugin.settings.customOutlinePrompt = val;
                    await this.plugin.saveSettings();
                }));
    }
}