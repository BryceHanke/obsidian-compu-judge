/**
 * Debounce utility to limit execution frequency of a function.
 * Useful for autosaving on keystrokes.
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T, 
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    
    return function(...args: Parameters<T>) {
        if (timeout) clearTimeout(timeout);
        
        timeout = setTimeout(() => {
            func(...args);
            timeout = null;
        }, wait);
    };
}

/**
 * Svelte Action: Automatically resizes a textarea to fit its content.
 * Prevents scrollbars in the retro UI.
 */
export function autoResize(node: HTMLTextAreaElement, value: string | undefined) {
    const resize = () => {
        node.style.height = 'auto'; 
        node.style.height = (node.scrollHeight + 2) + 'px'; // +2 for border buffer
    };

    // Resize immediately and on input
    resize();
    node.addEventListener('input', resize);

    return {
        update(newValue: string) {
            resize();
        },
        destroy() {
            node.removeEventListener('input', resize);
        }
    };
}

/**
 * Calculates whether text should be Black or White based on background hex color.
 * Uses YIQ formula for perception to ensure readability on dynamic bars.
 */
export function getContrastColor(hex: string): string {
    // Remove hash if present
    hex = hex.replace('#', '');
    
    // Convert 3-char hex to 6-char
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // Returns black for bright colors, white for dark colors
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}

/**
 * Interpolates color from a 3-point gradient (Start -> Mid -> End)
 * based on score relative to Min/Max.
 */
export function getGradientColor(score: number, min: number, max: number,
    map: { startColor: string; midColor: string; endColor: string }): string
{
    // Clamp score
    const val = Math.max(min, Math.min(max, score));
    const mid = (min + max) / 2;

    const hexToRgb = (hex: string) => {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        return {
            r: parseInt(hex.substr(0, 2), 16),
            g: parseInt(hex.substr(2, 2), 16),
            b: parseInt(hex.substr(4, 2), 16)
        };
    };

    const interp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    const rgbToHex = (r: number, g: number, b: number) =>
        '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

    let c1, c2, t;

    if (val < mid) {
        // Interpolate Start -> Mid
        c1 = hexToRgb(map.startColor);
        c2 = hexToRgb(map.midColor);
        t = (val - min) / (mid - min || 1);
    } else {
        // Interpolate Mid -> End
        c1 = hexToRgb(map.midColor);
        c2 = hexToRgb(map.endColor);
        t = (val - mid) / (max - mid || 1);
    }

    return rgbToHex(interp(c1.r, c2.r, t), interp(c1.g, c2.g, t), interp(c1.b, c2.b, t));
}
