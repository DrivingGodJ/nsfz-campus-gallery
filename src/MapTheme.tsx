import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { createSystemThemeStore, SYSTEM_THEME_QUERY, type Theme } from './theme';
import { timeMapColor } from './time-palette';
import type { PhotoSeason } from './photo-season';
import type { PhotoTime } from './photo-time';

const systemTheme = createSystemThemeStore(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SYSTEM_THEME_QUERY) : null);
export const MapTheme = createContext<Theme>('light');
export const MapSeason = createContext<PhotoSeason | ''>('');
export const MapTime = createContext<PhotoTime | ''>('');

export function useSystemTheme() {
  return useSyncExternalStore(systemTheme.subscribe, systemTheme.getSnapshot, systemTheme.getServerSnapshot);
}

export function useMapColor(themeOverride?: Theme, seasonOverride?: PhotoSeason | '', timeOverride?: PhotoTime | '') {
  const inheritedTheme = useContext(MapTheme);
  const inheritedSeason = useContext(MapSeason);
  const inheritedTime = useContext(MapTime);
  const theme = themeOverride || inheritedTheme;
  const season = seasonOverride ?? inheritedSeason;
  const time = timeOverride ?? inheritedTime;
  return useCallback((color: string) => timeMapColor(theme, season, time, color), [theme, season, time]);
}
