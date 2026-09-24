/** @type {import('next').NextConfig} */
export default {
  // The legs read fixtures/contracts from disk, so those files have to travel with the deployment.
  // Without this the report route is a 500 on staging and green everywhere else.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  outputFileTracingIncludes: { '/api/**': ['../../fixtures/contracts/**'] },

  // The repo compiles with NodeNext, so every relative import inside src/ is written with a `.js`
  // extension pointing at a `.ts` file. That is what tsc wants and what the other 8 packages do.
  // A bundler resolves the path literally and finds nothing, so it is taught the same rewrite
  // rather than this one package being written in a different style from the rest.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}
