import {ensureDevContext} from './context.js'
import {generateFrontendURL, generatePartnersURLs, getURLs, shouldOrPromptUpdateURLs, updateURLs} from './dev/urls.js'
import {installAppDependencies} from './dependencies.js'
import {devUIExtensions} from './dev/extension.js'
import {outputExtensionsMessages, outputUpdateURLsResult} from './dev/output.js'
import {themeExtensionArgs} from './dev/theme-extension-args.js'
import {fetchSpecifications} from './generate/fetch-extension-specifications.js'
import {sendUninstallWebhookToAppServer} from './webhook/send-app-uninstalled-webhook.js'
import {bundleExtension} from './extensions/bundle.js'
import {ensureDeploymentIdsPresence} from './context/identifiers.js'
import {
  ReverseHTTPProxyTarget,
  runConcurrentHTTPProcessesAndPathForwardTraffic,
} from '../utilities/app/http-reverse-proxy.js'
import {AppInterface, AppConfiguration, Web, WebType} from '../models/app/app.js'
import metadata from '../metadata.js'
import {UIExtension} from '../models/app/extensions.js'
import {fetchProductVariant} from '../utilities/extensions/fetch-product-variant.js'
import {load} from '../models/app/loader.js'
import {getAppIdentifiers} from '../models/app/identifiers.js'
import {getAnalyticsTunnelType} from '../utilities/analytics.js'
import {buildAppURLForWeb} from '../utilities/app/app-url.js'
import {HostThemeManager} from '../utilities/host-theme-manager.js'
import {
  ExtensionUpdateDraftInput,
  ExtensionUpdateDraftMutation,
  ExtensionUpdateSchema,
} from '../api/graphql/update_draft.js'
import {Config} from '@oclif/core'
import {reportAnalyticsEvent} from '@shopify/cli-kit/node/analytics'
import {execCLI2} from '@shopify/cli-kit/node/ruby'
import {renderConcurrent} from '@shopify/cli-kit/node/ui'
import {checkPortAvailability, getAvailableTCPPort} from '@shopify/cli-kit/node/tcp'
import {AbortSignal} from '@shopify/cli-kit/node/abort'
import {hashString} from '@shopify/cli-kit/node/crypto'
import {exec} from '@shopify/cli-kit/node/system'
import {isSpinEnvironment, spinFqdn} from '@shopify/cli-kit/node/context/spin'
import {
  AdminSession,
  ensureAuthenticatedAdmin,
  ensureAuthenticatedPartners,
  ensureAuthenticatedStorefront,
} from '@shopify/cli-kit/node/session'
import {OutputProcess, outputDebug} from '@shopify/cli-kit/node/output'
import {AbortError} from '@shopify/cli-kit/node/error'
import {partition} from '@shopify/cli-kit/common/collection'
import {partnersRequest} from '@shopify/cli-kit/node/api/partners'
import {Writable} from 'stream'

export interface DevOptions {
  directory: string
  id?: number
  apiKey?: string
  storeFqdn?: string
  reset: boolean
  update: boolean
  commandConfig: Config
  skipDependenciesInstallation: boolean
  subscriptionProductUrl?: string
  checkoutCartUrl?: string
  tunnelUrl?: string
  tunnelProvider?: string
  noTunnel: boolean
  theme?: string
  themeExtensionPort?: number
}

interface DevWebOptions {
  backendPort: number
  apiKey: string
  apiSecret?: string
  hostname?: string
  scopes?: AppConfiguration['scopes']
}

async function dev(options: DevOptions) {
  const token = await ensureAuthenticatedPartners()
  const {
    storeFqdn,
    remoteApp,
    remoteAppUpdated,
    updateURLs: cachedUpdateURLs,
    useCloudflareTunnels,
  } = await ensureDevContext(options, token)

  const apiKey = remoteApp.apiKey
  const specifications = await fetchSpecifications({token, apiKey, config: options.commandConfig})
  let localApp = await load({directory: options.directory, specifications})

  if (!options.skipDependenciesInstallation) {
    localApp = await installAppDependencies(localApp)
  }

  const frontendConfig = localApp.webs.find(({configuration}) => configuration.type === WebType.Frontend)
  const backendConfig = localApp.webs.find(({configuration}) => configuration.type === WebType.Backend)
  const webhooksPath = backendConfig?.configuration?.webhooksPath || '/api/webhooks'
  const sendUninstallWebhook = Boolean(webhooksPath) && remoteAppUpdated

  const initiateUpdateUrls = (frontendConfig || backendConfig) && options.update
  let shouldUpdateURLs = false

  await validateCustomPorts(backendConfig, frontendConfig)

  const [{frontendUrl, frontendPort, usingLocalhost}, backendPort, currentURLs] = await Promise.all([
    generateFrontendURL({
      ...options,
      app: localApp,
      useCloudflareTunnels,
    }),
    backendConfig?.configuration.port || getAvailableTCPPort(),
    getURLs(apiKey, token),
  ])

  /** If the app doesn't have web/ the link message is not necessary */
  const exposedUrl = usingLocalhost ? `${frontendUrl}:${frontendPort}` : frontendUrl
  const proxyTargets: ReverseHTTPProxyTarget[] = []
  const proxyPort = usingLocalhost ? await getAvailableTCPPort() : frontendPort
  const proxyUrl = usingLocalhost ? `${frontendUrl}:${proxyPort}` : frontendUrl

  let previewUrl

  if (initiateUpdateUrls) {
    const newURLs = generatePartnersURLs(exposedUrl, backendConfig?.configuration.authCallbackPath)
    shouldUpdateURLs = await shouldOrPromptUpdateURLs({
      currentURLs,
      appDirectory: localApp.directory,
      cachedUpdateURLs,
      newApp: remoteApp.newApp,
    })
    if (shouldUpdateURLs) await updateURLs(newURLs, apiKey, token)
    await outputUpdateURLsResult(shouldUpdateURLs, newURLs, remoteApp)
    previewUrl = buildAppURLForWeb(storeFqdn, exposedUrl)
  }

  if (localApp.extensions.ui.length > 0) {
    previewUrl = `${proxyUrl}/extensions/dev-console`
  }

  // If we have a real UUID for an extension, use that instead of a random one
  const prodEnvIdentifiers = getAppIdentifiers({app: localApp})
  const envExtensionsIds = prodEnvIdentifiers.extensions || {}
  const extensionsIds = prodEnvIdentifiers.app === apiKey ? envExtensionsIds : {}
  localApp.extensions.ui.forEach((ext) => (ext.devUUID = extensionsIds[ext.localIdentifier] ?? ext.devUUID))

  const {extensionIds: remoteExtensions} = await ensureDeploymentIdsPresence({
    app: localApp,
    appId: apiKey,
    appName: remoteApp.title,
    force: true,
    token,
    envIdentifiers: prodEnvIdentifiers,
  })

  const backendOptions = {
    apiKey,
    backendPort,
    scopes: localApp.configuration.scopes,
    apiSecret: (remoteApp.apiSecret as string) ?? '',
    hostname: exposedUrl,
  }

  const [previewableExtensions, nonPreviewableExtensions] = partition(
    localApp.extensions.ui,
    (ext) => ext.isPreviewable,
  )

  if (previewableExtensions.length > 0) {
    const devExt = await devUIExtensionsTarget({
      app: localApp,
      id: remoteApp.id,
      apiKey,
      url: proxyUrl,
      storeFqdn,
      grantedScopes: remoteApp.grantedScopes,
      subscriptionProductUrl: options.subscriptionProductUrl,
      checkoutCartUrl: options.checkoutCartUrl,
      extensions: previewableExtensions,
    })
    proxyTargets.push(devExt)
  }

  // Remove this once theme app extensions and functions are displayed
  // by the dev console
  outputExtensionsMessages(localApp)

  const additionalProcesses: OutputProcess[] = []

  if (nonPreviewableExtensions.length > 0) {
    additionalProcesses.push(
      await devNonPreviewableExtensionTarget({
        app: localApp,
        apiKey,
        url: proxyUrl,
        token,
        extensions: nonPreviewableExtensions,
        remoteExtensions,
      }),
    )
  }

  if (localApp.extensions.theme.length > 0) {
    const adminSession = await ensureAuthenticatedAdmin(storeFqdn)
    const extension = localApp.extensions.theme[0]!
    let optionsToOverwrite = {}
    if (!options.theme) {
      const theme = await new HostThemeManager(adminSession).findOrCreate()
      optionsToOverwrite = {
        theme: theme.id.toString(),
        generateTmpTheme: true,
      }
    }
    const [storefrontToken, args] = await Promise.all([
      ensureAuthenticatedStorefront(),
      themeExtensionArgs(extension, apiKey, token, {...options, ...optionsToOverwrite}),
    ])
    const devExt = devThemeExtensionTarget(args, adminSession, storefrontToken, token)
    additionalProcesses.push(devExt)
  }

  if (backendConfig) {
    additionalProcesses.push(await devBackendTarget(backendConfig, backendOptions))
  }

  if (frontendConfig) {
    const frontendOptions: DevFrontendTargetOptions = {
      web: frontendConfig,
      apiKey,
      scopes: localApp.configuration.scopes,
      apiSecret: (remoteApp.apiSecret as string) ?? '',
      hostname: frontendUrl,
      backendPort,
    }

    if (usingLocalhost) {
      additionalProcesses.push(devFrontendNonProxyTarget(frontendOptions, frontendPort))
    } else {
      proxyTargets.push(devFrontendProxyTarget(frontendOptions))
    }
  }

  if (sendUninstallWebhook) {
    additionalProcesses.push({
      prefix: 'webhooks',
      action: async (stdout: Writable, stderr: Writable, signal: AbortSignal) => {
        await sendUninstallWebhookToAppServer({
          stdout,
          token,
          address: `http://localhost:${backendOptions.backendPort}${webhooksPath}`,
          sharedSecret: backendOptions.apiSecret,
          storeFqdn,
        })
      },
    })
  }

  await logMetadataForDev({devOptions: options, tunnelUrl: frontendUrl, shouldUpdateURLs, storeFqdn})

  await reportAnalyticsEvent({config: options.commandConfig})

  if (proxyTargets.length === 0) {
    await renderConcurrent({processes: additionalProcesses})
  } else {
    await runConcurrentHTTPProcessesAndPathForwardTraffic({
      previewUrl,
      portNumber: proxyPort,
      proxyTargets,
      additionalProcesses,
    })
  }
}

interface DevFrontendTargetOptions extends DevWebOptions {
  web: Web
  backendPort: number
}

function devFrontendNonProxyTarget(options: DevFrontendTargetOptions, port: number): OutputProcess {
  const devFrontend = devFrontendProxyTarget(options)
  return {
    prefix: devFrontend.logPrefix,
    action: async (stdout: Writable, stderr: Writable, signal: AbortSignal) => {
      await devFrontend.action(stdout, stderr, signal, port)
    },
  }
}

function devThemeExtensionTarget(
  args: string[],
  adminSession: AdminSession,
  storefrontToken: string,
  token: string,
): OutputProcess {
  return {
    prefix: 'extensions',
    action: async (stdout: Writable, stderr: Writable, signal: AbortSignal) => {
      await execCLI2(['extension', 'serve', ...args], {adminSession, storefrontToken, token, stdout, stderr, signal})
    },
  }
}

function devFrontendProxyTarget(options: DevFrontendTargetOptions): ReverseHTTPProxyTarget {
  const {commands} = options.web.configuration
  const [cmd, ...args] = commands.dev.split(' ')

  return {
    logPrefix: options.web.configuration.type,
    customPort: options.web.configuration.port,
    action: async (stdout: Writable, stderr: Writable, signal: AbortSignal, port: number) => {
      await exec(cmd!, args, {
        cwd: options.web.directory,
        stdout,
        stderr,
        env: {
          ...(await getDevEnvironmentVariables(options)),
          BACKEND_PORT: `${options.backendPort}`,
          PORT: `${port}`,
          FRONTEND_PORT: `${port}`,
          APP_URL: options.hostname,
          APP_ENV: 'development',
          // Note: These are Laravel varaibles for backwards compatibility with 2.0 templates.
          SERVER_PORT: `${port}`,
        },
        signal,
      })
    },
  }
}

async function getDevEnvironmentVariables(options: DevWebOptions) {
  return {
    ...process.env,
    SHOPIFY_API_KEY: options.apiKey,
    SHOPIFY_API_SECRET: options.apiSecret,
    HOST: options.hostname,
    SCOPES: options.scopes,
    NODE_ENV: `development`,
    ...(isSpinEnvironment() && {
      SHOP_CUSTOM_DOMAIN: `shopify.${await spinFqdn()}`,
    }),
  }
}

async function devBackendTarget(web: Web, options: DevWebOptions): Promise<OutputProcess> {
  const {commands} = web.configuration
  const [cmd, ...args] = commands.dev.split(' ')
  const env = {
    ...(await getDevEnvironmentVariables(options)),
    // SERVER_PORT is the convention Artisan uses
    PORT: `${options.backendPort}`,
    SERVER_PORT: `${options.backendPort}`,
    BACKEND_PORT: `${options.backendPort}`,
  }

  return {
    prefix: web.configuration.type,
    action: async (stdout: Writable, stderr: Writable, signal: AbortSignal) => {
      await exec(cmd!, args, {
        cwd: web.directory,
        stdout,
        stderr,
        signal,
        env: {
          ...process.env,
          ...env,
        },
      })
    },
  }
}

interface DevUIExtensionsTargetOptions {
  app: AppInterface
  apiKey: string
  url: string
  storeFqdn: string
  grantedScopes: string[]
  id?: string
  subscriptionProductUrl?: string
  checkoutCartUrl?: string
  extensions: UIExtension[]
}

async function devUIExtensionsTarget({
  app,
  apiKey,
  id,
  url,
  storeFqdn,
  grantedScopes,
  subscriptionProductUrl,
  checkoutCartUrl,
  extensions,
}: DevUIExtensionsTargetOptions): Promise<ReverseHTTPProxyTarget> {
  const cartUrl = await buildCartURLIfNeeded(extensions, storeFqdn, checkoutCartUrl)
  return {
    logPrefix: 'extensions',
    pathPrefix: '/extensions',
    action: async (stdout: Writable, stderr: Writable, signal: AbortSignal, port: number) => {
      await devUIExtensions({
        app,
        id,
        extensions,
        stdout,
        stderr,
        signal,
        url,
        port,
        storeFqdn,
        apiKey,
        grantedScopes,
        checkoutCartUrl: cartUrl,
        subscriptionProductUrl,
      })
    },
  }
}

interface DevNonPreviewableExtensionsOptions {
  app: AppInterface
  apiKey: string
  url: string
  token: string
  extensions: UIExtension[]
  remoteExtensions: {
    [key: string]: string
  }
}

async function devNonPreviewableExtensionTarget({
  extensions,
  app,
  url,
  apiKey,
  token,
  remoteExtensions,
}: DevNonPreviewableExtensionsOptions) {
  return {
    prefix: 'extensions',
    action: async (stdout: Writable, stderr: Writable, signal: AbortSignal) => {
      await Promise.all(
        extensions.map((extension) => {
          const registrationId = remoteExtensions[extension.localIdentifier]
          if (!registrationId) throw new AbortError(`Extension ${extension.localIdentifier} not found on remote app.`)

          return bundleExtension({
            minify: false,
            outputBundlePath: extension.outputBundlePath,
            environment: 'development',
            env: {
              ...(app.dotenv?.variables ?? {}),
              APP_URL: url,
            },
            stdin: {
              contents: extension.getBundleExtensionStdinContent(),
              resolveDir: extension.directory,
              loader: 'tsx',
            },
            stderr,
            stdout,
            watchSignal: signal,

            watch: async (result) => {
              const error = (result?.errors?.length ?? 0) > 0
              outputDebug(
                `The Javascript bundle of the extension with ID ${extension.devUUID} has ${
                  error ? 'an error' : 'changed'
                }`,
                error ? stderr : stdout,
              )
              if (error) return

              const content = await readFile(extension.outputBundlePath)
              if (!content) return
              const encodedFile = Buffer.from(content).toString('base64')

              const extensionInput: ExtensionUpdateDraftInput = {
                apiKey,
                config: JSON.stringify({
                  ...(await extension.deployConfig()),
                  serialized_script: encodedFile,
                }),
                context: undefined,
                registrationId,
              }
              const mutation = ExtensionUpdateDraftMutation

              const mutationResult: ExtensionUpdateSchema = await partnersRequest(mutation, token, extensionInput)
              if (mutationResult.extensionUpdateDraft?.userErrors?.length > 0) {
                const errors = mutationResult.extensionUpdateDraft.userErrors.map((error) => error.message).join(', ')
                stderr.write(`Error while updating drafts: ${errors}`)
              } else {
                outputDebug(`Drafts updated successfully for extension: ${extension.localIdentifier}`)
              }

              //TODO: watch for toml changes
            },
          })
        }),
      )
    },
  }
}

/**
 * To prepare Checkout UI Extensions for dev'ing we need to retrieve a valid product variant ID
 * @param extensions - The UI Extensions to dev
 * @param store - The store FQDN
 */
async function buildCartURLIfNeeded(extensions: UIExtension[], store: string, checkoutCartUrl?: string) {
  const hasUIExtension = extensions.map((ext) => ext.type).includes('checkout_ui_extension')
  if (!hasUIExtension) return undefined
  if (checkoutCartUrl) return checkoutCartUrl
  const variantId = await fetchProductVariant(store)
  return `/cart/${variantId}:1`
}

async function logMetadataForDev(options: {
  devOptions: DevOptions
  tunnelUrl: string
  shouldUpdateURLs: boolean
  storeFqdn: string
}) {
  const tunnelType = await getAnalyticsTunnelType(options.devOptions.commandConfig, options.tunnelUrl)
  await metadata.addPublicMetadata(() => ({
    cmd_dev_tunnel_type: tunnelType,
    cmd_dev_tunnel_custom_hash: tunnelType === 'custom' ? hashString(options.tunnelUrl) : undefined,
    cmd_dev_urls_updated: options.shouldUpdateURLs,
    store_fqdn_hash: hashString(options.storeFqdn),
    cmd_app_dependency_installation_skipped: options.devOptions.skipDependenciesInstallation,
    cmd_app_reset_used: options.devOptions.reset,
  }))

  await metadata.addSensitiveMetadata(() => ({
    store_fqdn: options.storeFqdn,
    cmd_dev_tunnel_custom: tunnelType === 'custom' ? options.tunnelUrl : undefined,
  }))
}

async function validateCustomPorts(backendConfig?: Web, frontendConfig?: Web) {
  const backendPort = backendConfig?.configuration.port
  const frontendPort = frontendConfig?.configuration.port
  if (backendPort && frontendPort && backendPort === frontendPort) {
    throw new AbortError(`Backend and frontend ports must be different. Found ${backendPort} for both.`)
  }

  if (backendPort) {
    const portAvailable = await checkPortAvailability(backendPort)
    if (!portAvailable) {
      throw new AbortError(`Backend port ${backendPort} is not available, please choose a different one.`)
    }
  }

  if (frontendPort) {
    const portAvailable = await checkPortAvailability(frontendPort)
    if (!portAvailable) {
      throw new AbortError(`Frontend port ${frontendPort} is not available, please choose a different one.`)
    }
  }
}

export default dev
