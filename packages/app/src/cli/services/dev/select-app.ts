import {appNamePrompt, createAsNewAppPrompt, selectAppPrompt} from '../../prompts/dev.js'
import {Organization, OrganizationApp} from '../../models/organization.js'
import {fetchAppFromApiKey, OrganizationAppsResponse} from '../dev/fetch.js'
import {CreateAppQuery, CreateAppQuerySchema} from '../../api/graphql/create_app.js'
import {partnersRequest} from '@shopify/cli-kit/node/api/partners'
import {AbortError} from '@shopify/cli-kit/node/error'
import {outputInfo} from '@shopify/cli-kit/node/output'

/**
 * Select an app from env, list or create a new one:
 * If there is no valid app yet, prompt the user to select one from the list or create a new one.
 * If no apps exists, we automatically prompt the user to create a new one.
 * @param app - Current local app information
 * @param apps - List of remote available apps
 * @param orgId - Current Organization
 * @returns The selected (or created) app
 */
export async function selectOrCreateApp(
  localAppName: string,
  apps: OrganizationAppsResponse,
  org: Organization,
  token: string,
  isLaunchable?: boolean,
): Promise<OrganizationApp> {
  let createNewApp = apps.nodes.length === 0
  if (!createNewApp) {
    outputInfo(`\nBefore proceeding, your project needs to be associated with an app.\n`)
    createNewApp = await createAsNewAppPrompt()
  }
  if (createNewApp) {
    return createApp(org, localAppName, token, isLaunchable)
  } else {
    const selectedAppApiKey = await selectAppPrompt(apps, org.id, token)
    const fullSelectedApp = await fetchAppFromApiKey(selectedAppApiKey, token)
    return fullSelectedApp!
  }
}

// this is a temporary solution for editions to support https://vault.shopify.io/gsd/projects/31406
// read more here: https://vault.shopify.io/gsd/projects/31406
const MAGIC_URL = 'https://shopify.dev/apps/default-app-home'
const MAGIC_REDIRECT_URL = 'https://shopify.dev/apps/default-app-home/api/auth'
const getAppVars = (org: Organization, name: string, isLaunchable = true) => {
  if (isLaunchable) {
    return {
      org: parseInt(org.id, 10),
      title: `${name}`,
      appUrl: 'https://example.com',
      redir: ['https://example.com/api/auth'],
      type: 'undecided',
    }
  } else {
    return {
      org: parseInt(org.id, 10),
      title: `${name}`,
      appUrl: MAGIC_URL,
      redir: [MAGIC_REDIRECT_URL],
      requestedAccessScopes: [],
      type: 'undecided',
    }
  }
}

export async function createApp(
  org: Organization,
  appName: string,
  token: string,
  isLaunchable?: boolean,
): Promise<OrganizationApp> {
  const name = await appNamePrompt(appName)

  const variables = getAppVars(org, name, isLaunchable)

  const query = CreateAppQuery
  const result: CreateAppQuerySchema = await partnersRequest(query, token, variables)
  if (result.appCreate.userErrors.length > 0) {
    const errors = result.appCreate.userErrors.map((error) => error.message).join(', ')
    throw new AbortError(errors)
  }

  const createdApp: OrganizationApp = result.appCreate.app
  createdApp.organizationId = org.id
  createdApp.newApp = true
  return createdApp
}
