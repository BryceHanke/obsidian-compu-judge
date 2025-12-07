import { writable } from 'svelte/store';

// Tracks which files are currently being analyzed
// Key: filePath, Value: boolean (is loading?)
export const processRegistry = writable<Record<string, boolean>>({});

// Tracks which tab initiated the process (critic, wizard, forge)
// Key: filePath, Value: tabId
export const processOrigin = writable<Record<string, string>>({});

// Global status message for the loading bar text
export const statusMessage = writable<string>("PROCESSING...");

export function setFileLoading(path: string, isLoading: boolean, originTab?: string) {
    processRegistry.update(current => ({
        ...current,
        [path]: isLoading
    }));
    
    if (isLoading && originTab) {
        processOrigin.update(current => ({
            ...current,
            [path]: originTab
        }));
    } else if (!isLoading) {
        statusMessage.set("READY");
    }
}

export function setStatus(msg: string) {
    statusMessage.set(msg);
}