import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { createSystemThemeStore, SYSTEM_THEME_QUERY, type Theme } from './theme';
import { seasonalMapColor } from './season-palette';
import type { PhotoSeason } from './photo-season';

const systemTheme = createSystemThemeStore(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SYSTEM_THEME_QUERY) : null);
export const MapTheme = createContext<Theme>('light');
export const MapSeason = createContext<PhotoSeason | ''>('');

export function useSystemTheme() {
  return useSyncExternalStore(systemTheme.subscribe, systemTheme.getSnapshot, systemTheme.getServerSnapshot);
}

export function useMapColor(themeOverride?: Theme, seasonOverride?: PhotoSeason | '') {
  const inheritedTheme = useContext(MapTheme);
  const inheritedSeason = useContext(MapSeason);
  const theme = themeOverride || inheritedTheme;
  const season = seasonOverride ?? inheritedSeason;
  return useCallback((color: string) => seasonalMapColor(theme, season, color), [theme, season]);
}
