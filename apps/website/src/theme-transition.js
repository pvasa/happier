const THEME_TRANSITION_DURATION_MS = 600
const THEME_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

export function shouldAnimateThemeTransition({
  currentTheme,
  nextTheme,
  reduceMotion,
  supportsViewTransition,
}) {
  return !reduceMotion && supportsViewTransition && currentTheme !== nextTheme
}

export function applyTheme(theme, documentLike = document) {
  documentLike.documentElement.classList.toggle('dark', theme === 'dark')
}

export async function applyThemeWithTransition(options) {
  const documentLike = options.document ?? document
  const supportsViewTransition = typeof documentLike.startViewTransition === 'function'

  if (!shouldAnimateThemeTransition({
    currentTheme: options.currentTheme,
    nextTheme: options.nextTheme,
    reduceMotion: options.reduceMotion,
    supportsViewTransition,
  })) {
    applyTheme(options.nextTheme, documentLike)
    return
  }

  const transition = documentLike.startViewTransition(() => {
    applyTheme(options.nextTheme, documentLike)
  })
  await transition.ready?.catch(() => undefined)
  documentLike.documentElement.animate?.(
    { clipPath: ['inset(0 0 100% 0)', 'inset(0)'] },
    {
      duration: THEME_TRANSITION_DURATION_MS,
      easing: THEME_TRANSITION_EASING,
      fill: 'both',
      pseudoElement: '::view-transition-new(root)',
    },
  )
}
