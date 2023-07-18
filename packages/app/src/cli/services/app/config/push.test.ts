import {Options, pushConfig} from './push.js'
import {DEFAULT_CONFIG, testApp} from '../../../models/app/app.test-data.js'
import {describe, vi, test, expect} from 'vitest'
import {partnersRequest} from '@shopify/cli-kit/node/api/partners'
import {renderSuccess} from '@shopify/cli-kit/node/ui'

vi.mock('@shopify/cli-kit/node/ui')
vi.mock('@shopify/cli-kit/node/api/partners')
vi.mock('@shopify/cli-kit/node/session')

describe('pushConfig', () => {
  test('successfully calls the update mutation when push is run and a file is present', async () => {
    const app = testApp({}, 'current')
    const options: Options = {
      configuration: app.configuration,
      configurationPath: app.configurationPath,
    }

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {
        apiKey: '12345',
      },
      appUpdate: {
        userErrors: [],
      },
    })

    await pushConfig(options)

    expect(vi.mocked(partnersRequest).mock.calls[1]![2]!).toEqual({
      apiKey: '12345',
      applicationUrl: 'https://myapp.com',
      embedded: true,
      gdprWebhooks: {
        customerDataRequestUrl: undefined,
        customerDeletionUrl: undefined,
        shopDeletionUrl: undefined,
      },
      posEmbedded: false,
      preferencesUrl: null,
      redirectUrlAllowlist: null,
      requestedAccessScopes: ['read_products'],
      title: 'my app',
      webhookApiVersion: '2023-04',
    })

    expect(renderSuccess).toHaveBeenCalledWith({
      headline: 'Updated app configuration for my app',
      body: ['shopify.app.toml configuration is now live on Shopify.'],
    })
  })

  test('successfully calls the update mutation without scopes when legacy behavior. does not call scopes clear when upstream doesnt have scopes.', async () => {
    const app = testApp({}, 'current')

    app.configuration = {...app.configuration, access_scopes: {scopes: 'write_products', use_legacy_install_flow: true}}
    const options: Options = {
      configuration: app.configuration,
      configurationPath: app.configurationPath,
    }

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {
        apiKey: '12345',
      },
      appUpdate: {
        userErrors: [],
      },
    })

    await pushConfig(options)

    expect(vi.mocked(partnersRequest).mock.calls[1]![2]!).toEqual({
      apiKey: '12345',
      applicationUrl: 'https://myapp.com',
      embedded: true,
      gdprWebhooks: {
        customerDataRequestUrl: undefined,
        customerDeletionUrl: undefined,
        shopDeletionUrl: undefined,
      },
      posEmbedded: false,
      preferencesUrl: null,
      redirectUrlAllowlist: null,
      title: 'my app',
      webhookApiVersion: '2023-04',
    })

    expect(vi.mocked(partnersRequest).mock.calls.length).toEqual(2)

    expect(renderSuccess).toHaveBeenCalledWith({
      headline: 'Updated app configuration for my app',
      body: ['shopify.app.toml configuration is now live on Shopify.'],
    })
  })

  test('successfully calls the update mutation without scopes when legacy behavior. does call scopes clear when upstream has scopes.', async () => {
    const app = testApp({}, 'current')

    app.configuration = {...app.configuration, access_scopes: {scopes: 'write_products', use_legacy_install_flow: true}}
    const options: Options = {
      configuration: app.configuration,
      configurationPath: app.configurationPath,
    }

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {
        apiKey: '12345',
        requestedAccessScopes: ['read_orders'],
      },
      appUpdate: {
        userErrors: [],
      },
    })

    await pushConfig(options)

    expect(vi.mocked(partnersRequest).mock.calls[1]![2]!).toEqual({
      apiKey: '12345',
      applicationUrl: 'https://myapp.com',
      embedded: true,
      gdprWebhooks: {
        customerDataRequestUrl: undefined,
        customerDeletionUrl: undefined,
        shopDeletionUrl: undefined,
      },
      posEmbedded: false,
      preferencesUrl: null,
      redirectUrlAllowlist: null,
      title: 'my app',
      webhookApiVersion: '2023-04',
    })

    expect(vi.mocked(partnersRequest).mock.calls[2]![0]!).toContain('appRequestedAccessScopesClear')
    expect(vi.mocked(partnersRequest).mock.calls[2]![2]!).toEqual({apiKey: '12345'})

    expect(renderSuccess).toHaveBeenCalledWith({
      headline: 'Updated app configuration for my app',
      body: ['shopify.app.toml configuration is now live on Shopify.'],
    })
  })

  test('successfully calls the update mutation with empty scopes', async () => {
    const app = testApp({}, 'current')
    app.configuration = {...app.configuration, access_scopes: {scopes: ''}}

    const options: Options = {
      configuration: app.configuration,
      configurationPath: app.configurationPath,
    }

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {
        apiKey: '12345',
      },
      appUpdate: {
        userErrors: [],
      },
    })

    await pushConfig(options)

    expect(vi.mocked(partnersRequest).mock.calls[1]![2]!).toEqual({
      apiKey: '12345',
      applicationUrl: 'https://myapp.com',
      embedded: true,
      gdprWebhooks: {
        customerDataRequestUrl: undefined,
        customerDeletionUrl: undefined,
        shopDeletionUrl: undefined,
      },
      posEmbedded: false,
      preferencesUrl: null,
      redirectUrlAllowlist: null,
      title: 'my app',
      requestedAccessScopes: [],
      webhookApiVersion: '2023-04',
    })

    expect(renderSuccess).toHaveBeenCalledWith({
      headline: 'Updated app configuration for my app',
      body: ['shopify.app.toml configuration is now live on Shopify.'],
    })
  })

  test('deletes requested access scopes when scopes are omitted', async () => {
    const app = testApp({}, 'current')
    app.configuration = {...app.configuration, access_scopes: undefined}

    const options: Options = {
      configuration: app.configuration,
      configurationPath: app.configurationPath,
    }

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {
        apiKey: '12345',
        requestedAccessScopes: ['read_orders'],
      },
      appUpdate: {
        userErrors: [],
      },
    })

    await pushConfig(options)

    expect(vi.mocked(partnersRequest).mock.calls[1]![2]!).toEqual({
      apiKey: '12345',
      applicationUrl: 'https://myapp.com',
      embedded: true,
      gdprWebhooks: {
        customerDataRequestUrl: undefined,
        customerDeletionUrl: undefined,
        shopDeletionUrl: undefined,
      },
      posEmbedded: false,
      preferencesUrl: null,
      redirectUrlAllowlist: null,
      title: 'my app',
      webhookApiVersion: '2023-04',
    })

    expect(vi.mocked(partnersRequest).mock.calls[2]![0]!).toContain('appRequestedAccessScopesClear')
    expect(vi.mocked(partnersRequest).mock.calls[2]![2]!).toEqual({apiKey: '12345'})
    expect(renderSuccess).toHaveBeenCalledWith({
      headline: 'Updated app configuration for my app',
      body: ['shopify.app.toml configuration is now live on Shopify.'],
    })
  })

  test('returns error when client id cannot be found', async () => {
    // Given
    const {configuration, configurationPath} = testApp({}, 'current')
    const options: Options = {configuration, configurationPath}

    vi.mocked(partnersRequest).mockResolvedValue({app: null})

    // When
    const result = pushConfig(options)

    // Then
    await expect(result).rejects.toThrow("Couldn't find app. Make sure you have a valid client ID.")
  })

  test('returns error when update mutation fails', async () => {
    // Given
    const {configuration, configurationPath} = testApp({}, 'current')
    const options: Options = {configuration, configurationPath}

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {id: 1, apiKey: DEFAULT_CONFIG.client_id},
      appUpdate: {
        userErrors: [{message: 'failed to update app'}],
      },
    })

    // When
    const result = pushConfig(options)

    // Then
    await expect(result).rejects.toThrow('failed to update app')
  })

  test('returns error with field names when update mutation fails and userErrors includes field', async () => {
    // Given
    const {configuration, configurationPath} = testApp({}, 'current')
    const options: Options = {configuration, configurationPath}

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {id: 1, apiKey: DEFAULT_CONFIG.client_id},
      appUpdate: {
        userErrors: [
          {message: "I don't like this name", field: ['input', 'title']},
          {message: 'funny api key', field: ['input', 'api_key']},
          {message: 'this url is blocked', field: ['input', 'application_url']},
          {message: 'suspicious', field: ['input', 'redirect_url_whitelist']},
          {message: 'invalid scope: read_minds', field: ['input', 'requested_access_scopes']},
          {message: 'no.', field: ['input', 'webhook_api_version']},
          {message: 'funny object', field: ['input', 'gdpr_webhooks']},
          {message: 'this url is blocked 2', field: ['input', 'gdpr_webhooks', 'customer_deletion_url']},
          {message: 'this url is blocked 3', field: ['input', 'gdpr_webhooks', 'customer_data_request_url']},
          {message: 'this url is blocked 4', field: ['input', 'gdpr_webhooks', 'shop_deletion_url']},
          {message: 'subpath needs to be good', field: ['input', 'proxy_sub_path']},
          {message: 'prefix is invalid', field: ['input', 'proxy_sub_path_prefix']},
          {message: 'this url is blocked 5', field: ['input', 'proxy_url']},
          {message: 'this url is blocked 6', field: ['input', 'preferences_url']},
        ],
      },
    })

    // When
    const result = pushConfig(options)

    // Then
    await expect(result).rejects.toThrow(`name: I don't like this name
client_id: funny api key
application_url: this url is blocked
auth > redirect_urls: suspicious
access_scopes > scopes: invalid scope: read_minds
webhooks > api_version: no.
webhooks.privacy_compliance: funny object
webhooks.privacy_compliance > customer_deletion_url: this url is blocked 2
webhooks.privacy_compliance > customer_data_request_url: this url is blocked 3
webhooks.privacy_compliance > shop_deletion_url: this url is blocked 4
app_proxy > subpath: subpath needs to be good
app_proxy > prefix: prefix is invalid
app_proxy > url: this url is blocked 5
app_preferences > url: this url is blocked 6`)
  })

  test('app proxy is updated upstream when defined', async () => {
    const app = testApp({}, 'current')
    app.configuration = {
      ...app.configuration,
      app_proxy: {
        url: 'https://foo/',
        subpath: 'foo',
        prefix: 'foo',
      },
    }

    const options: Options = {
      configuration: app.configuration,
      configurationPath: app.configurationPath,
    }

    vi.mocked(partnersRequest).mockResolvedValue({
      app: {
        apiKey: '12345',
      },
      appUpdate: {
        userErrors: [],
      },
    })

    await pushConfig(options)

    expect(vi.mocked(partnersRequest).mock.calls[1]![2]!).toEqual({
      apiKey: '12345',
      title: 'my app',
      applicationUrl: 'https://myapp.com',
      gdprWebhooks: {
        customerDataRequestUrl: undefined,
        customerDeletionUrl: undefined,
        shopDeletionUrl: undefined,
      },
      webhookApiVersion: '2023-04',
      redirectUrlAllowlist: null,
      requestedAccessScopes: ['read_products'],
      embedded: true,
      posEmbedded: false,
      preferencesUrl: null,
      appProxy: {
        proxySubPath: 'foo',
        proxySubPathPrefix: 'foo',
        proxyUrl: 'https://foo/',
      },
    })

    expect(renderSuccess).toHaveBeenCalledWith({
      headline: 'Updated app configuration for my app',
      body: ['shopify.app.toml configuration is now live on Shopify.'],
    })
  })
})
