import * as THREE from 'three';

export const SURFACE_CONTEXT_OPACITY = .018;

type MaterialProps = Partial<Record<'transparent' | 'depthWrite', unknown>>;
const declaredMaterialProps = (material: THREE.Material) => (material as THREE.Material & { __r3f?: { props: MaterialProps } }).__r3f?.props;

// Fade the complete model, including windows, rails and floor outlines. Keep
// each renderer's live opacity so returning to the surface restores its view.
export function ghostSurfaceModel(root: THREE.Object3D) {
  const materials = new Map<THREE.Material, { transparent: boolean; depthWrite: boolean; props?: MaterialProps }>();
  const restores: (() => void)[] = [];
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (materials.has(material)) continue;
      materials.set(material, { transparent: material.transparent, depthWrite: material.depthWrite, props: declaredMaterialProps(material) });
      material.transparent = true; material.depthWrite = false; material.needsUpdate = true;
    }
    const before = object.onBeforeRender, after = object.onAfterRender, raycast = object.raycast;
    let renderedMaterial: THREE.Material | undefined, opacity = 1;
    object.raycast = () => null;
    object.onBeforeRender = function (...args) {
      before.apply(this, args);
      renderedMaterial = args[4]; opacity = renderedMaterial.opacity;
      renderedMaterial.opacity = opacity * SURFACE_CONTEXT_OPACITY;
    };
    object.onAfterRender = function (...args) {
      if (renderedMaterial) renderedMaterial.opacity = opacity;
      after.apply(this, args);
    };
    restores.push(() => { object.onBeforeRender = before; object.onAfterRender = after; object.raycast = raycast; });
  });
  return () => {
    restores.forEach(restore => restore());
    for (const [material, original] of materials) {
      // Child props commit before this parent's layout cleanup. Restore their
      // latest declared flags rather than overwriting a new floor selection.
      const props = declaredMaterialProps(material);
      for (const flag of ['transparent', 'depthWrite'] as const) {
        material[flag] = typeof props?.[flag] === 'boolean' ? props[flag]
          : props && typeof original.props?.[flag] === 'boolean' ? flag === 'depthWrite' : original[flag];
      }
      material.needsUpdate = true;
    }
  };
}
