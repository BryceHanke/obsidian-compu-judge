import type { NigsSettings, ImageInput } from '../types';
import { setStatus } from '../store';

// [UPDATED] GRANDMASTER CALIBRATION (v20.0)
const FORENSIC_CALIBRATION = `
[SYSTEM OVERRIDE: NARRATIVE GRANDMASTER]
[PROTOCOL: THE ZERO-BASED SCORING SYSTEM]

1. **START AT ZERO:** 0 is the baseline for a "technically competent but boring/generic" story.
2. **NO CAP:** Scores can be positive (e.g. +50) or negative (e.g. -50).
3. **ADD POINTS:** Only for specific strengths (Innovation, Voice, Theme).
4. **SUBTRACT POINTS:** For ANY weakness (Plot Holes, Clichés, Confusion).
5. **IGNORE INTENT:** Judge only what is on the page.
`;

// Callback for status updates
export type StatusUpdate = (msg: string, progress?: number) => void;

export interface AIAdapter {
    generate(text: string, systemPrompt?: string, jsonMode?: boolean, useSearch?: boolean, tempOverride?: number, signal?: AbortSignal, images?: ImageInput[], onStatus?: StatusUpdate, modelOverride?: string): Promise<string>;
}

// --- GEMINI ADAPTER ---
export class GeminiAdapter implements AIAdapter {
    constructor(private apiKey: string, private model: string, private settings: NigsSettings) {}

    async generate(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number, signal?: AbortSignal, images?: ImageInput[], onStatus?: StatusUpdate, modelOverride?: string): Promise<string> {
        if (!this.apiKey) throw new Error("MISSING GEMINI API KEY");

        let targetModel = modelOverride || (useSearch ? (this.settings.searchModelId || this.model) : this.model);

        // [FIX]: Sanitize Model ID (remove 'models/' prefix if user added it)
        if (targetModel.startsWith("models/")) {
            targetModel = targetModel.replace("models/", "");
        }

        const temp = tempOverride !== undefined ? tempOverride : 0.7;

        const parts: any[] = [{ text }];

        if (images && images.length > 0) {
            images.forEach(img => {
                parts.push({
                    inlineData: {
                        mimeType: img.mimeType,
                        data: img.data
                    }
                });
            });
        }

        const body: any = {
            contents: [{ role: "user", parts: parts }],
            generationConfig: {
                temperature: temp,
                maxOutputTokens: this.settings.maxOutputTokens
            }
        };

        const baseSys = sys || "";
        const userSys = this.settings.customSystemPrompt ? `[USER OVERRIDE]: ${this.settings.customSystemPrompt}` : FORENSIC_CALIBRATION;
        const thinkingLevel = this.settings.aiThinkingLevel || 3;

        // Inject Thinking Instructions for Gemini if level is high and supported
        let finalSys = `${baseSys}\n${userSys}`;

        // Note: Gemini 2.0 Flash Thinking model handles this natively, but we can nudge standard models
        if (thinkingLevel >= 4) {
             finalSys += "\n[THOUGHT PROCESS]: Think deeply and step-by-step before answering. Consider multiple angles.";
        }

        if (finalSys) body.systemInstruction = { parts: [{ text: finalSys }] };

        if (json && !useSearch) {
            body.generationConfig.responseMimeType = "application/json";
        }

        // Native Thinking Config for compatible models
        const supportsThinking = (targetModel.includes("2.0-flash-thinking") || targetModel.includes("thinking"));
        if (this.settings.showThinking || (thinkingLevel >= 4 && supportsThinking)) {
             body.generationConfig.thinking_config = { include_thoughts: true };
        } else if (useSearch) {
            body.tools = [{ googleSearch: {} }];
        }

        // [OPTIMIZATION]: Drop null fields to save bandwidth
        if (!body.systemInstruction) delete body.systemInstruction;

        const statusMsg = `QUERYING ${targetModel}...`;
        if (onStatus) onStatus(statusMsg);
        else setStatus(statusMsg); // Fallback to global if no callback

        // Check cancellation before request
        if (signal?.aborted) throw new Error("Cancelled by user.");

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${this.apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) {
            let errorBody = "";
            try { errorBody = await res.text(); } catch (e) { /* ignore */ }

            if (res.status === 404) {
                 throw new Error(`GEMINI ERROR 404: Model '${targetModel}' not found. Check Settings > AI Identity > Model ID. Ensure you are using a valid model ID (e.g., 'gemini-2.0-flash').`);
            }
            throw new Error(`GEMINI ERROR ${res.status}: ${res.statusText} \nDetails: ${errorBody.substring(0, 200)}...`);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0];
        if (!candidate?.content?.parts) throw new Error("Empty Response");

        let finalOutput = "";
        let thoughtContent = "";
        for (const part of candidate.content.parts) {
            if (part.text) finalOutput += part.text;
            if (part.thought) thoughtContent += part.text + "\n";
        }

        if (json && thoughtContent && finalOutput.trim().endsWith('}')) {
             const trimmed = finalOutput.trim().replace(/^```json\s*/, "").replace(/```$/, "").replace(/```json/g, "").replace(/```/g, "");
             const lastBrace = trimmed.lastIndexOf('}');
             if (lastBrace > 0) {
                 const base = trimmed.substring(0, lastBrace);
                 return `${base}, "thought_process": ${JSON.stringify(thoughtContent)}}`;
             }
        }

        if (json && !finalOutput.trim()) {
            // Handle case where 'thought' consumes all output but no JSON
            throw new Error("Empty JSON Response from Gemini (Thought-only?)");
        }

        return finalOutput;
    }
}

// --- OPENAI ADAPTER ---
export class OpenAIAdapter implements AIAdapter {
    constructor(private apiKey: string, private model: string, private settings: NigsSettings) {}

    async generate(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number, signal?: AbortSignal, images?: ImageInput[], onStatus?: StatusUpdate, modelOverride?: string): Promise<string> {
        if (!this.apiKey) throw new Error("MISSING OPENAI API KEY");

        const targetModel = modelOverride || this.model;
        const statusMsg = `CONNECTING TO OPENAI (${targetModel})...`;
        if (onStatus) onStatus(statusMsg);
        else setStatus(statusMsg);

        const baseSys = sys || "";
        const userSys = this.settings.customSystemPrompt ? `[USER OVERRIDE]: ${this.settings.customSystemPrompt}` : FORENSIC_CALIBRATION;

        const content: any[] = [{ type: "text", text: text }];

        if (images && images.length > 0) {
             images.forEach(img => {
                 content.push({
                     type: "image_url",
                     image_url: {
                         url: `data:${img.mimeType};base64,${img.data}`
                     }
                 });
             });
        }

        const body: any = {
            model: targetModel,
            messages: [{ role: "system", content: `${baseSys}\n${userSys}` }, { role: "user", content: content }],
            temperature: tempOverride !== undefined ? tempOverride : 0.7,
            max_tokens: this.settings.maxOutputTokens,
            response_format: json ? { type: "json_object" } : undefined
        };

        if (signal?.aborted) throw new Error("Cancelled by user.");

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) throw new Error(`OPENAI ERROR ${res.status}`);
        const data = await res.json();
        return data.choices[0].message.content;
    }
}

// --- ANTHROPIC ADAPTER ---
export class AnthropicAdapter implements AIAdapter {
    constructor(private apiKey: string, private model: string, private settings: NigsSettings) {}

    async generate(text: string, sys?: string, json = true, useSearch = false, tempOverride?: number, signal?: AbortSignal, images?: ImageInput[], onStatus?: StatusUpdate, modelOverride?: string): Promise<string> {
        if (!this.apiKey) throw new Error("MISSING ANTHROPIC API KEY");

        const targetModel = modelOverride || this.model;
        const statusMsg = `CONNECTING TO CLAUDE (${targetModel})...`;
        if (onStatus) onStatus(statusMsg);
        else setStatus(statusMsg);

        const baseSys = sys || "";
        const userSys = this.settings.customSystemPrompt ? `[USER OVERRIDE]: ${this.settings.customSystemPrompt}` : FORENSIC_CALIBRATION;

        const content: any[] = [{ type: "text", text: text }];

        if (images && images.length > 0) {
            images.forEach(img => {
                content.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: img.mimeType,
                        data: img.data
                    }
                });
            });
        }

        const body: any = {
            model: targetModel,
            max_tokens: this.settings.maxOutputTokens,
            system: `${baseSys}\n${userSys}`,
            messages: [{ role: "user", content: content }],
            temperature: tempOverride !== undefined ? tempOverride : 0.7
        };

        if (json) body.messages.push({ role: "assistant", content: "{" });

        if (signal?.aborted) throw new Error("Cancelled by user.");

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) throw new Error(`ANTHROPIC ERROR ${res.status}`);

        const data = await res.json();
        let textOutput = "";
        for (const block of data.content) {
            if (block.type === 'text') textOutput += block.text;
        }
        return json && !textOutput.trim().startsWith("{") ? "{" + textOutput : textOutput;
    }
}
