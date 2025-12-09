import { App, TFolder, TFile } from 'obsidian';

export class LogService {
    private static readonly LOG_FILE_PATH = '.compu-judge-log.json';

    static async log(app: App, enabled: boolean, type: string, data: any) {
        if (!enabled) return;

        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            type,
            data
        };

        try {
            let logs: any[] = [];

            // Check if file exists
            if (await app.vault.adapter.exists(this.LOG_FILE_PATH)) {
                const content = await app.vault.adapter.read(this.LOG_FILE_PATH);
                try {
                    logs = JSON.parse(content);
                    if (!Array.isArray(logs)) logs = [];
                } catch (e) {
                    logs = []; // corrupted or empty
                }
            }

            // Append new log (limit to last 100 entries to prevent massive files)
            logs.push(entry);
            if (logs.length > 100) {
                logs = logs.slice(-100);
            }

            await app.vault.adapter.write(this.LOG_FILE_PATH, JSON.stringify(logs, null, 2));

        } catch (e) {
            console.error("Compu-Judge Logging Failed:", e);
        }
    }

    static async getLogs(app: App): Promise<any[]> {
        if (await app.vault.adapter.exists(this.LOG_FILE_PATH)) {
            const content = await app.vault.adapter.read(this.LOG_FILE_PATH);
            try {
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    static async clearLogs(app: App) {
        if (await app.vault.adapter.exists(this.LOG_FILE_PATH)) {
            await app.vault.adapter.write(this.LOG_FILE_PATH, "[]");
        }
    }
}
