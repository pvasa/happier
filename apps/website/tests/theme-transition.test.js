import assert from 'node:assert/strict'
import test from 'node:test'

import {
    applyThemeWithTransition,
    shouldAnimateThemeTransition,
} from '../src/theme-transition.js'

test('theme transition skips animation when the theme does not visually change', () => {
    assert.equal(shouldAnimateThemeTransition({
        currentTheme: 'dark',
        nextTheme: 'dark',
        reduceMotion: false,
        supportsViewTransition: true,
    }), false)
})

test('theme transition uses same-document view transition when supported', async () => {
    const calls = []
    const html = {
        classList: {
            toggle(name, enabled) {
                calls.push(['toggle', name, enabled])
            },
        },
        animate(keyframes, options) {
            calls.push(['animate', keyframes, options])
        },
    }
    const documentLike = {
        documentElement: html,
        startViewTransition(update) {
            calls.push(['start'])
            update()
            return { ready: Promise.resolve() }
        },
    }

    await applyThemeWithTransition({
        currentTheme: 'light',
        document: documentLike,
        nextTheme: 'dark',
        reduceMotion: false,
    })

    assert.deepEqual(calls[0], ['start'])
    assert.deepEqual(calls[1], ['toggle', 'dark', true])
    assert.equal(calls[2][0], 'animate')
    assert.deepEqual(calls[2][1], { clipPath: ['inset(0 0 100% 0)', 'inset(0)'] })
    assert.equal(calls[2][2].duration, 600)
    assert.equal(calls[2][2].easing, 'cubic-bezier(0.4, 0, 0.2, 1)')
    assert.equal(calls[2][2].fill, 'both')
    assert.equal(calls[2][2].pseudoElement, '::view-transition-new(root)')
})

test('theme transition applies immediately when reduced motion is enabled', async () => {
    const calls = []
    const documentLike = {
        documentElement: {
            classList: {
                toggle(name, enabled) {
                    calls.push(['toggle', name, enabled])
                },
            },
            animate() {
                calls.push(['animate'])
            },
        },
        startViewTransition(update) {
            calls.push(['start'])
            update()
            return { ready: Promise.resolve() }
        },
    }

    await applyThemeWithTransition({
        currentTheme: 'light',
        document: documentLike,
        nextTheme: 'dark',
        reduceMotion: true,
    })

    assert.deepEqual(calls, [['toggle', 'dark', true]])
})
