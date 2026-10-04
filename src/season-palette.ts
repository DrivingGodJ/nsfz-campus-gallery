import { mapColorForTheme, type Theme } from './theme.ts';
import type { PhotoSeason } from './photo-season';

type Season = Exclude<PhotoSeason, 'unknown'>;
type Palette = Record<string, [string, string]>;
const palettes: Record<Season, Palette> = {
  spring: {
    '#eeeee5': ['#edf1e8', '#19251e'], '#cfd5bd': ['#cbdab8', '#304132'],
    '#bdc9ac': ['#bfcea6', '#354c32'], '#b4c29e': ['#b4cca0', '#395332'], '#b2c29f': ['#b6cca5', '#385031'],
    '#b5cbc7': ['#b8d3ce', '#345f56'], '#e9e4d4': ['#ebe7d8', '#4a5a4d'], '#ddd8c9': ['#e0dfce', '#46534a'],
    '#798e65': ['#7d9d63', '#64814d'], '#84966d': ['#91aa72', '#738b59'], '#718b66': ['#759762', '#58774d'],
  },
  summer: {
    '#eeeee5': ['#e9eee6', '#17231e'], '#cfd5bd': ['#bccfb5', '#293d30'],
    '#bdc9ac': ['#afc4a3', '#2f4734'], '#b4c29e': ['#a7bf99', '#304b31'], '#b2c29f': ['#aec5a4', '#304834'],
    '#b5cbc7': ['#a8c8c3', '#2c5b55'], '#e9e4d4': ['#e5e2d1', '#42534a'], '#ddd8c9': ['#d8d8c7', '#3e4e43'],
    '#798e65': ['#638658', '#45663d'], '#84966d': ['#759362', '#537445'], '#718b66': ['#567d55', '#3b603e'],
  },
  autumn: {
    '#eeeee5': ['#f0ede4', '#29251d'], '#cfd5bd': ['#d8cdb2', '#453e2c'],
    '#bdc9ac': ['#cec1a0', '#4d422c'], '#b4c29e': ['#c7b893', '#55482d'], '#b2c29f': ['#cebf9f', '#50452f'],
    '#b5cbc7': ['#b9cbc5', '#405c55'], '#e9e4d4': ['#e9e0ce', '#605445'], '#ddd8c9': ['#ddd1b9', '#574a38'],
    '#798e65': ['#b48c52', '#967440'], '#84966d': ['#bd985f', '#a4844e'], '#718b66': ['#a47b4d', '#89663e'],
  },
  winter: {
    '#eeeee5': ['#f0f2ee', '#20282a'], '#cfd5bd': ['#dce2db', '#3a4545'],
    '#bdc9ac': ['#d2dbd0', '#414d49'], '#b4c29e': ['#cbd6c9', '#485650'], '#b2c29f': ['#d3dcd0', '#46514d'],
    '#b5cbc7': ['#c5d5d9', '#49656e'], '#e9e4d4': ['#ecece2', '#637072'], '#ddd8c9': ['#e3e4da', '#596567'],
    '#798e65': ['#a5b0a5', '#7b8d86'], '#84966d': ['#b7c0b4', '#899a91'], '#718b66': ['#98a69c', '#71867e'],
  },
};

export function seasonalMapColor(theme: Theme, season: PhotoSeason | '', color: string) {
  const pair = season && season !== 'unknown' ? palettes[season][color.toLowerCase()] : undefined;
  return pair ? pair[theme === 'dark' ? 1 : 0] : mapColorForTheme(theme, color);
}
