/**
 * Which packages must travel with a bundle: the packages a bundler cannot inline (WASM, worker
 * scripts, font data read from disk) plus everything they need at runtime, resolved the way
 * Node would from a hoisted `node_modules`. Pure and fs-injected so it is unit tested.
 */

export interface PackageFs {
  exists(p: string): boolean;
  read(p: string): string;
}

export interface Closure {
  packages: string[];
  /** Dependencies that could not be found at the top level. A bundle missing them would fail at runtime. */
  missing: string[];
}

export function dependencyClosure(
  nodeModules: string,
  roots: readonly string[],
  fs: PackageFs,
  skip: readonly RegExp[] = [],
): Closure {
  const seen = new Set<string>();
  const missing = new Set<string>();
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");

  const visit = (name: string, optional: boolean): void => {
    if (seen.has(name) || skip.some((re) => re.test(name))) return;
    const manifest = join(nodeModules, name, "package.json");
    if (!fs.exists(manifest)) {
      if (!optional) missing.add(name);
      return;
    }
    seen.add(name);
    const pkg = JSON.parse(fs.read(manifest)) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, true);
  };

  for (const root of roots) visit(root, false);
  return { packages: [...seen].sort(), missing: [...missing].sort() };
}
