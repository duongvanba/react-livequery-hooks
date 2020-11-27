import { useEffect, useRef, useState, useContext } from "react"
import { request } from "./request"
import { LiveQueryContext } from "./LiveQueryContext"
import { Response } from "./Response"
import { useCache } from "./useCache"

export enum FilterFunctions {
  "==" = "eq",
  "!=" = "ne",
  ">" = "gt",
  ">=" = "gte",
  "<" = "lt",
  "<=" = "lte",
}

export type ApiObject = {
  id: string
}

export const ne = <T>(value: T) => ['ne', value] as ['ne', T]
export const gt = <T>(value: T) => ['gt', value] as ['gt', T]
export const gte = <T>(value: T) => ['gte', value] as ['gte', T]
export const lt = <T>(value: T) => ['lt', value] as ['lt', T]
export const lte = <T>(value: T) => ['lte', value] as ['lte', T]
export const in_array = <T>(value: T[]) => ['in', value] as ['in', T[]]



type FilterExpression<T> = T | null | [string, null | T]
type FilterExpressionList<T> = { [key in keyof T]?: FilterExpression<T[key]> } & { _q?: string }

export type useCollectionDataOptions<T extends ApiObject> = {
  limit: number,
  where: FilterExpressionList<T>
  fields: string
  autoFetch: boolean
  reatime: boolean | Function
}



type State<T> = {
  items: T[],
  loading: boolean,
  error: any,
  has_more: boolean,
  cursor: string,
  filters: FilterExpressionList<T>
}

export const useCollectionData = <T extends ApiObject>(
  ref: string,
  options: Partial<useCollectionDataOptions<T>> = {}
) => {

  const { autoFetch = true, fields, limit = 10, reatime = false } = options



  const refs = ref?.split('/') || []
  const isCollection = refs.length % 2 == 1

  const ctx = useContext(LiveQueryContext)
  const [cache, setCache] = useCache(ref && `#cache:${ref}#${JSON.stringify(options)}`, [])


  const [{ error, loading, cursor, has_more, items, ...query }, setState] = useState<State<T>>({
    items: [],
    loading: autoFetch,
    error: null,
    has_more: false,
    cursor: null,
    filters: options.where || {}
  })


  // Fetch data
  const isLoading = useRef(false)
  async function fetch_more(new_filters: FilterExpressionList<T> = {}, reset: boolean = false) {

    if (isLoading.current) return
    isLoading.current = true

    const filters = reset ? new_filters : { ...query.filters, ...new_filters }

    try {
      setState(s => ({
        ...s,
        items: (Object.keys(new_filters).length > 0 || reset) ? [] : s.items,
        error: null,
        loading: true,
        filters
      }))

      const rs = await request<Response<T>>(ctx, ref, 'GET', {
        _limit: limit,
        _cursor: cursor,
        _fields: fields,
        ...Object.keys(filters).reduce((p, c) => {
          p[c] = filters[c]?.length ? `${filters[c][0]}|${JSON.stringify(filters[c][1])}` : filters[c]
          return p
        }, {})
      })


      const data = isCollection ? rs.data : { items: [rs], has_more: false, cursor: null }
      setState(s => {
        const items = [...s.items, ...data.items]
        s.items.length == 0 && setCache(items)
        return {
          ...s,
          cursor: data.cursor,
          items,
          error: null,
          has_more: data.has_more,
          loading: false
        }
      })
    } catch (error) {
      setState(s => ({
        ...s,
        error,
        loading: false
      }))
      throw error
    }

    isLoading.current = false
  }

  useEffect(() => {
    ref && autoFetch && fetch_more({}, true)
  }, [ref, autoFetch])


  return {
    items: (loading && items.length == 0 && cache) ? cache as T[] : items,
    loading,
    error,
    fetch_more,
    reload: () => fetch_more(query.filters, true),
    has_more,
    empty: items.length == 0 && !loading,
    filters: query.filters
  }
}  