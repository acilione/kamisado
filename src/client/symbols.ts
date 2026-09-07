import type { PieceColor } from '../shared/types.js';

// Fixed SVG shapes render consistently without depending on emoji or symbol fonts.
export const COLOR_SYMBOLS: Record<PieceColor, { name: string; path: string }> = {
    orange: { name: 'Circle', path: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18' },
    blue: { name: 'Triangle', path: 'M12 2L23 22H1Z' },
    purple: { name: 'Square', path: 'M3 3H21V21H3Z' },
    pink: { name: 'Diamond', path: 'M12 1L23 12L12 23L1 12Z' },
    yellow: { name: 'Star', path: 'M12 1L15 8L23 9L17 14L19 22L12 18L5 22L7 14L1 9L9 8Z' },
    red: { name: 'Plus', path: 'M8 2H16V8H22V16H16V22H8V16H2V8H8Z' },
    green: { name: 'Crescent', path: 'M18 2A10 10 0 1 0 18 22A11 11 0 0 1 18 2Z' },
    brown: { name: 'Bars', path: 'M3 3H9V21H3ZM15 3H21V21H15Z' },
};

export function createColorSymbol(color: PieceColor, className = ''): HTMLSpanElement {
    const badge = document.createElement('span');
    badge.className = `color-symbol ${className}`;
    badge.dataset.color = color;
    badge.title = `${color}: ${COLOR_SYMBOLS[color].name}`;
    badge.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', COLOR_SYMBOLS[color].path);
    svg.appendChild(path);
    badge.appendChild(svg);
    return badge;
}
