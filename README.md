# Compu-Judge 98 (v6.0.0)

A retro-styled AI narrative assistant for Obsidian. Features a Win95 aesthetic, parallel AI processing, and a dedicated "Action Plan" forge.

## 💾 Installation

1. Clone this repo into your `.obsidian/plugins/` folder.
2. Run `npm install`.
3. Run `npm run dev`.
4. Enable "Compu-Judge 98" in Obsidian Settings.

## ⚙️ Configuration (BIOS SETUP)

* **API KEY:** You need a Google Gemini API Key (AI Studio).
* **THEME:** Select "Win95" (Light), "Y2K" (Dark), or Auto.
* **CORES:** Set between 1-10. Higher cores = higher accuracy but slower speed.

## 🕹️ Usage

### 1. The Critic
* Open a file (Script or Story).
* Click **RUN ANALYSIS**.
* **System Diagnostic:** Runs a meta-analysis on the story structure itself.

### 2. The Wizard (Ghostwriter)
* Fill out the "Story DNA" fields (Philosopher, Psychologist, Architect).
* **Target Score:** The AI will attempt to hit this metric.
* **Generate Synopsis:** Clicking this creates a `_SYNOPSIS.md` file based on your form data.

### 3. The Forge
* Click **GENERATE REPAIR PLAN**.
* The AI identifies the single weakest link in your text and provides 3 concrete steps to fix it.

## ⚠️ Troubleshooting "Read Errors"
If you see persistent **Read Errors** or **Database Locked** alerts:
1. Open the Obsidian Command Palette (`Ctrl/Cmd + P`).
2. Type: `Purge Database`.
3. Select `DEBUG: Purge Database`.
4. **Restart Obsidian**.
*This wipes the local IndexedDB cache and forces a schema reset.*