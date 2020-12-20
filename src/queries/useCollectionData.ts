import { useContext, useEffect, useRef, useState } from "react"
import { FilterExpressionList, FilterExpressionResult } from "./expressions"
import { Entity } from "./Entity"
import { LiveQueryContext, RealtimeUpdateItem } from "../LiveQueryContext"
import { formatFilters } from "./formatFilters"
import { FiltersBuilderHook } from "./FiltersBuilderHook"
import { CacheOption, Request, RequestHook, RequestOptions } from "../request/Request"


export type useCollectionDataOptions<T extends Entity> = {
  limit: number,
  where: FilterExpressionList<T>
  fields: string
  reatime: boolean | Function,
  cache: CacheOption | true
}

function useMutex() {
  const mutex = useRef(false)

  return {
    locking: mutex.current,
    lock: () => mutex.current = true,
    unlock: () => mutex.current = false
  }
}

function getRealtimeRef(ref: string) {
  const trimedRef = ref.split('?')[0].replace(/^\/+|\/+$/g, '')
  const refs = trimedRef.split('/')
  const isCollection = refs.length % 2 == 1
  const realtimeRef = refs.slice(0, refs.length - (isCollection ? 0 : 1)).join('/')
  return { realtimeRef, isCollection }
}

export const useCollectionData = <T extends Entity>(
  ref: string,
  options: Partial<useCollectionDataOptions<T>> = {}
) => {


  const ctx = useContext(LiveQueryContext)
  const { isCollection, realtimeRef } = getRealtimeRef(ref)

  // Hook main state
  const [{ error, loading, cursor, has_more, items, filters }, setState] = useState<{
    items: T[],
    loading: boolean,
    error: any,
    has_more: boolean,
    cursor: string,
    filters: FilterExpressionResult<T>
  }>({
    items: [],
    loading: true,
    error: null,
    has_more: false,
    cursor: null,
    filters: formatFilters(options.where)
  })


  // Fetch data 
  const PreventDuplicateMutex = useMutex()
  async function fetch_data(
    query_filters: FilterExpressionList<T> = {},
    cache_config: CacheOption = (options.cache == true ? { update: true, use: true } : options.cache),
    flush: boolean = true
  ) {

    if (PreventDuplicateMutex.locking) return
    PreventDuplicateMutex.lock()

    try {
      const filters = formatFilters(query_filters)
      setState(s => ({
        ...s,
        error: null,
        loading: true,
        filters,
        items: flush ? [] : s.items
      }))


      const opts = await ctx.options()
      const request_options: RequestOptions & { hooks: RequestHook[] } = {
        ...opts,
        uri: ref,
        cache: cache_config,
        query: {
          _limit: options.limit,
          _fields: options.fields,
          ...filters as any,
          ...opts.query || {}
        },
        hooks: [FiltersBuilderHook]
      }

      // If collection
      if (isCollection) {
        const { data } = await ctx.request(request_options)

        setState(s => {
          const items = [...s.items, ...data?.items || []]
          return {
            ...s,
            cursor: data?.cursor || null,
            items,
            error: null,
            has_more: data?.has_more || false,
            loading: false
          }
        })

        // If not colleciton
      } else {
        const item = await ctx.request<T>(request_options)
        setState(s => ({ ...s, items: item ? [item] : [] }))
      }

    } catch (error) {
      setState(s => ({ ...s, error, loading: false }))
      console.error(error)
    }
    PreventDuplicateMutex.unlock()
  }

  // Sync data realtime
  const realtime_sync = ({ items }: { items: RealtimeUpdateItem[] }) => setState(s => {
    const updated_items = items.reduce((p, c) => (
      c.type == 'modified' && c.data.id && p.set(c.data.id, c.data),
      p
    ), new Map())
    const deleted_items = new Set(items.filter(d => d.type == 'remove').map(d => d.data.id))
    const add_items = items.filter(d => d.type == 'add').map(d => d.data)

    return {
      ...s,
      items: [
        ...add_items,
        ...s.items
          .filter(i => !deleted_items.has(i.id))
          .map(item => ({ ...item, ...updated_items.get(item.id) || {} }))
      ]
    }
  })


  // Load data & realtime update listener
  useEffect(() => {
    // Fetch
    if (!ref) return
    fetch_data(options.where)

    // Socket
    if (options.reatime != false) {
      ctx.on(realtimeRef, realtime_sync)
      return () => ctx.off(realtimeRef, realtime_sync)
    }
  }, [ref])




  // Reload on connected
  useEffect(() => {
    const handler = (n: number) => {
      if (!ref || (n == 0 && !error)) return

      // Reload
      () => fetch_data(filters, {})
    }
    ctx.on('connected', handler)
    return () => ctx.off('connected', handler)
  })

  return {
    items,
    loading,
    error,
    reload: () => fetch_data(filters, {}),
    reset: () => fetch_data({}),
    fetch_more: () => fetch_data({ ...filters, _cursor: cursor }, undefined, false),
    filter: (filters) => fetch_data(filters, {}),
    has_more,
    empty: items.length == 0 && !loading && !error,
    filters
  }
}
