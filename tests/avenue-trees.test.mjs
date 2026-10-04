import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('avenue tree crowns stay separate where independently planted rows meet', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const trees = campus.features.filter(feature => feature.type === 'trees')
    .flatMap(feature => feature.trees.map(tree => ({ ...tree, group: feature.id })));
  assert.ok(trees.length > 20, 'Both sides of the avenues remain planted');
  for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) {
    const a = trees[i], b = trees[j];
    const distance = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
    assert.ok(distance > a.radius + b.radius, `Tree crowns overlap between ${a.group} and ${b.group}`);
  }
});
