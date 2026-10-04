import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { campusFilterLocations } from '../src/locations.ts';

test('annotation and filtering offer broad destinations and corridors, while small landmarks cannot be selected', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-control-cache-'));
  const server = await createServer({ root, cacheDir, configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true },
    ssr: { noExternal: ['@react-three/drei'] },
    plugins: [{ name: 'test-independent-html-root', enforce: 'pre',
      resolveId(id) { if (id === '@react-three/drei') return '\0test-independent-html-root'; },
      load(id) {
        if (id === '\0test-independent-html-root') return `
          import React from 'react';
          import { renderToStaticMarkup } from 'react-dom/server';
          export function Html({children}) { return React.createElement('div', {dangerouslySetInnerHTML: {__html: renderToStaticMarkup(children)}}); }
          export function Line() { return null; }
        `;
      }
    }], server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { default: Options } = await server.ssrLoadModule('/src/LocationOptions.tsx');
    const { LocationHtml, LocationName, LocationSelection } = await server.ssrLoadModule('/src/LocationSelection.tsx');
    const html = renderToStaticMarkup(React.createElement('select', { 'aria-label': '拍摄地点' }, React.createElement(Options, { campus, site })));
    const filters = campusFilterLocations(campus, site);
    assert.equal((html.match(/<option /g) || []).length, filters.length);
    assert.match(html, /<optgroup label="建筑">/); assert.match(html, /<optgroup label="校园区域与通道">/);
    for (const name of ['主教学楼', '宿舍', '食堂', '操场', '篮球场', '未名湖', '标本林', '走廊', '地下走廊', '地下通道', '风雨跑道']) assert.ok(html.includes('>' + name + '</option>'), name + ' is available for annotation and filtering');
    for (const name of ['湖心亭', '钟楼', '校门碑', '诚朴雄伟碑', '紫藤长廊', '天桥', '湖中栈道', '地下通道入口', '地下通道出口', '小卖部', '办公室']) assert.ok(!html.includes('>' + name + '</option>'), name + ' cannot be newly annotated or used as a filter');
    const render = value => renderToStaticMarkup(React.createElement(LocationSelection.Provider, { value }, React.createElement(LocationName, { id: 'local/underpass-exit', name: '地下通道出口', underground: true })));
    const selected = render({ selectedId: 'local/underpass-exit', onSelect: () => {} });
    assert.match(selected, /<button/); assert.match(selected, /aria-label="选择地点：地下通道出口"/); assert.match(selected, /aria-pressed="true"/);
    assert.match(render({ selectedId: 'other', onSelect: () => {} }), /aria-pressed="false"/);
    assert.ok(!render({ placing: true, onSelect: () => {} }).includes('<button'), 'Placing a point keeps map labels from changing its location');
    assert.ok(!render({ featuresSelectable: false, onSelect: () => {} }).includes('<button'), 'Building settings do not offer feature edit actions');
    const filterSelection = { onSelect: () => {}, selectableIds: new Set(filters.map(location => location.id)) };
    assert.ok(!render(filterSelection).includes('<button'), 'Small map landmarks cannot reintroduce a hidden filter');
    const majorName = renderToStaticMarkup(React.createElement(LocationSelection.Provider, { value: filterSelection }, React.createElement(LocationName, { id: 'way/855459418', name: '未名湖' })));
    assert.match(majorName, /<button/, 'Broad map destinations stay selectable');
    for (const id of ['way/1233313439', 'local/underground-corridor', 'local/underpass']) {
      const corridor = renderToStaticMarkup(React.createElement(LocationSelection.Provider, { value: filterSelection }, React.createElement(LocationName, { id, name: '走廊' })));
      assert.match(corridor, /<button/, 'Corridor map locations stay selectable');
    }
    const value = { selectedId: 'local/underpass-exit', onSelect: () => {} };
    const inSeparateHtmlRoot = renderToStaticMarkup(React.createElement(LocationSelection.Provider, { value },
      React.createElement(LocationHtml, null, React.createElement(LocationName, { id: value.selectedId, name: '地下通道出口', underground: true }))));
    assert.match(inSeparateHtmlRoot, /<button/); assert.match(inSeparateHtmlRoot, /aria-pressed="true"/, 'Map label roots retain the canvas selection state and actions');
  } finally { await server.close(); await fs.rm(cacheDir, { recursive: true, force: true }); }
});
