export type Theme = 'light' | 'dark';
export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

type ThemeQuery = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;

// Read the live preference on every snapshot, including changes before subscription.
export function createSystemThemeStore(query: ThemeQuery | null) {
  return {
    getSnapshot: (): Theme => query?.matches ? 'dark' : 'light',
    getServerSnapshot: (): Theme => 'light',
    subscribe(listener: () => void) {
      query?.addEventListener('change', listener);
      return () => query?.removeEventListener('change', listener);
    },
  };
}

// Keep the authored light palette; map each material to its night-time counterpart.
const darkMaterials: Record<string, string> = {};
function group(target: string, sources: string[]) {
  for (const source of sources) darkMaterials[source] = target;
}
group('#18221e', ['#eeeee5']);
group('#29382f', ['#cfd5bd']);
group('#31432f', ['#bdc9ac', '#b4c29e', '#b2c29f']);
group('#46574e', ['#e9e4d4']);
group('#424e45', ['#ddd8c9']);
group('#305951', ['#b5cbc7']);
group('#6c776d', ['#d7d2c3', '#dddacb']);
group('#839287', ['#c2c4af']);
group('#8fb7a0', ['#93aa98', '#b0bead']);
group('#46594b', ['#aaa895']);
group('#a3c7b0', ['#567760', '#698673', '#355f45']);
group('#667c69', ['#97a188', '#989b83']);
group('#a6d1b6', ['#3e6951', '#344b40', '#42634c', '#46634e']);
group('#e6ad71', ['#b8723d']);
group('#526b48', ['#798e65']);
group('#607a51', ['#84966d']);
group('#4a674b', ['#718b66']);
group('#6e6252', ['#93806a']);
group('#7f8871', ['#b8bbac', '#aeb5a2']);
group('#698f7f', ['#93ada2', '#9fb6ab']);
group('#8cb6a1', ['#83a896']);
group('#78806d', ['#9b9f8e', '#b7b69e']);
group('#867e66', ['#b6b39e', '#bbb7a4', '#c9c4af', '#b2ae95', '#c8c2a8']);
group('#9ab79f', ['#5c7866', '#738979', '#667867']);
group('#769584', ['#627966', '#6b8174']);
group('#b69b6f', ['#b89466', '#92744e']);
group('#6c9a84', ['#739681', '#507661']);
group('#739dc1', ['#6f8caa', '#58718d']);
group('#b6876c', ['#b98060']);
group('#d1cbb4', ['#faf0dc', '#f0eedb', '#edf0da']);
group('#8c805f', ['#b4a286']);
group('#afa188', ['#796e56', '#96896f']);
group('#6f8c7c', ['#7e8c83']);
group('#9cb4a4', ['#596f63']);
group('#776f5f', ['#c8bea7', '#d3c7ae', '#aaa38e', '#aaa18b', '#b9ae92']);
group('#897963', ['#b7a486', '#c8b392']);
group('#657c6b', ['#586454', '#526356', '#6a7366']);
group('#f0d3a0', ['#795b32']);
group('#c3a36c', ['#b99b5c', '#83653a']);
group('#805445', ['#ae6652']);
group('#406346', ['#83a575', '#7ea270']);
group('#365c3d', ['#759967']);
group('#cebaa1', ['#f1deca']);
group('#92ab88', ['#c4d3b7']);
group('#41685a', ['#80a093']);
group('#385e50', ['#78998a']);
group('#526e70', ['#647b7e']);
group('#7b9687', ['#566663', '#68766a', '#adb7ae']);
group('#7f8b7c', ['#b3b1a4']);
group('#508aa1', ['#348bac']);
group('#98aeb3', ['#b6c9cc']);
group('#b3a28b', ['#d8c6a7']);
group('#9ab5a6', ['#bad0c3']);
group('#9db2ca', ['#bdcedf']);
group('#b5a181', ['#ad9879']);
group('#a9c5b6', ['#8faa99']);
group('#b2c8de', ['#91a7bf']);

export function mapColorForTheme(theme: Theme, color: string): string {
  return theme === 'dark' ? darkMaterials[color.toLowerCase()] || color : color;
}
