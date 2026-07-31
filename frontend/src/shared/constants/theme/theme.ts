import { createTheme } from '@mantine/core'

import components from './overrides'

// Apple-dark palette matched to the bedolaga-cabinet (Ultima) design system:
// Manrope/Outfit type, true-black canvas, flat #1c1c1e cards, brand orange
// #F97316 accent. Mantine scales are remapped so components referencing named
// colors (blue, cyan, green, ...) recolor coherently.
const BODY_STACK =
    'Manrope, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Vazirmatn, "Apple Color Emoji", "Noto Sans SC", "Twemoji Country Flags", sans-serif'
const DISPLAY_STACK =
    'Outfit, Manrope, -apple-system, BlinkMacSystemFont, Vazirmatn, "Apple Color Emoji", "Noto Sans SC", sans-serif'

export const theme = createTheme({
    components,
    cursorType: 'pointer',
    fontFamily: BODY_STACK,
    fontFamilyMonospace:
        '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    breakpoints: {
        xs: '25em',
        sm: '30em',
        md: '48em',
        lg: '64em',
        xl: '80em',
        '2xl': '96em',
        '3xl': '120em',
        '4xl': '160em'
    },
    scale: 1,
    fontSmoothing: true,
    focusRing: 'never',
    white: '#f5f5f7',
    black: '#1d1d1f',
    colors: {
        dark: [
            '#f5f5f7',
            '#d2d2d7',
            '#a1a1a6',
            '#8e8e93',
            '#48484a',
            '#3a3a3c',
            '#2c2c2e',
            '#1c1c1e',
            '#161618',
            '#000000'
        ],

        blue: [
            '#fff4ec',
            '#ffe6d5',
            '#ffccaa',
            '#ffab74',
            '#fd8a3d',
            '#f97316',
            '#dd5f0d',
            '#b84c09',
            '#923c08',
            '#6c2c06'
        ],
        cyan: [
            '#fff4ec',
            '#ffe6d5',
            '#ffccaa',
            '#ffab74',
            '#fd8a3d',
            '#f97316',
            '#dd5f0d',
            '#b84c09',
            '#923c08',
            '#6c2c06'
        ],
        green: [
            '#e6fbee',
            '#c9f5da',
            '#95ebb4',
            '#5fdf8d',
            '#30d158',
            '#28b64c',
            '#209a40',
            '#187e34',
            '#116329',
            '#0b4a1f'
        ],
        red: [
            '#ffecea',
            '#ffd8d4',
            '#ffb0a8',
            '#ff8a7e',
            '#ff6759',
            '#ff453a',
            '#e02e24',
            '#b82018',
            '#8f150f',
            '#670d09'
        ],
        yellow: [
            '#fffbe5',
            '#fff6c7',
            '#ffed8f',
            '#ffe456',
            '#ffd60a',
            '#e6bd00',
            '#c4a000',
            '#a18300',
            '#7d6600',
            '#5a4900'
        ],
        orange: [
            '#fff3e0',
            '#ffe7c2',
            '#ffd08a',
            '#ffb84d',
            '#ffab29',
            '#ff9f0a',
            '#e68800',
            '#c47300',
            '#a15e00',
            '#7d4900'
        ],
        violet: [
            '#f8edfd',
            '#f0dbfb',
            '#e1b6f8',
            '#d190f4',
            '#bf5af2',
            '#a63fd8',
            '#8c2fb8',
            '#722398',
            '#591878',
            '#400f58'
        ],
        teal: [
            '#e6fbf5',
            '#c8f6e9',
            '#93edd3',
            '#5ee3bc',
            '#40c8a5',
            '#2fae8e',
            '#249278',
            '#1a7661',
            '#125b4b',
            '#0b4136'
        ]
    },
    primaryShade: 5,
    primaryColor: 'blue',
    autoContrast: true,
    luminanceThreshold: 0.3,
    headings: {
        fontFamily: DISPLAY_STACK,
        fontWeight: '600'
    },
    radius: {
        xs: '8px',
        sm: '10px',
        md: '12px',
        lg: '16px',
        xl: '20px'
    },
    defaultRadius: 'md'
})
