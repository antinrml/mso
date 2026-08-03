// CredentialStore — the multi-tenant seam both openclaw and hermes lack.
// Everything routes through getKey(tenantId, provider). Swap the impl to change where
// BYOK keys live (env, memory, Convex, your own DB) without touching resolve logic.
//
// @typedef {object} CredentialStore
// @property {(tenantId:string|undefined, provider:string)=>Promise<string|null>} getKey
// @property {(tenantId:string|undefined, provider:string, key:string)=>Promise<void>} [setKey]
// @property {(tenantId:string|undefined, provider:string)=>Promise<void>} [deleteKey]
// @property {(tenantId:string|undefined)=>Promise<string[]>} [listProviders]

import { PROVIDERS } from './registry.js'

/**
 * Single-tenant / dev store: reads keys from env using each provider's envVars chain.
 * Priority stolen from openclaw: MODELS_LIVE_<P>_KEY override wins, then the ordered chain.
 * @returns {CredentialStore}
 */
export function envCredentialStore() {
  return {
    async getKey(_tenantId, provider) {
      const live = process.env[`MODELS_LIVE_${provider.toUpperCase()}_KEY`]
      if (live) return live
      const vars = PROVIDERS[provider]?.envVars || [`${provider.toUpperCase()}_API_KEY`]
      for (const v of vars) if (process.env[v]) return process.env[v]
      return null
    },
    async setKey() { throw new Error('envCredentialStore is read-only') },
  }
}
