import { useContext, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Feature } from './types';
import { LocationSelection } from './LocationSelection';
import { useMapColor } from './MapTheme';
import { mottoStoneGeometry, mottoStoneInscriptionGeometry, mottoStoneLayout, mottoStoneRotation } from './motto-stone-geometry';

export default function MottoStone({ feature }: { feature: Feature }) {
  const model = feature.stone!, mapColor = useMapColor();
  const { selectedId, onSelect, placing, featuresSelectable } = useContext(LocationSelection);
  const geometry = useMemo(() => mottoStoneGeometry(model), [model]);
  const sign = useMemo(() => mottoStoneInscriptionGeometry(model), [model]);
  const layout = useMemo(() => mottoStoneLayout(model), [model]);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 384;
    const context = canvas.getContext('2d')!;
    context.font = '280px "Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    const characters = [...model.inscription], gap = 1390 / characters.length;
    characters.forEach((character, i) => {
      const x = 768 + (i - (characters.length - 1) / 2) * gap;
      context.strokeStyle = '#695028'; context.lineWidth = 4; context.strokeText(character, x, 200);
      context.fillStyle = '#dcae51'; context.fillText(character, x, 196);
    });
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; return texture;
  }, [model.inscription]);
  useEffect(() => () => { geometry.dispose(); sign.dispose(); }, [geometry, sign]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group name={feature.id} position={[model.center[0], .12, model.center[1]]} rotation={[0, mottoStoneRotation(model), 0]}
    onClick={e => { if (onSelect && !placing && featuresSelectable !== false && e.delta < 5) { e.stopPropagation(); onSelect(feature.id); } }}>
    {layout.baseRocks.map((rock, i) => <mesh key={i} position={rock.position} scale={rock.scale}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={mapColor('#73786a')} roughness={1} /></mesh>)}
    <mesh geometry={geometry}><meshStandardMaterial color={selectedId === feature.id ? mapColor('#5b7362') : mapColor('#43594f')} roughness={.97} /></mesh>
    <mesh geometry={sign} raycast={() => null}><meshBasicMaterial map={texture} transparent depthWrite={false} side={THREE.FrontSide} /></mesh>
  </group>;
}
