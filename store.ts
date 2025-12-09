import { writable } from 'svelte/store';

export interface ActiveProcess {
    id: string;
    label: string;
    status: string;
    progress: number; // 0-100
    startTime: number;
    estimatedDuration: number;
    abortController: AbortController;
}

// Global store for all active processes
export const activeProcesses = writable<Record<string, ActiveProcess>>({});

// Legacy stores (kept for compatibility if needed, but we should migrate)
export const processRegistry = writable<Record<string, boolean>>({});
export const processOrigin = writable<Record<string, string>>({});
export const statusMessage = writable<string>("PROCESSING...");

export function startProcess(id: string, label: string, duration: number): AbortController {
    const controller = new AbortController();

    activeProcesses.update(procs => ({
        ...procs,
        [id]: {
            id,
            label,
            status: label,
            progress: 0,
            startTime: Date.now(),
            estimatedDuration: duration,
            abortController: controller
        }
    }));

    // Maintain legacy compatibility for now
    processRegistry.update(p => ({ ...p, [id]: true }));
    statusMessage.set(label);

    return controller;
}

export function updateProcessStatus(id: string, status: string, progress?: number) {
    activeProcesses.update(procs => {
        if (procs[id]) {
            return {
                ...procs,
                [id]: {
                    ...procs[id],
                    status,
                    progress: progress !== undefined ? progress : procs[id].progress
                }
            };
        }
        return procs;
    });
    // Legacy
    statusMessage.set(status);
}

export function cancelProcess(id: string) {
    activeProcesses.update(procs => {
        if (procs[id]) {
            procs[id].abortController.abort();
            // We don't remove it immediately, UI handles that or finishProcess does
            // But usually cancellation implies finishing
            const { [id]: _, ...rest } = procs;
            return rest;
        }
        return procs;
    });

    // Legacy
    processRegistry.update(p => ({ ...p, [id]: false }));
    statusMessage.set("READY");
}

export function finishProcess(id: string) {
    activeProcesses.update(procs => {
        const { [id]: _, ...rest } = procs;
        return rest;
    });

    // Legacy
    processRegistry.update(p => ({ ...p, [id]: false }));
    statusMessage.set("READY");
}

// Helpers for legacy support (if any components still use them directly)
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
