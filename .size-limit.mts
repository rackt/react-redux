import type { Check, SizeLimitConfig } from 'size-limit'
import type { Configuration } from 'webpack'

/**
 * An array of all possible Node environments.
 */
const allNodeEnvs = ['development', 'production'] as const

/**
 * Represents a specific environment for a Node.js application.
 */
type NodeEnv = (typeof allNodeEnvs)[number]

/**
 * Gets all import configurations for a given entry point.
 * This function dynamically imports the specified entry point and
 * generates a size limit configuration for each named export found
 * within the module. It includes configurations for named imports,
 * wildcard imports, and the default import.
 *
 * @param entryPoint - The entry point to import.
 * @param index - The index of the entry point in the list.
 * @returns A promise that resolves to a size limit configuration object.
 */
const getAllImportsForEntryPoint = async (
  entryPoint: string,
  index: number,
): Promise<SizeLimitConfig> => {
  const allNamedImports = Object.keys(await import(entryPoint)).filter(
    (namedImport) => namedImport !== 'default',
  )

  return allNamedImports
    .map<Check>((namedImport) => ({
      path: entryPoint,
      name: `${index + 1}. import { ${namedImport} } from "${entryPoint}"`,
      import: `{ ${namedImport} }`,
    }))
    .concat([
      {
        path: entryPoint,
        name: `${index + 1}. import * from "${entryPoint}"`,
        import: '*',
      },
      {
        path: entryPoint,
        name: `${index + 1}. import "${entryPoint}"`,
      },
    ])
}

/**
 * Sets the `NODE_ENV` for a given Webpack configuration.
 *
 * @param nodeEnv - The `NODE_ENV` to set (either 'development' or 'production').
 * @returns A function that modifies the Webpack configuration.
 */
const setNodeEnv = (nodeEnv: NodeEnv) => {
  const modifyWebpackConfig = ((config: Configuration) => {
    ;(config.optimization ??= {}).nodeEnv = nodeEnv

    return config
  }) satisfies Check['modifyWebpackConfig']

  return modifyWebpackConfig
}

/**
 * Gets all import configurations with a specified `NODE_ENV`.
 *
 * @param nodeEnv - The `NODE_ENV` to set (either 'development' or 'production').
 * @returns A promise that resolves to a size limit configuration object.
 */
const getAllImportsWithNodeEnv = async (nodeEnv: NodeEnv) => {
  const allPackageEntryPoints = ['./dist/react-redux.mjs']

  const allImportsFromAllEntryPoints = (
    await Promise.all(allPackageEntryPoints.map(getAllImportsForEntryPoint))
  ).flat()

  const modifyWebpackConfig = setNodeEnv(nodeEnv)

  const allImportsWithNodeEnv = allImportsFromAllEntryPoints.map<Check>(
    (importsFromEntryPoint) => ({
      ...importsFromEntryPoint,
      name: `${importsFromEntryPoint.name} ('${nodeEnv}' mode)`,
      modifyWebpackConfig,
    }),
  )

  return allImportsWithNodeEnv
}

/**
 * Gets the size limit configuration for all `NODE_ENV`s.
 *
 * @returns A promise that resolves to the size limit configuration object.
 */
const getSizeLimitConfig = async (): Promise<SizeLimitConfig> => {
  const packageJson = (
    await import('./package.json', { with: { type: 'json' } })
  ).default

  const sizeLimitConfig = (
    await Promise.all(allNodeEnvs.map(getAllImportsWithNodeEnv))
  ).flat()

  if ('dependencies' in packageJson) {
    const dependencies = Object.keys(packageJson.dependencies ?? {})

    const sizeLimitConfigWithoutDependencies = sizeLimitConfig.map<Check>(
      (check) => ({
        ...check,
        name: `${check.name} (excluding dependencies)`,
        ignore: dependencies,
      }),
    )

    return sizeLimitConfig.concat(sizeLimitConfigWithoutDependencies)
  }

  return sizeLimitConfig
}

const sizeLimitConfig: Promise<SizeLimitConfig> = getSizeLimitConfig()

export default sizeLimitConfig
