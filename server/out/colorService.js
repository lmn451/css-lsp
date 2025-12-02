"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseColor = parseColor;
exports.formatColor = formatColor;
exports.formatColorAsHex = formatColorAsHex;
exports.formatColorAsRgb = formatColorAsRgb;
exports.formatColorAsHsl = formatColorAsHsl;
/**
 * Parse a CSS color string into an LSP Color object.
 * Supports hex, rgb, rgba, hsl, hsla, and named colors.
 */
function parseColor(value) {
    value = value.trim().toLowerCase();
    // Hex
    if (value.startsWith('#')) {
        return parseHex(value);
    }
    // RGB / RGBA
    if (value.startsWith('rgb')) {
        return parseRgb(value);
    }
    // HSL / HSLA
    if (value.startsWith('hsl')) {
        return parseHsl(value);
    }
    // Named colors
    return parseNamedColor(value);
}
/**
 * Format an LSP Color object back into a CSS string.
 * Defaults to Hex if alpha is 1, otherwise rgba.
 */
function formatColor(color) {
    const r = Math.round(color.red * 255);
    const g = Math.round(color.green * 255);
    const b = Math.round(color.blue * 255);
    const a = color.alpha;
    if (a >= 1) {
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    else {
        return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})`;
    }
}
/**
 * Format color as hex (with alpha if not fully opaque)
 */
function formatColorAsHex(color) {
    const r = Math.round(color.red * 255);
    const g = Math.round(color.green * 255);
    const b = Math.round(color.blue * 255);
    const a = Math.round(color.alpha * 255);
    if (a >= 255) {
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    else {
        return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
    }
}
/**
 * Format color as rgb() or rgba()
 */
function formatColorAsRgb(color) {
    const r = Math.round(color.red * 255);
    const g = Math.round(color.green * 255);
    const b = Math.round(color.blue * 255);
    const a = color.alpha;
    if (a >= 1) {
        return `rgb(${r}, ${g}, ${b})`;
    }
    else {
        return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})`;
    }
}
/**
 * Format color as hsl() or hsla()
 */
function formatColorAsHsl(color) {
    const { h, s, l } = rgbToHsl(color.red, color.green, color.blue);
    const a = color.alpha;
    const hDeg = Math.round(h * 360);
    const sPercent = Math.round(s * 100);
    const lPercent = Math.round(l * 100);
    if (a >= 1) {
        return `hsl(${hDeg}, ${sPercent}%, ${lPercent}%)`;
    }
    else {
        return `hsla(${hDeg}, ${sPercent}%, ${lPercent}%, ${Number(a.toFixed(2))})`;
    }
}
/**
 * Convert RGB to HSL
 */
function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) {
        return { h: 0, s: 0, l };
    }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    }
    else if (max === g) {
        h = ((b - r) / d + 2) / 6;
    }
    else {
        h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
}
function toHex(n) {
    const hex = n.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
}
function parseHex(hex) {
    hex = hex.substring(1); // Remove #
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length !== 6 && hex.length !== 8) {
        return null;
    }
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    let a = 1;
    if (hex.length === 8) {
        a = parseInt(hex.substring(6, 8), 16) / 255;
    }
    return { red: r, green: g, blue: b, alpha: a };
}
function parseRgb(value) {
    const match = value.match(/rgba?\(([\d\s\.]+),?\s*([\d\s\.]+),?\s*([\d\s\.]+)(?:,?\s*\/?,?\s*([\d\s\.]+))?\)/);
    if (!match)
        return null;
    const r = parseFloat(match[1]) / 255;
    const g = parseFloat(match[2]) / 255;
    const b = parseFloat(match[3]) / 255;
    let a = 1;
    if (match[4]) {
        a = parseFloat(match[4]);
    }
    return { red: r, green: g, blue: b, alpha: a };
}
function parseHsl(value) {
    const match = value.match(/hsla?\(([\d\s\.]+)(?:deg)?,?\s*([\d\s\.]+)%?,?\s*([\d\s\.]+)%?(?:,?\s*\/?,?\s*([\d\s\.]+))?\)/);
    if (!match)
        return null;
    const h = parseFloat(match[1]) / 360;
    const s = parseFloat(match[2]) / 100;
    const l = parseFloat(match[3]) / 100;
    let a = 1;
    if (match[4]) {
        a = parseFloat(match[4]);
    }
    return hslToRgb(h, s, l, a);
}
function hslToRgb(h, s, l, a) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l; // achromatic
    }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0)
                t += 1;
            if (t > 1)
                t -= 1;
            if (t < 1 / 6)
                return p + (q - p) * 6 * t;
            if (t < 1 / 2)
                return q;
            if (t < 2 / 3)
                return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return { red: r, green: g, blue: b, alpha: a };
}
function parseNamedColor(name) {
    const colors = {
        black: '#000000',
        white: '#ffffff',
        red: '#ff0000',
        green: '#008000',
        blue: '#0000ff',
        yellow: '#ffff00',
        cyan: '#00ffff',
        magenta: '#ff00ff',
        gray: '#808080',
        grey: '#808080',
        silver: '#c0c0c0',
        maroon: '#800000',
        olive: '#808000',
        purple: '#800080',
        teal: '#008080',
        navy: '#000080',
        orange: '#ffa500',
        aliceblue: '#f0f8ff',
        antiquewhite: '#faebd7',
        aqua: '#00ffff',
        aquamarine: '#7fffd4',
        azure: '#f0ffff',
        beige: '#f5f5dc',
        bisque: '#ffe4c4',
        blanchedalmond: '#ffebcd',
        blueviolet: '#8a2be2',
        brown: '#a52a2a',
        burlywood: '#deb887',
        cadetblue: '#5f9ea0',
        chartreuse: '#7fff00',
        chocolate: '#d2691e',
        coral: '#ff7f50',
        cornflowerblue: '#6495ed',
        cornsilk: '#fff8dc',
        crimson: '#dc143c',
        darkblue: '#00008b',
        darkcyan: '#008b8b',
        darkgoldenrod: '#b8860b',
        darkgray: '#a9a9a9',
        darkgreen: '#006400',
        darkgrey: '#a9a9a9',
        darkkhaki: '#bdb76b',
        darkmagenta: '#8b008b',
        darkolivegreen: '#556b2f',
        darkorange: '#ff8c00',
        darkorchid: '#9932cc',
        darkred: '#8b0000',
        darksalmon: '#e9967a',
        darkseagreen: '#8fbc8f',
        darkslateblue: '#483d8b',
        darkslategray: '#2f4f4f',
        darkslategrey: '#2f4f4f',
        darkturquoise: '#00ced1',
        darkviolet: '#9400d3',
        deeppink: '#ff1493',
        deepskyblue: '#00bfff',
        dimgray: '#696969',
        dimgrey: '#696969',
        dodgerblue: '#1e90ff',
        firebrick: '#b22222',
        floralwhite: '#fffaf0',
        forestgreen: '#228b22',
        fuchsia: '#ff00ff',
        gainsboro: '#dcdcdc',
        ghostwhite: '#f8f8ff',
        gold: '#ffd700',
        goldenrod: '#daa520',
        greenyellow: '#adff2f',
        honeydew: '#f0fff0',
        hotpink: '#ff69b4',
        indianred: '#cd5c5c',
        indigo: '#4b0082',
        ivory: '#fffff0',
        khaki: '#f0e68c',
        lavender: '#e6e6fa',
        lavenderblush: '#fff0f5',
        lawngreen: '#7cfc00',
        lemonchiffon: '#fffacd',
        lightblue: '#add8e6',
        lightcoral: '#f08080',
        lightcyan: '#e0ffff',
        lightgoldenrodyellow: '#fafad2',
        lightgray: '#d3d3d3',
        lightgreen: '#90ee90',
        lightgrey: '#d3d3d3',
        lightpink: '#ffb6c1',
        lightsalmon: '#ffa07a',
        lightseagreen: '#20b2aa',
        lightskyblue: '#87cefa',
        lightslategray: '#778899',
        lightslategrey: '#778899',
        lightsteelblue: '#b0c4de',
        lightyellow: '#ffffe0',
        lime: '#00ff00',
        limegreen: '#32cd32',
        linen: '#faf0e6',
        mediumaquamarine: '#66cdaa',
        mediumblue: '#0000cd',
        mediumorchid: '#ba55d3',
        mediumpurple: '#9370db',
        mediumseagreen: '#3cb371',
        mediumslateblue: '#7b68ee',
        mediumspringgreen: '#00fa9a',
        mediumturquoise: '#48d1cc',
        mediumvioletred: '#c71585',
        midnightblue: '#191970',
        mintcream: '#f5fffa',
        mistyrose: '#ffe4e1',
        moccasin: '#ffe4b5',
        navajowhite: '#ffdead',
        oldlace: '#fdf5e6',
        olivedrab: '#6b8e23',
        orangered: '#ff4500',
        orchid: '#da70d6',
        palegoldenrod: '#eee8aa',
        palegreen: '#98fb98',
        paleturquoise: '#afeeee',
        palevioletred: '#db7093',
        papayawhip: '#ffefd5',
        peachpuff: '#ffdab9',
        peru: '#cd853f',
        pink: '#ffc0cb',
        plum: '#dda0dd',
        powderblue: '#b0e0e6',
        rosybrown: '#bc8f8f',
        royalblue: '#4169e1',
        saddlebrown: '#8b4513',
        salmon: '#fa8072',
        sandybrown: '#f4a460',
        seagreen: '#2e8b57',
        seashell: '#fff5ee',
        sienna: '#a0522d',
        skyblue: '#87ceeb',
        slateblue: '#6a5acd',
        slategray: '#708090',
        slategrey: '#708090',
        snow: '#fffafa',
        springgreen: '#00ff7f',
        steelblue: '#4682b4',
        tan: '#d2b48c',
        thistle: '#d8bfd8',
        tomato: '#ff6347',
        transparent: '#00000000', // Special case
        turquoise: '#40e0d0',
        violet: '#ee82ee',
        wheat: '#f5deb3',
        whitesmoke: '#f5f5f5',
        yellowgreen: '#9acd32',
        rebeccapurple: '#663399'
    };
    if (colors[name]) {
        return parseHex(colors[name]);
    }
    return null;
}
//# sourceMappingURL=colorService.js.map