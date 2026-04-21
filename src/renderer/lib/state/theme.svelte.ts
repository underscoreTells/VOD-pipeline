type Theme = 'dark' | 'light';

const THEME_KEY = 'vod-pipeline-theme';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const themeState = $state({
  current: getInitialTheme() as Theme,
});

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function initTheme(): void {
  applyTheme(themeState.current);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      themeState.current = e.matches ? 'light' : 'dark';
      applyTheme(themeState.current);
    }
  });
}

export function setTheme(theme: Theme): void {
  themeState.current = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* localStorage unavailable */ }
}

export function toggleTheme(): void {
  setTheme(themeState.current === 'dark' ? 'light' : 'dark');
}
