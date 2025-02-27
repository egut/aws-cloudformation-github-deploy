import * as fs from 'fs'
import { Parameter } from '@aws-sdk/client-cloudformation'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { Tag } from '@aws-sdk/client-cloudformation'
import { yaml } from 'js-yaml'

export function isUrl(s: string): boolean {
  let url

  try {
    url = new URL(s)
  } catch (_) {
    return false
  }

  return url.protocol === 'https:'
}

export function parseTags(s: string): Tag[] | undefined {
  if (!s || s.trim() === '') {
    return undefined
  }

  let tags

  // Try to parse as JSON first (backward compatibility)
  try {
    tags = JSON.parse(s)
    return tags
  } catch (_) {
    // JSON parsing failed, try to parse as YAML
  }

  // If JSON parsing fails, try to handle as YAML
  try {
    const parsed = yaml.load(s)

    if (!parsed) {
      return undefined
    }

    // Handle the two YAML structure formats
    if (Array.isArray(parsed)) {
      // Already in the format [{Key: 'key', Value: 'value'}, ...]
      return parsed
    } else if (typeof parsed === 'object') {
      // Convert from {Key1: 'Value1', Key2: 'Value2'} format
      return Object.entries(parsed).map(([Key, Value]) => ({ Key, Value }))
    }
  } catch (_) {
    // YAML parsing failed
    return undefined
  }

  return undefined
}

export function parseARNs(s: string): string[] | undefined {
  return s?.length > 0 ? s.split(',') : undefined
}

export function parseString(s: string): string | undefined {
  return s?.length > 0 ? s : undefined
}

export function parseNumber(s: string): number | undefined {
  return parseInt(s) || undefined
}

type CFParameterValue = string | string[] | boolean
type CFParameterObject = Record<string, CFParameterValue>
export function parseParameters(
  parameterOverrides: string | Record<string, CFParameterObject>
): Parameter[] {
  // Case 1: Handle native YAML objects
  if (parameterOverrides && typeof parameterOverrides !== 'string') {
    return Object.keys(parameterOverrides).map(key => {
      const value = parameterOverrides[key]
      return {
        ParameterKey: key,
        ParameterValue:
          typeof value === 'string' ? value : JSON.stringify(value)
      }
    })
  }

  // Case 2: Empty string
  if (!parameterOverrides) {
    return []
  }

  // Case 3: URL to JSON file
  try {
    const path = new URL(parameterOverrides)
    const rawParameters = fs.readFileSync(path, 'utf-8')

    return JSON.parse(rawParameters)
  } catch (err) {
    // @ts-expect-error: Object is of type 'unknown'
    if (err.code !== 'ERR_INVALID_URL') {
      throw err
    }
  }

  // Case 4: String format "key=value,key2=value2"
  const parameters = new Map<string, string>()
  parameterOverrides
    .split(/,(?=(?:(?:[^"']*["|']){2})*[^"']*$)/g)
    .forEach(parameter => {
      const values = parameter.trim().split('=')
      const key = values[0]
      // Corrects values that have an = in the value
      const value = values.slice(1).join('=')
      let param = parameters.get(key)
      param = !param ? value : [param, value].join(',')
      // Remove starting and ending quotes
      if (
        (param.startsWith("'") && param.endsWith("'")) ||
        (param.startsWith('"') && param.endsWith('"'))
      ) {
        param = param.substring(1, param.length - 1)
      }
      parameters.set(key, param)
    })

  return [...parameters.keys()].map(key => {
    return {
      ParameterKey: key,
      ParameterValue: parameters.get(key)
    }
  })
}

export function configureProxy(
  proxyServer: string | undefined
): HttpsProxyAgent | undefined {
  const proxyFromEnv = process.env.HTTP_PROXY || process.env.http_proxy

  if (proxyFromEnv || proxyServer) {
    let proxyToSet = null

    if (proxyServer) {
      console.log(`Setting proxy from actions input: ${proxyServer}`)
      proxyToSet = proxyServer
    } else {
      console.log(`Setting proxy from environment: ${proxyFromEnv}`)
      proxyToSet = proxyFromEnv
    }

    if (proxyToSet) {
      return new HttpsProxyAgent(proxyToSet)
    }
  }
}
